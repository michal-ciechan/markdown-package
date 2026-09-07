// CARD-0001: bounded access over the assembled example packages.
// Every byte the reader touches is recorded, so "did not read the .git tree" is an
// assertion about measured extents, not a claim about intent.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const WORK = path.join(ROOT, '.antiphon/container-work');
const MANIFEST = '.mdpkg/manifest.json';
const MAGIC = '{"mdpkg":"markdown-package/1"';
// Follow-up: the fixed-length EOCD comment. 5-byte tag, then an escalating version
// field (1 byte; 0xFF escapes to uint16 LE; 0xFFFF escapes to uint32 LE), then defined
// zero padding. 8 bytes through version 65,789, 12 once tier 2 is in use, so a reader
// that knows the profile always reads exactly the last 22 + 12 bytes.
const CTAG = 'MDPKG';
const MAX_COMMENT = 12;
const TAIL_WINDOW = 22 + MAX_COMMENT;

class RangeFile {
  constructor(file) {
    this.fd = fs.openSync(file, 'r');
    this.size = fs.fstatSync(this.fd).size;
    this.ranges = [];
    this.cache = [];
  }
  read(start, length) {
    if (start < 0 || length < 0 || start + length > this.size) throw new Error('out of bounds');
    const hit = this.cache.find((r) => r.start <= start && start + length <= r.start + r.buf.length);
    if (!hit) {
      const buf = Buffer.alloc(length);
      fs.readSync(this.fd, buf, 0, length, start);
      this.ranges.push({ start, end: start + length });
      this.cache.push({ start, buf });
      return buf;
    }
    return hit.buf.subarray(start - hit.start, start - hit.start + length);
  }
  suffix(length) { return this.read(this.size - length, length); }
  get bytes() { return this.ranges.reduce((a, r) => a + (r.end - r.start), 0); }
  get requests() { return this.ranges.length; }
  reset() { this.ranges = []; this.cache = []; }
  close() { fs.closeSync(this.fd); }
}

// Fixed-offset dispatch: one small read at offset 0 accepts or rejects the input.
function typeCheck(file) {
  const need = 30 + MANIFEST.length + MAGIC.length;
  const head = file.read(0, Math.min(need, file.size));
  const reason = (r) => ({ ok: false, reason: r, bytes: file.bytes, requests: file.requests });
  if (head.length < need) return reason('shorter than the fixed manifest header');
  if (head.readUInt32LE(0) !== 0x04034b50) return reason('no local file header signature at offset 0');
  const nameLen = head.readUInt16LE(26); const extraLen = head.readUInt16LE(28);
  if (nameLen !== MANIFEST.length) return reason('first entry name length differs');
  if (head.subarray(30, 30 + nameLen).toString('utf8') !== MANIFEST) return reason('first entry is not the manifest');
  if (head.readUInt16LE(6) & 0x08) return reason('first entry uses a data descriptor');
  if (head.readUInt16LE(8) !== 0) return reason('first entry is not stored');
  const body = file.read(30 + nameLen + extraLen, MAGIC.length);
  if (body.toString('utf8') !== MAGIC) return reason('manifest does not begin with the magic member');
  return { ok: true, bytes: file.bytes, requests: file.requests, manifestOffset: 30 + nameLen + extraLen };
}

// One bounded tail read: locate the terminal EOCD inside a window of known maximum
// size and, if the comment is ours, decode the version without any further request.
function tailType(file, window = TAIL_WINDOW) {
  const tail = file.suffix(Math.min(window, file.size));
  let p = tail.length - 22;
  for (; p >= 0; p--) {
    if (tail.readUInt32LE(p) === 0x06054b50 && p + 22 + tail.readUInt16LE(p + 20) === tail.length) break;
  }
  if (p < 0) return { ok: false, reason: 'no terminal EOCD inside the profile window', bytes: file.bytes, requests: file.requests };
  const len = tail.readUInt16LE(p + 20);
  const comment = tail.subarray(p + 22);
  if (len === 0) return { ok: false, reason: 'no archive comment', bytes: file.bytes, requests: file.requests, commentBytes: 0 };
  if (len < CTAG.length + 1 || comment.subarray(0, CTAG.length).toString('latin1') !== CTAG) {
    return { ok: false, reason: 'comment is not an MDPKG comment', bytes: file.bytes, requests: file.requests, commentBytes: len };
  }
  const f = comment.subarray(CTAG.length);
  let version; let width;
  if (f[0] !== 0xff) { version = f[0]; width = 1; }
  else if (f.length >= 3 && f.readUInt16LE(1) !== 0xffff) { version = 0xff + f.readUInt16LE(1); width = 3; }
  else if (f.length >= 7) { version = 0xff + 0xffff + f.readUInt32LE(3); width = 7; }
  else return { ok: false, reason: 'version field escapes past the comment', bytes: file.bytes, requests: file.requests, commentBytes: len };
  if (f.subarray(width).some((b) => b !== 0)) {
    return { ok: false, reason: 'reserved padding is not zero', bytes: file.bytes, requests: file.requests, commentBytes: len };
  }
  return { ok: true, version, fieldBytes: width, commentBytes: len, bytes: file.bytes, requests: file.requests };
}

