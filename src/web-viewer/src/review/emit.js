import {ANCHOR, DIGEST, UUID, MANIFEST, utf8, canonicalJson, parseCanonicalJson, decode} from '../format.js';
import {openContainer} from '../container/reader.js';
import {bytesSource} from '../container/source.js';
import {writePackage} from '../container/writer.js';
import {DETAIL, readComments, validateAnchors} from './comments.js';

export async function emitReview(pkg, comments, {namespace = crypto.randomUUID(), timestamp = Math.floor(Date.now() / 1000)} = {}) {
  if (!UUID.test(namespace) || namespace === pkg.manifest.namespace || !Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('Invalid review identity or timestamp');
  // Snapshot before awaiting: subsequent UI changes must not alter this export.
  const snapshot = structuredClone(comments);
  await validateAnchors(snapshot, pkg);
  const commentBytes = utf8.encode(canonicalJson(snapshot));
  const {reviewRepository} = await import('./git.js');
  const repo = await reviewRepository(commentBytes, timestamp), current = 'sha1-' + repo.commit;
  const manifest = {mdpkg: 'markdown-package/1', namespace, current,
    addressing: {anchor: ANCHOR, digest: DIGEST, coverage: 'complete', overrides: null},
    history: {coverage: 'complete', transform: [], detail: '.mdpkg/history.json'},
    review: {of: {namespace: pkg.manifest.namespace, current: pkg.manifest.current}, shape: 'delta', detail: DETAIL}};
  const history = {walk: 'first-parent', root: 'original', sourceBase: current, sourceTip: current, retainedCommits: 1,
    shallowBoundaries: [], transformations: [], ranges: [], patches: [],
    addressingCoverage: [{coverage: 'complete', from: current, to: current}]};
  const manifestText = '{"mdpkg":"markdown-package/1",' +
    canonicalJson(Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'mdpkg'))).slice(1);
  const entry = (name, content, stored = false) => ({name, bytes: typeof content === 'string' ? utf8.encode(content) : content, stored});
  const bytes = await writePackage([
    entry(MANIFEST, manifestText, true), entry(DETAIL, commentBytes),
    entry('.mdpkg/history.json', canonicalJson(history)), entry('.git/HEAD', 'ref: refs/heads/main\n'),
    entry('.git/config', '[core]\n\trepositoryformatversion = 0\n\tbare = false\n'),
    entry('.git/refs/heads/main', repo.commit + '\n'),
    entry('.git/objects/pack/' + repo.stem + '.idx', repo.index, true),
    entry('.git/objects/pack/' + repo.stem + '.pack', repo.pack, true),
  ]);
  await validateExport(bytes, pkg, snapshot);
  return bytes;
}

export async function validateExport(bytes, original, expected) {
  const result = await openContainer(bytesSource(bytes));
  if (result.tier !== 'conforming' || result.issues.length) throw new Error('Export failed container self-validation');
  const m = result.manifest, r = m.review;
  if (r?.shape !== 'delta' || r.of.namespace !== original.manifest.namespace || r.of.current !== original.manifest.current ||
      m.namespace === original.manifest.namespace) throw new Error('Export changed the reviewed identity');
  const names = result.entries.map(entry => entry.name);
  const fixed = [MANIFEST, DETAIL, '.mdpkg/history.json', '.git/HEAD', '.git/config', '.git/refs/heads/main'];
  const pack = names.find(name => /^\.git\/objects\/pack\/pack-[a-f0-9]{40}\.pack$/.test(name));
  if (!pack || names.length !== 8 || [...fixed, pack, pack.replace(/\.pack$/, '.idx')].some(name => !names.includes(name))) throw new Error('Unexpected delta entries');
  // Read every payload for CRC/extent validation. This deliberately does not
  // assert deep Git object/lineage integrity; the backend provides that check.
  for (const name of names) await result.read(name);
  const comments = readComments(await result.read(DETAIL));
  if (expected && canonicalJson(comments) !== canonicalJson(expected)) throw new Error('Export lost review content');
  await validateAnchors(comments, original);
  const h = parseCanonicalJson(await result.read('.mdpkg/history.json'));
  if (h.retainedCommits !== 1 || h.sourceBase !== m.current || h.sourceTip !== m.current || h.root !== 'original' ||
      h.walk !== 'first-parent' || h.shallowBoundaries?.length !== 0 || h.transformations?.length !== 0 || h.ranges?.length !== 0 ||
      h.patches?.length !== 0 || canonicalJson(h.addressingCoverage) !== canonicalJson([{coverage: 'complete', from: m.current, to: m.current}]) ||
      decode(await result.read('.git/HEAD')) !== 'ref: refs/heads/main\n' ||
      decode(await result.read('.git/refs/heads/main')) !== m.current.slice(5) + '\n') throw new Error('Invalid delta history or main reference');
  return result;
}
