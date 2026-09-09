import {decode, MAGIC, MANIFEST, parseCanonicalJson} from '../format.js';
import {readExact, checkRange} from './source.js';
import {checkNames, validateManifest, conformanceFindings} from './conformance.js';
import {inflateRaw} from './inflate.js';

export const DEFAULT_LIMITS = Object.freeze({
  maxDirectoryBytes: 16 * 1024 * 1024,
  maxEntryBytes: 64 * 1024 * 1024,
  maxCompressedBytes: 64 * 1024 * 1024,
  maxManifestBytes: 1024 * 1024,
});
const u16 = (b, p) => b[p] | b[p + 1] << 8;
const u32 = (b, p) => (b[p] | b[p + 1] << 8 | b[p + 2] << 16 | b[p + 3] << 24) >>> 0;
const zip64 = () => { throw new Error('ZIP64 is not supported'); };
const bound = (value, maximum, label) => {
  if (!Number.isSafeInteger(maximum) || maximum < 0 || value > maximum) throw new Error(label + ' exceeds the reader limit');
};

// A typing failure does not read the directory: callers opt into recovery by
// calling openContainer. This function always costs at most 79 bytes.
export async function typePackage(source) {
  if (source.size < 79) return {conforming: false, reason: 'Shorter than 79 bytes', bytesRead: 0};
  const h = await readExact(source, 0, 79);
  const fail = reason => ({conforming: false, reason, bytesRead: 79});
  if (u32(h, 0) !== 0x04034b50) return fail('No local file header at offset 0');
  if (u16(h, 6) & 8) return fail('First entry has a data descriptor');
  if (u16(h, 8) !== 0) return fail('First entry is not stored');
  if (u16(h, 26) !== 20 || u16(h, 28) !== 0) return fail('First entry has a different name length or an extra field');
  try {
    if (decode(h.subarray(30, 50)) !== MANIFEST || decode(h.subarray(50, 79)) !== MAGIC) return fail('Manifest magic is absent at offset 50');
  } catch { return fail('Typing bytes are not UTF-8'); }
  return {conforming: true, bytesRead: 79};
}

export async function readEndOfCentralDirectory(source) {
  if (source.size < 22) throw new Error('No end of central directory record');
  const tail = await readExact(source, source.size - 22, 22);
  let bytes = tail, position = 0, recordOffset = source.size - 22, bytesRead = 22;
  let fallback = false;
  const aligned = (bytes, p, absolute) => u32(bytes, p + 16) + u32(bytes, p + 12) === absolute;
  if (u32(tail, 0) !== 0x06054b50 || u16(tail, 20) !== 0 || !aligned(tail, 0, recordOffset)) {
    const length = Math.min(source.size, 65557);
    bytes = await readExact(source, source.size - length, length);
    bytesRead += length;
    fallback = true;
    position = -1;
    let unaligned = -1;
    for (let p = bytes.length - 22; p >= 0; p--) {
      // A signature inside an archive comment is not by itself an EOCD.
      if (u32(bytes, p) === 0x06054b50 && p + 22 + u16(bytes, p + 20) === bytes.length) {
        if (!aligned(bytes, p, source.size - length + p)) {
          if (unaligned < 0) unaligned = p;
          continue;
        }
        position = p;
        break;
      }
    }
    // Retain a structurally complete unaligned record for a specific ZIP64 or
    // corrupt-extent rejection when no ordinary ZIP32 candidate was found.
    if (position < 0) position = unaligned;
    if (position < 0) throw new Error('No complete EOCD ending at EOF');
    recordOffset = source.size - length + position;
  }
  const disk = u16(bytes, position + 4), directoryDisk = u16(bytes, position + 6);
  const diskEntries = u16(bytes, position + 8), entries = u16(bytes, position + 10);
  const size = u32(bytes, position + 12), offset = u32(bytes, position + 16);
  if ([disk, directoryDisk, diskEntries, entries].includes(0xffff) || size === 0xffffffff || offset === 0xffffffff) zip64();
  if (disk || directoryDisk || diskEntries !== entries) throw new Error('Multi-disk ZIP archives are not supported');
  checkRange(recordOffset, offset, size);
  if (offset + size !== recordOffset) {
    if (recordOffset >= 20) {
      const locator = await readExact(source, recordOffset - 20, 20);
      if (u32(locator, 0) === 0x07064b50) zip64();
    }
    throw new Error('Unexpected data between the directory and EOCD');
  }
  const commentLength = u16(bytes, position + 20);
  return {offset, size, entries, recordOffset, bytesRead, fallback, commentLength,
    comment: new TextDecoder('latin1').decode(bytes.subarray(position + 22, position + 22 + commentLength))};
}

