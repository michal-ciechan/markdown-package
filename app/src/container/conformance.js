import {ANCHOR, DIGEST, MANIFEST, UUID, OID, isObject, decode, utf8} from '../format.js';
import {simpleCaseFold} from './case-fold.js';

export const nameKey = name => simpleCaseFold(name.normalize('NFC'));
export const isReserved = name => /^(?:\.git|\.mdpkg)(?:\/|$)/.test(nameKey(name));

export function validatePath(name, directory = false) {
  const fail = reason => { throw new Error(reason + ': ' + JSON.stringify(name)); };
  if (typeof name !== 'string' || !name) fail('Empty or invalid package path');
  if (name.includes('\\')) fail('Backslash in package path');
  if (/[\u0000-\u001f\u007f]/.test(name)) fail('Control character in package path');
  if (name.startsWith('/')) fail('Absolute package path');
  const path = directory && name.endsWith('/') ? name.slice(0, -1) : name;
  const parts = path.split('/');
  if (parts.some(part => part === '.' || part === '..')) fail('Dot component in package path');
  if (parts.some(part => !part)) fail('Empty component in package path');
  if (parts.some(part => /^[A-Za-z]:/.test(part))) fail('Drive letter in package path');
  if (decode(utf8.encode(name)) !== name) fail('Invalid Unicode in package path');
  return name;
}

function allowedReserved(name, directory) {
  if (directory) return name === '.git/' || name === '.git/refs/' || name === '.git/refs/heads/' ||
    name === '.git/objects/' || name === '.git/objects/pack/' || name === '.mdpkg/' ||
    name.startsWith('.mdpkg/address/') || name.startsWith('.mdpkg/review/') ||
    ['.mdpkg/history/', '.mdpkg/history/ranges/', '.mdpkg/history/patches/'].includes(name);
  return name === MANIFEST || name === '.mdpkg/history.json' || name === '.mdpkg/history/bindings.json' ||
    /^\.mdpkg\/history\/ranges\/[a-f0-9]{64}\.json$/.test(name) ||
    /^\.mdpkg\/history\/patches\/[a-f0-9]{64}\.patch$/.test(name) ||
    name.startsWith('.mdpkg/address/') || name.startsWith('.mdpkg/review/') ||
    ['.git/HEAD', '.git/config', '.git/refs/heads/main', '.git/shallow'].includes(name) ||
    /^\.git\/objects\/pack\/pack-[a-f0-9]{40}\.(?:pack|idx|rev)$/.test(name);
}

export function checkNames(entries) {
  const names = new Map(), files = new Set();
  for (const entry of entries) {
    validatePath(entry.name, entry.directory);
    const key = nameKey(entry.name.replace(/\/$/, ''));
    if (names.has(key)) throw new Error(`Ambiguous entry names: ${names.get(key)} and ${entry.name}`);
    names.set(key, entry.name);
    if (!entry.directory) files.add(key);
    if (isReserved(entry.name) && !allowedReserved(entry.name, entry.directory)) {
      throw new Error('Reserved package path: ' + entry.name);
    }
  }
  for (const key of names.keys()) {
    const parts = key.split('/');
    parts.pop();
    while (parts.length) {
      if (files.has(parts.join('/'))) throw new Error('An entry is both a file and a parent directory');
      parts.pop();
    }
  }
}

export function validateManifest(manifest, byName) {
  const fail = message => { throw new Error('Invalid manifest: ' + message); };
  if (!isObject(manifest) || manifest.mdpkg !== 'markdown-package/1') fail('unsupported format');
  if (!UUID.test(manifest.namespace)) fail('namespace must be a lowercase UUID');
  if (!/^sha1-[a-f0-9]{40}$/.test(manifest.current)) fail('version 1 requires a SHA-1 current commit');
  const a = manifest.addressing, h = manifest.history;
  if (!isObject(a) || a.anchor !== ANCHOR || a.digest !== DIGEST ||
      !['complete', 'partial'].includes(a.coverage)) fail('unsupported addressing declaration');
  if (a.overrides !== null && a.overrides !== '.mdpkg/address/overrides.json') fail('invalid override path');
  if ((a.overrides !== null) !== byName.has('.mdpkg/address/overrides.json')) fail('override entry disagrees with declaration');
  if (!isObject(h) || !['complete', 'truncated', 'unknown'].includes(h.coverage) ||
      !Array.isArray(h.transform) || h.transform.some(t => !['projected', 'squashed'].includes(t)) ||
      h.detail !== '.mdpkg/history.json') fail('invalid history declaration');
  if (!byName.has(h.detail)) fail('missing history descriptor');
  if (manifest.review !== undefined) {
    const r = manifest.review;
    if (!isObject(r) || !isObject(r.of) || !UUID.test(r.of.namespace) || !OID.test(r.of.current) ||
        !['delta', 'bundled'].includes(r.shape) || r.detail !== '.mdpkg/review/comments.json' ||
        !byName.has(r.detail)) fail('invalid review declaration');
    if ((r.shape === 'bundled') !== (manifest.namespace === r.of.namespace)) fail('review namespace contradicts shape');
    if (r.of.packageDigest !== undefined && !/^sha256-[a-f0-9]{64}$/.test(r.of.packageDigest)) fail('invalid package digest');
    if (r.of.packageBytes !== undefined && (!Number.isSafeInteger(r.of.packageBytes) || r.of.packageBytes < 0)) fail('invalid package length');
    if (r.of.dispatch !== undefined && typeof r.of.dispatch !== 'string') fail('invalid dispatch');
  }
}

// These findings do not make byte-exact in-memory reading ambiguous. Report
// them separately from §3.7's typing tier; this reader is not a Git validator.
export function conformanceFindings(entries, end, typing) {
  const issues = [];
  const add = (code, message, entry) => issues.push({code, message, ...(entry ? {entry} : {})});
  if (!typing.conforming) add('recoverable-container', 'Recovered through the central directory; re-emit with a package-aware producer.');
  if (end.commentLength) add('archive-comment', 'The archive comment must be empty.');
  for (const entry of entries) {
    if (entry.internalAttributes !== 0) add('internal-attributes', 'D-19 requires internal file attributes of 0.', entry.name);
    if (/^\.git\/objects\/pack\/.*\.(?:pack|idx|rev)$/.test(entry.name) && entry.method !== 0) {
      add('compressed-git-storage', 'Git pack, index and reverse index entries must be stored.', entry.name);
    }
  }
  const ordered = entries.filter(e => !e.directory).slice().sort((a, b) => a.localHeaderOffset - b.localHeaderOffset);
  const packs = ordered.filter(e => e.name.endsWith('.pack') && e.name.startsWith('.git/'));
  if (packs.length !== 1) add('pack-count', 'The curated repository must contain exactly one pack.');
  else if (ordered[ordered.length - 1] !== packs[0]) add('pack-order', 'The Git pack must be the last entry.');
  return issues;
}
