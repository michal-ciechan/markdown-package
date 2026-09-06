// Experiment: clear, single-disk, classic ZIP only. No codec dependency.
// Production readers must additionally implement the chosen ZIP64/security profile.
const textDecoder = new TextDecoder();
const view = b => new DataView(b.buffer, b.byteOffset, b.byteLength);
export function extraFields(bytes) {
  const fields = [];
  for (let p = 0; p < bytes.length;) {
    if (p + 4 > bytes.length) throw Error('Truncated extra header');
    const v = view(bytes), id = v.getUint16(p, true), size = v.getUint16(p + 2, true);
    if (p + 4 + size > bytes.length) throw Error('Truncated extra payload');
    fields.push({ id, bytes: bytes.slice(p + 4, p + 4 + size) });
    p += 4 + size;
  }
  return fields;
}

export async function openZip(url, tailBytes = 65557) {
  const cache = [], requests = [];
  let total, validator;
  async function range(spec) {
    const response = await fetch(url, { headers: { Range: `bytes=${spec}`, ...(validator ? { 'If-Range': validator } : {}) } });
    if (response.status !== 206) throw Error(`Range not honored: ${response.status}`);
    if (response.headers.get('Content-Encoding')) throw Error('Encoded range representation');
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') || '');
    if (!match) throw Error('Invalid Content-Range');
    const [, a, b, t] = match.map(Number);
    if (total !== undefined && total !== t) throw Error('Representation changed');
    total = t;
    const etag = response.headers.get('ETag');
    if (!etag || etag.startsWith('W/')) throw Error('Strong ETag required by this experiment');
    if (validator && etag !== validator) throw Error('ETag changed');
    validator = etag;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== b - a + 1) throw Error('Short response');
    if (a < 0 || b >= total || a > b) throw Error('Invalid range bounds');
    const block = { start: a, end: b + 1, bytes };
    cache.push(block);
    requests.push({ range: spec, start: a, bytes: bytes.length, status: response.status });
    return block;
  }
  async function read(start, length) {
    if (start < 0 || length < 0 || start + length > total) throw Error('Out of bounds');
    const out = new Uint8Array(length);
    let p = start;
    while (p < start + length) {
      let block = cache.find(b => b.start <= p && b.end > p);
      if (!block) {
        const next = Math.min(start + length, ...cache.filter(b => b.start > p).map(b => b.start));
        block = await range(`${p}-${next - 1}`);
      }
      const end = Math.min(start + length, block.end);
      out.set(block.bytes.subarray(p - block.start, end - block.start), p - start);
      p = end;
    }
    return out;
  }
  let tail = await range(`-${tailBytes}`), eocd = -1;
  function findEOCD(block) {
    const v = view(block.bytes);
    for (let p = block.bytes.length - 22; p >= 0; --p) {
      if (v.getUint32(p, true) === 0x06054b50 && p + 22 + v.getUint16(p + 20, true) === block.bytes.length) return p;
    }
    return -1;
  }
  eocd = findEOCD(tail);
  if (eocd < 0 && tailBytes < 65557) {
    const start = Math.max(0, total - 65557);
    tail = { start, bytes: await read(start, total - start) };
    eocd = findEOCD(tail);
  }
  if (eocd < 0) throw Error('Missing terminal EOCD');
  const v = view(tail.bytes), absoluteEOCD = tail.start + eocd;
  const count = v.getUint16(eocd + 10, true), size = v.getUint32(eocd + 12, true), offset = v.getUint32(eocd + 16, true);
  if (v.getUint16(eocd + 4, true) || v.getUint16(eocd + 6, true) || v.getUint16(eocd + 8, true) !== count) throw Error('Split ZIP unsupported');
  if (count === 65535 || size === 0xffffffff || offset === 0xffffffff) throw Error('ZIP64 unsupported in probe');
  if (offset + size !== absoluteEOCD) throw Error('Noncanonical offsets/records unsupported in probe');
  const comment = tail.bytes.slice(eocd + 22);
  const cd = await read(offset, size), cv = view(cd), entries = [];
  for (let p = 0; p < cd.length;) {
    if (p + 46 > cd.length || cv.getUint32(p, true) !== 0x02014b50) throw Error('Bad central header');
    const n = cv.getUint16(p + 28, true), x = cv.getUint16(p + 30, true), c = cv.getUint16(p + 32, true);
    if (p + 46 + n + x + c > cd.length) throw Error('Truncated central entry');
    const flags = cv.getUint16(p + 8, true);
    if (flags & 0x2041) throw Error('Encrypted metadata/entry unsupported');
    entries.push({ name: textDecoder.decode(cd.subarray(p + 46, p + 46 + n)),
      method: cv.getUint16(p + 10, true), crc32: cv.getUint32(p + 16, true),
      compressedBytes: cv.getUint32(p + 20, true), rawBytes: cv.getUint32(p + 24, true),
      localOffset: cv.getUint32(p + 42, true),
      extra: extraFields(cd.subarray(p + 46 + n, p + 46 + n + x)),
      comment: textDecoder.decode(cd.subarray(p + 46 + n + x, p + 46 + n + x + c)) });
    p += 46 + n + x + c;
  }
  if (entries.length !== count) throw Error('Entry count mismatch');
  async function local(entry) {
    const b = await read(entry.localOffset, 30), h = view(b);
    if (h.getUint32(0, true) !== 0x04034b50 || h.getUint16(8, true) !== entry.method) throw Error('Bad local header');
    const nameBytes = h.getUint16(26, true), extraBytes = h.getUint16(28, true);
    return { dataOffset: entry.localOffset + 30 + nameBytes + extraBytes, nameBytes, extraBytes };
  }
  return { entries, comment, total, requests, read, local, cdBytes: size,
    wireBytes: () => requests.reduce((n, r) => n + r.bytes, 0) };
}
