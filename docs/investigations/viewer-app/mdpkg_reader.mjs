// A dependency-free conforming-tier reader for the container profile in
// spec.md §3.1, §3.3, §3.4 and §3.5. Browser-targeted: the only decoder it uses
// is native DecompressionStream('deflate-raw'). It is a measurement subject for
// docs/investigations/viewer-app.md — enough of a reader to type a package,
// list it from the central directory and decode one entry over an exact extent,
// and deliberately no more. Not a validator: it checks what a bounded read must
// check (§3.1 bytes, method, extent, CRC32, uncompressed size) and nothing else.

const MAGIC = '{"mdpkg":"markdown-package/1"';
const dec = new TextDecoder('utf-8', {fatal: true});

// A source is {size, read(offset, length) -> Promise<Uint8Array>}; a range
// reader over HTTP and a Blob-backed reader both satisfy it. Every read the
// caller pays for goes through it, so a probe can count the bytes.
export function bytesSource(bytes) {
  return {size: bytes.length, async read(o, n) { return bytes.subarray(o, o + n); }};
}

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;

// §3.1: accept or reject in at most 79 bytes, and never read past byte 78.
export async function typePackage(src) {
  if (src.size < 79) return {conforming: false, reason: 'shorter than 79 bytes', bytesRead: 0};
  const h = await src.read(0, 79);
  const fail = reason => ({conforming: false, reason, bytesRead: 79});
  if (u32(h, 0) !== 0x04034b50) return fail('no local file header signature at 0');
  if (u16(h, 6) & 0x08) return fail('general-purpose bit 3 set on the first entry');
  if (u16(h, 8) !== 0) return fail('first entry is not stored');
  if (u16(h, 26) !== 20) return fail('first entry file name length is not 20');
  if (u16(h, 28) !== 0) return fail('first entry has an extra field');
  let name, magic;
  try { name = dec.decode(h.subarray(30, 50)); magic = dec.decode(h.subarray(50, 79)); }
  catch { return fail('name or magic region is not valid UTF-8'); }
  if (name !== '.mdpkg/manifest.json') return fail(`first entry is ${JSON.stringify(name)}`);
  if (magic !== MAGIC) return fail('manifest does not begin with the magic member');
  return {conforming: true, bytesRead: 79};
}

// §3.5: the fixed 22-byte tail read, with the permitted 65,557-byte fallback.
export async function readEndOfCentralDirectory(src) {
  let bytesRead = 0;
  const tail = await src.read(src.size - 22, 22); bytesRead += 22;
  if (u32(tail, 0) === 0x06054b50 && u16(tail, 20) === 0)
    return {offset: u32(tail, 16), size: u32(tail, 12), entries: u16(tail, 10), bytesRead, fallback: false};
  const n = Math.min(src.size, 65557);
  const suffix = await src.read(src.size - n, n); bytesRead += n;
  for (let i = suffix.length - 22; i >= 0; i--) {
    if (u32(suffix, i) === 0x06054b50)
      return {offset: u32(suffix, i + 16), size: u32(suffix, i + 12), entries: u16(suffix, i + 10),
              bytesRead, fallback: true, commentLength: u16(suffix, i + 20)};
  }
  throw new Error('no end of central directory record');
}

// §3.5: the central directory is authoritative for names, methods, extents,
// CRCs and sizes. One contiguous read; nothing is taken from a local header.
export async function readCentralDirectory(src, eocd) {
  const cd = await src.read(eocd.offset, eocd.size);
  const entries = [];
  let p = 0;
  while (p < cd.length && u32(cd, p) === 0x02014b50) {
    const nameLen = u16(cd, p + 28), extraLen = u16(cd, p + 30), commentLen = u16(cd, p + 32);
    const raw = cd.subarray(p + 46, p + 46 + nameLen);
    entries.push({
      name: (u16(cd, p + 8) & 0x800) ? dec.decode(raw) : String.fromCharCode(...raw),
      flags: u16(cd, p + 8), method: u16(cd, p + 10), crc32: u32(cd, p + 16),
      compressedSize: u32(cd, p + 20), uncompressedSize: u32(cd, p + 24),
      internalAttributes: u16(cd, p + 36), localHeaderOffset: u32(cd, p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (entries.length !== eocd.entries) throw new Error('central directory entry count disagrees with the EOCD');
  return {entries, bytesRead: eocd.size};
}

// §3.4: the local header is read only for its two length fields, to find where
// the entry's data starts. Its sizes, CRC and method are ignored on purpose.
export async function readEntry(src, entry) {
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`method ${entry.method} is not permitted`);
  const lh = await src.read(entry.localHeaderOffset, 30);
  if (u32(lh, 0) !== 0x04034b50) throw new Error('no local file header at the recorded offset');
  const dataOffset = entry.localHeaderOffset + 30 + u16(lh, 26) + u16(lh, 28);
  const raw = await src.read(dataOffset, entry.compressedSize);
  const out = entry.method === 0 ? raw : await inflateRaw(raw, entry.uncompressedSize);
  if (out.length !== entry.uncompressedSize) throw new Error('decoded length disagrees with the central directory');
  if (crc32(out) !== entry.crc32) throw new Error('CRC32 disagrees with the central directory');
  return {bytes: out, bytesRead: 30 + entry.compressedSize};
}

async function inflateRaw(raw, expected) {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  w.write(raw); w.close();
  const chunks = []; let total = 0;
  for (const r = ds.readable.getReader();;) {
    const {done, value} = await r.read();
    if (done) break;
    total += value.length;
    if (total > expected) throw new Error('decoded output exceeds the declared uncompressed size');
    chunks.push(value);
  }
  const out = new Uint8Array(total); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
