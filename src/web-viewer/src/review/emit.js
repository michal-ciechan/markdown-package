import {ANCHOR, DIGEST, UUID, MANIFEST, utf8, canonicalJson, sameIdentity} from '../format.js';
import {openContainer} from '../container/reader.js';
import {bytesSource} from '../container/source.js';
import {writePackage} from '../container/writer.js';
import {snapshotIdentity} from '../container/snapshot.js';
import {DETAIL, readComments, validateAnchors} from './comments.js';

export async function emitReview(pkg, comments, {namespace = crypto.randomUUID()} = {}) {
  if (!UUID.test(namespace) || namespace === pkg.manifest.namespace) throw new Error('Invalid review identity');
  const snapshot = structuredClone(comments), target = structuredClone(pkg.manifest);
  await validateAnchors(snapshot, pkg);
  const commentBytes = utf8.encode(canonicalJson(snapshot));
  const manifest = {mdpkg: 'markdown-package/1', namespace, current: {kind: 'snapshot', id: ''},
    addressing: {anchor: ANCHOR, digest: DIGEST, coverage: 'complete', overrides: null},
    history: {mode: 'none'},
    review: {of: {namespace: target.namespace, current: target.current}, shape: 'delta', detail: DETAIL}};
  manifest.current.id = await snapshotIdentity(manifest, [DETAIL], async () => commentBytes);
  const manifestText = '{"mdpkg":"markdown-package/1",' +
    canonicalJson(Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'mdpkg'))).slice(1);
  const bytes = await writePackage([{name: MANIFEST, bytes: utf8.encode(manifestText), stored: true}, {name: DETAIL, bytes: commentBytes}]);
  await validateExport(bytes, pkg, snapshot);
  return bytes;
}

export async function validateExport(bytes, original, expected) {
  const result = await openContainer(bytesSource(bytes));
  if (result.tier !== 'conforming' || result.issues.length) throw new Error('Export failed container self-validation');
  const m = result.manifest, r = m.review;
  if (r?.shape !== 'delta' || !sameIdentity(r.of, original.manifest) || m.namespace === original.manifest.namespace)
    throw new Error('Export changed the reviewed identity');
  if (m.history.mode !== 'none' || result.entries.length !== 2 || !result.byName.has(DETAIL)) throw new Error('Unexpected delta entries');
  await result.verifySnapshot();
  const comments = readComments(await result.read(DETAIL));
  if (expected && canonicalJson(comments) !== canonicalJson(expected)) throw new Error('Export lost review content');
  await validateAnchors(comments, original);
  return result;
}
