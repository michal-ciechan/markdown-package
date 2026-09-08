// Read path: what a browser must fetch and decode to show one document of a
// conforming package, measured three ways over the real fixture packages that
// docs/spec/worked-example.py emits. Byte counts are what each implementation
// asked its source for, not what an HTTP stack would round up to.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import * as mdpkg from './mdpkg_reader.mjs';

const work = path.resolve('.antiphon/viewer-work');
const require = createRequire(path.join(work, 'js/package.json'));
const zip = require('@zip.js/zip.js');
const {unzipSync} = require('fflate');
const {Parser} = require('commonmark');

// A source that counts every byte the reader asks for, so "bounded read" is a
// measurement rather than a claim about the API surface.
function countingSource(bytes) {
  const log = [];
  return {source: {size: bytes.length, async read(o, n) { log.push([o, n]); return bytes.subarray(o, o + n); }},
          log, total: () => log.reduce((a, [, n]) => a + n, 0)};
}

const sha256 = b => createHash('sha256').update(b).digest('hex');
const results = {packages: []};

for (const name of ['full', 'squashed']) {
  const file = path.join(work, 'fixture', name + '.mdpkg');
  const bytes = new Uint8Array(await fs.readFile(file));
  const rec = {package: name, size: bytes.length, sha256: sha256(bytes)};

  // §3.1 typing, and the same check against inputs it must reject.
  const t = countingSource(bytes);
  rec.typing = {...await mdpkg.typePackage(t.source), bytesAsked: t.total()};
  const cd0 = new Uint8Array(bytes); cd0[0] = 0x51;                      // corrupt the signature
  const notFirst = new Uint8Array(bytes); notFirst.set([0x78], 30);      // rename the first entry
  rec.rejections = [];
  for (const [label, input] of [['random bytes', crypto.getRandomValues(new Uint8Array(4096))],
                                ['empty', new Uint8Array(0)],
                                ['78-byte truncation', bytes.subarray(0, 78)],
                                ['bad signature', cd0],
                                ['first entry renamed', notFirst]]) {
    const s = countingSource(input);
    const r = await mdpkg.typePackage(s.source);
    rec.rejections.push({label, conforming: r.conforming, reason: r.reason, bytesAsked: s.total()});
  }

  // Minimal reader: EOCD, central directory, one document entry.
  const m = countingSource(bytes);
  const eocd = await mdpkg.readEndOfCentralDirectory(m.source);
  const cd = await mdpkg.readCentralDirectory(m.source, eocd);
  rec.entries = cd.entries.map(e => ({name: e.name, method: e.method, flags: e.flags,
    internalAttributes: e.internalAttributes, compressedSize: e.compressedSize,
    uncompressedSize: e.uncompressedSize}));
  rec.checks = {
    manifestFirstAtZero: cd.entries.some(e => e.name === '.mdpkg/manifest.json' && e.localHeaderOffset === 0),
    packIsLastEntry: (() => { const p = cd.entries.filter(e => e.name.endsWith('.pack'));
      return p.length === 1 && p[0].localHeaderOffset === Math.max(...cd.entries.map(e => e.localHeaderOffset)); })(),
    onlyMethods0And8: cd.entries.every(e => e.method === 0 || e.method === 8),
    textFlagClearEverywhere: cd.entries.every(e => (e.internalAttributes & 1) === 0),
    eocdCommentLengthZero: !eocd.fallback,
    packStored: cd.entries.filter(e => /\.(pack|idx)$/.test(e.name)).every(e => e.method === 0),
  };
  const target = cd.entries.find(e => e.name === 'guide.md');
  const before = m.total();
  const doc = await mdpkg.readEntry(m.source, target);
  rec.minimalReader = {
    entry: target.name, method: target.method,
    typingBytes: 79, eocdBytes: eocd.bytesRead, centralDirectoryBytes: cd.bytesRead,
    entryBytes: m.total() - before,
    totalAsked: 79 + m.total(), packageSize: bytes.length,
    sha256: sha256(doc.bytes), decodedBytes: doc.bytes.length,
  };

  // The same read through zip.js, over a Reader that counts its range requests.
  class CountingReader extends zip.Reader {
    constructor(b) { super(); this.b = b; this.size = b.length; this.log = []; }
    async init() { this.initialized = true; }
    // zip.js builds DataViews from the returned array's buffer, so a range
    // reader must hand back a standalone buffer, not a view into the package.
    async readUint8Array(o, n) { this.log.push([o, n]); return this.b.slice(o, o + n); }
  }
  const cr = new CountingReader(bytes);
  const zr = new zip.ZipReader(cr, {useWebWorkers: false});
  const zEntries = await zr.getEntries();
  const askedAfterDirectory = cr.log.reduce((a, [, n]) => a + n, 0);
  const zTarget = zEntries.find(e => e.filename === 'guide.md');
  const zData = await zTarget.getData(new zip.Uint8ArrayWriter());
  await zr.close();
  rec.zipjs = {entries: zEntries.length, directoryBytes: askedAfterDirectory,
    totalAsked: cr.log.reduce((a, [, n]) => a + n, 0),
    sha256: sha256(Buffer.from(zData)), matchesMinimal: sha256(Buffer.from(zData)) === rec.minimalReader.sha256};

  // fflate has no range reader: unzipSync takes the whole archive and, with a
  // filter, decodes only the wanted entry. Bytes asked for is the whole file.
  const ff = unzipSync(bytes, {filter: f => f.name === 'guide.md'});
  rec.fflate = {totalAsked: bytes.length, sha256: sha256(Buffer.from(ff['guide.md'])),
    matchesMinimal: sha256(Buffer.from(ff['guide.md'])) === rec.minimalReader.sha256};

  // The identity layer on top of the bytes: §6.1 rules 2-4 over the decoded
  // document, using the pinned CommonMark version the profile names.
  const text = new TextDecoder().decode(doc.bytes);
  const ast = new Parser({smart: false}).parse(text);
  const headings = [];
  for (let w = ast.walker(), ev; (ev = w.next());) {
    const n = ev.node;
    if (ev.entering && n.type === 'heading' && n.parent.type === 'document')
      headings.push({level: n.level, line: n.sourcepos[0][0]});
  }
  rec.sections = {topLevelHeadings: headings.length, headings};
  results.packages.push(rec);
}

results.node = process.version;
const pkgVersion = async n => JSON.parse(await fs.readFile(path.join(work, 'js/node_modules', n, 'package.json'), 'utf8')).version;
results.versions = {'@zip.js/zip.js': await pkgVersion('@zip.js/zip.js'),
  fflate: await pkgVersion('fflate'), commonmark: await pkgVersion('commonmark')};
await fs.writeFile('docs/investigations/viewer-app/read-probe-results.json', JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results.packages.map(p => ({package: p.package, size: p.size, typing: p.typing,
  checks: p.checks, minimal: p.minimalReader, zipjs: p.zipjs, fflate: p.fflate,
  rejections: p.rejections})), null, 1));