function manifest(file) {
  const t = typeCheck(file);
  if (!t.ok) throw new Error(t.reason);
  const size = file.read(0, 30).readUInt32LE(22);
  return JSON.parse(file.read(t.manifestOffset, size).toString('utf8'));
}

// EOCD -> central directory. No entry payload is touched here.
function directory(file, suffixGuess = 22) {
  const tail = file.suffix(Math.min(suffixGuess, file.size));
  let p = tail.length - 22;
  for (; p >= 0; p--) {
    if (tail.readUInt32LE(p) === 0x06054b50 && p + 22 + tail.readUInt16LE(p + 20) === tail.length) break;
  }
  if (p < 0) {
    if (suffixGuess >= 65557 || suffixGuess >= file.size) throw new Error('no terminal EOCD');
    return directory(file, Math.min(65557, file.size));
  }
  const base = file.size - tail.length;
  const count = tail.readUInt16LE(p + 10);
  const cdBytes = tail.readUInt32LE(p + 12);
  const cdOffset = tail.readUInt32LE(p + 16);
  if (cdOffset === 0xffffffff || cdBytes === 0xffffffff || count === 0xffff) throw new Error('ZIP64 not in profile');
  const cd = (cdOffset >= base && cdOffset + cdBytes <= base + tail.length)
    ? tail.subarray(cdOffset - base, cdOffset - base + cdBytes)
    : file.read(cdOffset, cdBytes);
  const entries = new Map();
  let o = 0;
  for (let i = 0; i < count; i++) {
    if (cd.readUInt32LE(o) !== 0x02014b50) throw new Error('bad central record');
    const n = cd.readUInt16LE(o + 28); const e = cd.readUInt16LE(o + 30); const c = cd.readUInt16LE(o + 32);
    entries.set(cd.subarray(o + 46, o + 46 + n).toString('utf8'), {
      method: cd.readUInt16LE(o + 10), flags: cd.readUInt16LE(o + 8), crc: cd.readUInt32LE(o + 16),
      compressed: cd.readUInt32LE(o + 20), uncompressed: cd.readUInt32LE(o + 24),
      offset: cd.readUInt32LE(o + 42),
    });
    o += 46 + n + e + c;
  }
  return { entries, cdOffset, cdBytes, comment: tail.length - (p + 22) };
}

function readEntry(file, dir, name) {
  const rec = dir.entries.get(name);
  if (!rec) throw new Error('no such entry: ' + name);
  if (rec.flags & 0x08) throw new Error('data descriptor: local sizes are not authoritative');
  const local = file.read(rec.offset, 30);
  if (local.readUInt32LE(0) !== 0x04034b50) throw new Error('bad local header');
  const start = rec.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  const raw = file.read(start, rec.compressed);
  const out = rec.method === 0 ? raw : zlib.inflateRawSync(raw);
  if (rec.method !== 0 && rec.method !== 8) throw new Error('method outside the profile');
  if (out.length !== rec.uncompressed) throw new Error('decoded length disagrees with the directory');
  if (zlib.crc32 ? zlib.crc32(out) !== rec.crc : false) throw new Error('CRC mismatch');
  return { data: out, extent: { start: rec.offset, end: start + rec.compressed } };
}

// Deliberately shallow ATX scan: enough to bound a section read, not CARD-0004's parser.
function sections(text) {
  const out = []; let fence = false;
  const lines = text.split('\n'); let pos = 0;
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) fence = !fence;
    else if (!fence && /^#{1,6} \S/.test(line)) out.push({ heading: line.trim(), start: pos, level: line.indexOf(' ') });
    pos += line.length + 1;
  }
  return out.map((s, i) => ({ ...s, end: out.slice(i + 1).find((n) => n.level <= s.level)?.start ?? text.length }));
}