function checkExtra(bytes) {
  for (let p = 0; p < bytes.length;) {
    if (p + 4 > bytes.length) throw new Error('Truncated ZIP extra field');
    const tag = u16(bytes, p), length = u16(bytes, p + 2);
    if (tag === 1) zip64();
    p += 4 + length;
    if (p > bytes.length) throw new Error('Truncated ZIP extra field payload');
  }
}

export async function readCentralDirectory(source, end, limits = DEFAULT_LIMITS) {
  bound(end.size, limits.maxDirectoryBytes, 'Central directory');
  if (end.entries * 46 > end.size) throw new Error('Directory count cannot fit in its extent');
  const bytes = await readExact(source, end.offset, end.size);
  const entries = [];
  let p = 0;
  while (p < bytes.length) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new Error('Malformed central directory record');
    const flags = u16(bytes, p + 8), method = u16(bytes, p + 10);
    const nameLength = u16(bytes, p + 28), extraLength = u16(bytes, p + 30), commentLength = u16(bytes, p + 32);
    const recordEnd = p + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > bytes.length) throw new Error('Truncated central directory record');
    const compressedSize = u32(bytes, p + 20), uncompressedSize = u32(bytes, p + 24);
    const localHeaderOffset = u32(bytes, p + 42), disk = u16(bytes, p + 34);
    if ([compressedSize, uncompressedSize, localHeaderOffset].includes(0xffffffff) || disk === 0xffff) zip64();
    if (disk) throw new Error('Multi-disk ZIP entry');
    if (flags & ~0x080e) throw new Error('Encrypted or unsupported ZIP entry flags');
    if (method !== 0 && method !== 8) throw new Error(`ZIP method ${method} is not permitted`);
    if (method === 0 && compressedSize !== uncompressedSize) throw new Error('Stored entry sizes disagree');
    const rawName = bytes.subarray(p + 46, p + 46 + nameLength);
    if (!(flags & 0x800) && rawName.some(byte => byte > 127)) throw new Error('Non-ASCII entry name lacks the UTF-8 flag');
    const name = decode(rawName), directory = name.endsWith('/');
    const unixType = (u32(bytes, p + 38) >>> 16) & 0xf000;
    if (unixType && unixType !== 0x8000 && unixType !== 0x4000) throw new Error('Special files and symbolic links are not supported');
    if (directory && uncompressedSize !== 0) throw new Error('Directory entry has a payload');
    checkExtra(bytes.subarray(p + 46 + nameLength, p + 46 + nameLength + extraLength));
    checkRange(end.offset, localHeaderOffset, 30 + compressedSize);
    entries.push({name, flags, method, compressedSize, uncompressedSize, localHeaderOffset, directory,
      internalAttributes: u16(bytes, p + 36), crc32: u32(bytes, p + 16)});
    p = recordEnd;
  }
  if (entries.length !== end.entries) throw new Error('Directory entry count disagrees with EOCD');
  checkNames(entries);
  const ordered = entries.slice().sort((a, b) => a.localHeaderOffset - b.localHeaderOffset);
  for (let i = 0; i < ordered.length; i++) {
    const entry = ordered[i];
    entry.extentEnd = ordered[i + 1]?.localHeaderOffset ?? end.offset;
    if (entry.localHeaderOffset + 30 + entry.compressedSize > entry.extentEnd) throw new Error('Overlapping ZIP entry extents');
    Object.freeze(entry);
  }
  return {entries, bytesRead: end.size};
}

