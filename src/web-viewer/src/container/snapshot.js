import {MANIFEST, canonicalJson, byteOrder, decode} from '../format.js';
import {sha256} from '../address/digest.js';
import {readLedger} from '../address/resolve.js';
import {outline} from '../address/outline.js';
import {readComments} from '../review/comments.js';

export function semanticHeader(manifest) {
  const r = manifest.review;
  return {addressing: manifest.addressing, namespace: manifest.namespace,
    review: r ? {detail: r.detail, of: {current: r.of.current, namespace: r.of.namespace}, shape: r.shape} : null};
}

// Only entry digests/metadata accumulate. Decoded files are read one at a time.
export async function snapshotIdentity(manifest, names, read, maximum = 128 * 1024 * 1024) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || names.length > 10000) throw new Error('Snapshot verification exceeds its resource limit');
  const entries = []; let total = 0;
  for (const path of names.slice().sort(byteOrder)) {
    const bytes = await read(path, maximum - total);
    total += bytes.length;
    if (total > maximum) throw new Error('Snapshot verification exceeds its decoded byte limit');
    if (decode(bytes).includes('\r')) throw new Error('Current files must be UTF-8 with LF endings');
    entries.push({bytes: bytes.length, digest: 'sha256-' + await sha256(bytes), mode: '100644', path});
  }
  return 'sha256-' + await sha256(canonicalJson({entries, header: semanticHeader(manifest), profile: 'mdpkg-snapshot-v1'}));
}

export async function verifySnapshot(container, {maxDecodedBytes = 128 * 1024 * 1024} = {}) {
  if (container.manifest.history.mode !== 'none') throw new Error('Git verification requires a history backend');
  let decoded = 0;
  const read = async (name, maximum = maxDecodedBytes - decoded) => {
    const bytes = await container.read(name, Math.min(maximum, maxDecodedBytes - decoded));
    decoded += bytes.length;
    if (decoded > maxDecodedBytes) throw new Error('Snapshot verification exceeds its decoded byte limit');
    return bytes;
  };
  const names = container.entries.filter(e => !e.directory && e.name !== MANIFEST).map(e => e.name);
  const id = await snapshotIdentity(container.manifest, names, read, maxDecodedBytes);
  if (id !== container.manifest.current.id) throw new Error('Snapshot identity does not match current files');
  const ledger = await readLedger({...container, read});
  for (const record of ledger.values()) if (record.to) {
    const path = record.to[1];
    if (!names.includes(path) || !/\.(md|markdown)$/i.test(path) ||
        !outline(await read(path), path).find(record.to)) throw new Error('Ledger target is unavailable');
  }
  if (container.manifest.review) readComments(await read(container.manifest.review.detail));
  for (const entry of container.entries) if (entry.directory) await container.readDirectory(entry);
  return Object.freeze({assurance: 'snapshot-verified', current: container.manifest.current});
}