function overlap(ranges, extent) {
  return ranges.reduce((a, r) => a + Math.max(0, Math.min(r.end, extent.end) - Math.max(r.start, extent.start)), 0);
}

function scenario(pkg, targetPath, label, suffixGuess = 22, expectClean = true, typing = 'offset 0') {
  const results = [];
  const probe = new RangeFile(pkg);
  const dirAll = directory(probe);
  const gitExtents = [];
  const otherDocs = [];
  for (const [name, rec] of dirAll.entries) {
    const local = probe.read(rec.offset, 30);
    const extent = { start: rec.offset,
      end: rec.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28) + rec.compressed };
    if (name.startsWith('.git/')) gitExtents.push(extent);
    else if (name.endsWith('.md') && name !== targetPath) otherDocs.push(extent);
  }
  probe.close();

  for (const mode of ['document', 'section']) {
    const file = new RangeFile(pkg);
    let mf; let dir; let tv = null;
    if (typing === 'tail comment') {
      // Typing and version come out of the tail read the reader must make anyway, so
      // the central directory is already in hand and the manifest is read through it.
      tv = tailType(file, suffixGuess);
      if (!tv.ok) throw new Error(tv.reason);
      dir = directory(file, suffixGuess);
      mf = JSON.parse(readEntry(file, dir, MANIFEST).data.toString('utf8'));
    } else {
      mf = manifest(file);
      dir = directory(file, suffixGuess);
    }
    const overrides = mf.addressing.overrides ? readEntry(file, dir, mf.addressing.overrides) : null;
    const doc = readEntry(file, dir, targetPath);
    let payload = doc.data, heading = null;
    if (mode === 'section') {
      const list = sections(doc.data.toString('utf8'));
      const s = list[1] ?? list[0];
      heading = s.heading;
      payload = Buffer.from(doc.data.toString('utf8').slice(s.start, s.end), 'utf8');
    }
    const warmStart = file.bytes;
    readEntry(file, dir, targetPath);
    results.push({
      package: label, target: targetPath, mode, heading,
      typing, comment_version: tv ? tv.version : null,
      initial_suffix_bytes: suffixGuess, expect_clean: expectClean, eocd_comment_bytes: dir.comment,
      manifest_current: mf.current,
      overrides_entry: mf.addressing.overrides, overrides_records: overrides
        ? Object.keys(JSON.parse(overrides.data.toString('utf8')).entries).length : 0,
      requests: file.requests, bytes_read: file.bytes,
      warm_repeat_bytes: file.bytes - warmStart,
      package_bytes: file.size,
      payload_bytes: payload.length, payload_sha256: crypto.createHash('sha256').update(payload).digest('hex'),
      git_bytes_touched: gitExtents.reduce((a, e) => a + overlap(file.ranges, e), 0),
      other_document_bytes_touched: otherDocs.reduce((a, e) => a + overlap(file.ranges, e), 0),
      git_entries: gitExtents.length, other_documents: otherDocs.length,
      ranges: file.ranges.map((r) => [r.start, r.end]),
    });
    file.close();
  }
  return results;
}

function typingCases() {
  const rows = [];
  const dir = path.join(WORK, 'typing');
  fs.mkdirSync(dir, { recursive: true });
  const good = path.join(WORK, 'npm/no-overrides.mdpkg');
  const cases = {
    'valid package': fs.readFileSync(good),
    'random bytes': crypto.randomBytes(4096),
    'empty file': Buffer.alloc(0),
    'plain ZIP, first entry is not the manifest': fs.readFileSync(path.join(WORK, 'typing-plain.zip')),
    'manifest present but not first': fs.readFileSync(path.join(WORK, 'typing-manifest-last.mdpkg')),
    'streamed write, data descriptors': fs.readFileSync(path.join(WORK, 'typing-streamed.mdpkg')),
    'truncated to 40 bytes': fs.readFileSync(good).subarray(0, 40),
  };
  for (const [name, data] of Object.entries(cases)) {
    const p = path.join(dir, name.replace(/[^a-z0-9]+/gi, '-') + '.bin');
    fs.writeFileSync(p, data);
    const file = new RangeFile(p);
    let verdict;
    try { verdict = typeCheck(file); } catch (e) { verdict = { ok: false, reason: e.message, bytes: file.bytes, requests: file.requests }; }
    let recovered = null;
    if (!verdict.ok) {
      try { recovered = directory(file).entries.has(MANIFEST) ? 'manifest found in the central directory' : 'no manifest entry'; }
      catch (e) { recovered = 'no readable central directory'; }
    }
    rows.push({ input: name, input_bytes: data.length, accepted: verdict.ok, reason: verdict.reason ?? null,
      bytes_read: verdict.bytes, requests: verdict.requests, directory_fallback: recovered,
      fallback_bytes: file.bytes });
    file.close();
  }
  return rows;
}