export async function readEntry(source, entry, limits = DEFAULT_LIMITS) {
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`ZIP method ${entry.method} is not permitted`);
  bound(entry.uncompressedSize, limits.maxEntryBytes, entry.name);
  bound(entry.compressedSize, limits.maxCompressedBytes, entry.name);
  const header = await readExact(source, entry.localHeaderOffset, 30);
  if (u32(header, 0) !== 0x04034b50) throw new Error('Missing local header for ' + entry.name);
  if (u32(header, 18) === 0xffffffff || u32(header, 22) === 0xffffffff) zip64();
  const nameLength = u16(header, 26), extraLength = u16(header, 28);
  const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
  checkRange(entry.extentEnd ?? source.size, dataOffset, entry.compressedSize);
  if (extraLength) checkExtra(await readExact(source, dataOffset - extraLength, extraLength));
  // Apart from the lengths needed to find data and explicit ZIP64 markers,
  // local metadata is ignored. Descriptors may contain zeros or stale values.
  const raw = await readExact(source, dataOffset, entry.compressedSize);
  const bytes = entry.method === 0 ? raw : await inflateRaw(raw, entry.uncompressedSize, entry.name);
  if (bytes.length !== entry.uncompressedSize) throw new Error('Decoded size mismatch for ' + entry.name);
  if (crc32(bytes) !== entry.crc32) throw new Error('CRC32 mismatch for ' + entry.name);
  return {bytes, header, bytesRead: 30 + extraLength + entry.compressedSize};
}

export async function openContainer(source, options = {}) {
  const limits = {...DEFAULT_LIMITS, ...options.limits};
  const typing = await typePackage(source);
  const end = await readEndOfCentralDirectory(source);
  const {entries} = await readCentralDirectory(source, end, limits);
  const byName = new Map(entries.filter(e => !e.directory).map(e => [e.name, e]));
  const entry = byName.get(MANIFEST);
  if (!entry) throw new Error('The archive has no exact .mdpkg/manifest.json entry');
  bound(entry.uncompressedSize, limits.maxManifestBytes, 'Manifest');
  const {bytes, header} = await readEntry(source, entry, limits);
  if (!decode(bytes).startsWith(MAGIC)) throw new Error('The manifest does not begin with the version-1 magic');
  const manifest = parseCanonicalJson(bytes, true);
  validateManifest(manifest, byName);
  for (const match of end.comment.matchAll(/(?:MDPKG|markdown-package)\/([0-9]+)(?![0-9])/gi)) {
    if (match[1] !== '1') throw new Error('Archive comment version disagrees with the manifest');
  }
  // The directory must select the very same first entry that passed typing.
  if (typing.conforming && (entry.localHeaderOffset !== 0 || entry.method !== 0 || entry.flags & 8)) {
    throw new Error('Directory manifest disagrees with the offset-0 typing entry');
  }
  const issues = conformanceFindings(entries, end, typing);
  if (typing.conforming && (u32(header, 14) !== entry.crc32 || u32(header, 18) !== entry.compressedSize ||
      u32(header, 22) !== entry.uncompressedSize)) {
    issues.push({code: 'manifest-local-metadata', entry: MANIFEST, message: 'The manifest local header must carry its true CRC and sizes.'});
  }
  return {
    source, manifest, entries, byName, typing, end, issues,
    tier: typing.conforming ? 'conforming' : 'recoverable',
    async read(name) {
      const target = byName.get(name);
      if (!target) throw new Error('Package entry is missing: ' + name);
      return (await readEntry(source, target, limits)).bytes;
    },
  };
}

const CRC_TABLE = Uint32Array.from({length: 256}, (_, i) => {
  let value = i;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