// Item 1: what a version/type decision alone costs, by route and by package.
function versionProbes() {
  const rows = [];
  const packages = {
    'no comment': 'no-overrides.mdpkg',
    'variable 7-byte ASCII comment': 'no-overrides-comment.mdpkg',
    'fixed 8-byte binary comment': 'no-overrides-fixed.mdpkg',
  };
  for (const corpus of ['npm', 'rust']) {
    for (const [label, name] of Object.entries(packages)) {
      const pkg = path.join(WORK, corpus, name);
      for (const route of ['tail comment, 34-byte window', 'offset 0 manifest header, 79 bytes']) {
        const file = new RangeFile(pkg);
        let ok; let reason = null; let version = null;
        if (route.startsWith('tail')) {
          const r = tailType(file, TAIL_WINDOW);
          ok = r.ok; reason = r.reason ?? null; version = r.version ?? null;
        } else {
          const r = typeCheck(file);
          ok = r.ok; reason = r.reason ?? null;
          version = r.ok ? 1 : null;   // the magic member carries the version in its text
        }
        rows.push({ corpus, package: label, route, decided: ok, version, reason,
          requests: file.requests, bytes_read: file.bytes, package_bytes: file.size });
        file.close();
      }
    }
  }
  return rows;
}

const targets = { npm: 'docs/lib/content/using-npm/workspaces.md', rust: 'text/3872-crates-io-security.md' };
const access = [];
for (const corpus of ['npm', 'rust']) {
  const p = (v) => path.join(WORK, corpus, v + '.mdpkg');
  access.push(...scenario(p('no-overrides'), targets[corpus], corpus + ': no comment, 22-byte start', 22, true));
  access.push(...scenario(p('sparse-overrides'), targets[corpus], corpus + ': override ledger, 22-byte start', 22, true));
  // A short archive comment defeats the fixed 22-byte probe; the fallback suffix runs
  // straight into the pack. Measured, not assumed.
  access.push(...scenario(p('no-overrides-comment'), targets[corpus], corpus + ': 7-byte EOCD comment, naive 22-byte start', 22, false));
  access.push(...scenario(p('no-overrides-comment'), targets[corpus], corpus + ': 7-byte EOCD comment, profile-aware 29-byte start', 29, true));
  // Follow-up: the same package with a fixed-length comment. A reader that ignores the
  // declared length hits exactly the same fallback; one that honours it stays clean and
  // gets the version out of the tail read it had to make anyway.
  access.push(...scenario(p('no-overrides-fixed'), targets[corpus], corpus + ': fixed 8-byte comment, naive 22-byte start', 22, false));
  access.push(...scenario(p('no-overrides-fixed'), targets[corpus], corpus + ': fixed 8-byte comment, profile 34-byte window', 34, true));
  access.push(...scenario(p('no-overrides-fixed'), targets[corpus], corpus + ': fixed 8-byte comment, typed from the tail', 34, true, 'tail comment'));
}
const out = { node: process.version, access, typing: typingCases(), version_probes: versionProbes() };
fs.writeFileSync(path.join(HERE, 'reader-results.json'), JSON.stringify(out, null, 2) + '\n');
const bad = access.filter((r) => r.expect_clean && (r.git_bytes_touched || r.other_document_bytes_touched));
if (bad.length) { console.error('boundary violation', bad); process.exit(1); }
for (const r of access) console.log([r.package, r.mode, r.requests, r.bytes_read, r.git_bytes_touched].join(' | '));
console.log(JSON.stringify(out.typing.map((r) => [r.input, r.accepted, r.bytes_read, r.reason])));
