import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {openContainer} from '../src/container/reader.js';
import {bytesSource, blobSource} from '../src/container/source.js';
import {writePackage} from '../src/container/writer.js';
import {snapshotIdentity} from '../src/container/snapshot.js';
import {canonicalJson, utf8, MANIFEST} from '../src/format.js';
import {openPackage} from '../src/inbound/open.js';
import {referenceFor} from '../src/address/resolve.js';
import {emitReview, validateExport} from '../src/review/emit.js';
import {newReview, readComments} from '../src/review/comments.js';
import {resolveDestination} from '../src/links/resolve.js';
import {previewMarkup} from '../src/ui/markdown-surface.js';

const vectors = JSON.parse(await fs.readFile(new URL('../../../docs/investigations/deferred-history/breaking-revision-vectors.json', import.meta.url), 'utf8'));
const fixture = name => fs.readFile(new URL('../../../docs/spec/review-fixtures/' + name, import.meta.url));
for (const name of ['delta-v1.mdpkg', 'delta-v2.mdpkg', 'delta-snapshot-target-commit.mdpkg', 'ledger-snapshot.mdpkg'])
  test('S1 snapshot schema and payloads: ' + name, async () => {
    const opened = await openContainer(bytesSource(await fixture(name)));
    await opened.verifySnapshot(); assert.equal(opened.assurance, 'snapshot-verified');
  });
async function packageBytes(manifest, sources) {
  const {mdpkg, ...rest} = manifest;
  return writePackage([{name: MANIFEST, bytes: utf8.encode('{"mdpkg":' + JSON.stringify(mdpkg) + ',' + canonicalJson(rest).slice(1)), stored: true},
    ...Object.entries(sources).map(([name, text]) => ({name, bytes: utf8.encode(text)}))]);
}
for (const c of vectors.invalidCases.filter(c => c.target === 'manifest')) test('S1 rejects manifest: ' + c.name, async () => {
  const base = await openContainer(bytesSource(await fixture(c.base)));
  const sources = Object.fromEntries(await Promise.all(base.entries.filter(e => !e.directory && e.name !== MANIFEST)
    .map(async e => [e.name, new TextDecoder().decode(await base.read(e.name))])));
  await assert.rejects(openContainer(bytesSource(await packageBytes(c.value, sources))));
});

test('canonical JSON refuses unpaired surrogates in values and property names', () => {
  assert.throws(() => canonicalJson({value: '\uD800'}), /Unicode/);
  assert.throws(() => canonicalJson({'\uD800': 'value'}), /Unicode/);
});
for (const vector of vectors.vectors) test('S1 exact snapshot hash and verification: ' + vector.name, async () => {
  const m = JSON.parse(vector.snapshotManifestCanonical);
  assert.equal(await snapshotIdentity(m, Object.keys(vector.sources).reverse(), async name => utf8.encode(vector.sources[name])), vector.snapshotId);
  const opened = await openContainer(bytesSource(await packageBytes(m, vector.sources)));
  assert.equal(opened.assurance, 'declared');
  await opened.verifySnapshot();
  assert.equal(opened.assurance, 'snapshot-verified');
});

for (const c of vectors.hashCases.filter(c => c.expected !== 'reject-before-hashing')) test('S1 hash mutation: ' + c.name, async () => {
  const v = vectors.vectors.find(v => v.name === c.base), m = JSON.parse(v.snapshotManifestCanonical), files = {...v.sources};
  if (c.target.startsWith('sources/')) files[c.target.slice(8)] = c.value;
  else if (c.target.startsWith('rename/')) { files[c.value] = files[c.target.slice(7)]; delete files[c.target.slice(7)]; }
  else if (c.target.startsWith('header/')) {
    const keys = c.target.slice(7).split('/'); let object = m;
    for (const key of keys.slice(0, -1)) object = object[key];
    object[keys.at(-1)] = c.value;
  }
  assert.equal(await snapshotIdentity(m, Object.keys(files), async name => utf8.encode(files[name])), c.expectedId);
});

for (const change of ['string-current', 'namespace-array', 'kind', 'history', 'coverage', 'extra', 'current-extra', 'review-null', 'git-entry', 'history-entry', 'sidecar', 'nonmarkdown', 'markdown']) {
  test('schema or explicit verification rejects ' + change, async () => {
    const v = vectors.vectors[0], m = JSON.parse(v.snapshotManifestCanonical), files = {...v.sources};
    if (change === 'string-current') m.current = m.current.id;
    if (change === 'namespace-array') m.namespace = [m.namespace];
    if (change === 'kind') m.current.kind = 'commit';
    if (change === 'history') m.history.coverage = 'complete';
    if (change === 'coverage') m.addressing.coverage = 'partial';
    if (change === 'extra') m.unknown = true;
    if (change === 'current-extra') m.current.unknown = true;
    if (change === 'review-null') m.review = null;
    if (change === 'git-entry') files['.git/HEAD'] = 'ref: refs/heads/main\n';
    if (change === 'history-entry') files['.mdpkg/history.json'] = '{}\n';
    if (change === 'sidecar') files['.mdpkg/review/other.json'] = '{}\n';
    if (change === 'nonmarkdown') files['hidden.txt'] = 'injected\n';
    if (change === 'markdown') files['guide.md'] += 'injected\n';
    const bytes = await packageBytes(m, files);
    if (['nonmarkdown', 'markdown'].includes(change)) {
      const opened = await openContainer(bytesSource(bytes));
      assert.equal(opened.assurance, 'declared');
      await assert.rejects(opened.verifySnapshot(), /identity/);
      assert.equal(opened.assurance, 'declared');
    } else await assert.rejects(openContainer(bytesSource(bytes)));
  });
}

test('explicit verification respects aggregate budgets and caller mutation cannot change captured bytes', async () => {
  const bytes = new Uint8Array(await fixture('original.mdpkg'));
  const opened = await openContainer(bytesSource(bytes)); bytes.fill(0);
  await assert.rejects(opened.verifySnapshot({maxDecodedBytes: 1}), /limit/);
  assert.equal(opened.assurance, 'declared');
  await opened.verifySnapshot(); assert.equal(opened.assurance, 'snapshot-verified');
});

test('a mutable custom source cannot earn assurance; Blob subclasses cannot replace captured data', async () => {
  const bytes = await fixture('original.mdpkg'), source = bytesSource(bytes);
  const custom = await openContainer({...source});
  await assert.rejects(custom.verifySnapshot(), /immutable/);
  assert.equal(custom.assurance, 'declared');
  class ChangingBlob extends Blob { slice() { throw new Error('Caller slice must not run'); } }
  const input = new ChangingBlob([bytes]);
  const owned = blobSource(input), opened = await openContainer(owned);
  assert.throws(() => { owned.read = async () => new Uint8Array(); }, TypeError);
  await opened.verifySnapshot(); assert.equal(opened.assurance, 'snapshot-verified');
});

for (const timing of ['before', 'during']) test('verification ignores substituted public readers and metadata ' + timing + ' verification', async () => {
  const good = await openContainer(bytesSource(await fixture('original.mdpkg')));
  const files = await Promise.all(good.entries.filter(e => !e.directory)
    .map(async e => ({name: e.name, bytes: await good.read(e.name), stored: true})));
  files.find(e => e.name === 'guide.md').bytes = utf8.encode('# Changed current file\n');
  const bad = await openContainer(bytesSource(await writePackage(files))), actualRead = bad.read;
  await assert.rejects(bad.verifySnapshot(), /identity/);
  const pending = timing === 'during' ? bad.verifySnapshot() : null;
  bad.read = good.read;
  bad.readDirectory = good.readDirectory;
  bad.manifest = good.manifest;
  bad.entries = good.entries;
  bad.byName.clear();
  await assert.rejects(pending ?? bad.verifySnapshot(), /identity/);
  bad.read = actualRead;
  assert.equal(bad.assurance, 'declared');
  assert.equal(new TextDecoder().decode(await bad.read('guide.md')), '# Changed current file\n');
});

test('verification and subsequent reads retain private ledger metadata despite public mutation', async () => {
  const opened = await openContainer(bytesSource(await fixture('ledger-snapshot.mdpkg')));
  const manifest = opened.manifest, read = opened.read;
  const expected = await read(manifest.addressing.overrides);
  const pending = opened.verifySnapshot();
  opened.manifest = null;
  opened.entries = [];
  opened.byName.clear();
  opened.read = opened.readDirectory = () => { throw new Error('Public reader must not run'); };
  assert.deepEqual((await pending).current, manifest.current);
  assert.equal(opened.assurance, 'snapshot-verified');
  opened.read = read;
  assert.deepEqual(await opened.read(manifest.addressing.overrides), expected);
  await opened.verifySnapshot();
});

test('an overridden ArrayBuffer slice cannot retain caller storage after verification', async () => {
  const raw = await fixture('original.mdpkg');
  const input = Uint8Array.from(raw).buffer;
  let calls = 0;
  input.slice = () => { calls++; return input; };
  const source = bytesSource(input), opened = await openContainer(source);
  const expected = await opened.read('guide.md');
  await opened.verifySnapshot();
  new Uint8Array(input).fill(0);
  assert.equal(calls, 0);
  assert.equal((await source.read(0, 1))[0], raw[0]);
  assert.deepEqual(await opened.read('guide.md'), expected);
  assert.equal(opened.assurance, 'snapshot-verified');
  await opened.verifySnapshot();
});

for (const change of ['leap-second', 'v1-empty-body', 'v1-empty-thread']) test('snapshot accepts schema-permitted comments: ' + change, async () => {
  const original = await openContainer(bytesSource(await fs.readFile(new URL('./fixtures/browser-v2.mdpkg', import.meta.url))));
  const manifest = structuredClone(original.manifest), detail = manifest.review.detail;
  const comments = readComments(await original.read(detail));
  if (change === 'leap-second') comments.threads[0].comments[0].at = '2016-12-31T23:59:60Z';
  else {
    comments.version = 1;
    for (const thread of comments.threads) for (const comment of thread.comments) delete comment.kind;
    if (change === 'v1-empty-body') comments.threads[0].comments[0].body = '';
    else comments.threads[0].comments = [];
  }
  const content = canonicalJson(comments);
  manifest.current.id = await snapshotIdentity(manifest, [detail], async () => utf8.encode(content));
  const opened = await openContainer(bytesSource(await packageBytes(manifest, {[detail]: content})));
  await opened.verifySnapshot();
  assert.equal(opened.assurance, 'snapshot-verified');
  assert.deepEqual(readComments(await opened.read(detail)), comments);
});

for (const name of ['original.mdpkg', 'original-git.mdpkg']) test('current links and snapshot review export target typed ' + name, async () => {
  const pkg = await openPackage(new Blob([await fixture(name)]));
  const model = await pkg.document('guide.md'), ref = await referenceFor(pkg, model, model.scopes[0]);
  assert.equal((await pkg.resolve(ref, {observedAt: structuredClone(pkg.manifest.current)})).status, 'survives');
  assert.equal((await pkg.resolve(ref + '&at=' + pkg.manifest.current.id)).status,
    pkg.manifest.current.kind === 'commit' ? 'survives' : 'unsupported');
  const preview = await resolveDestination(pkg, 'guide.md', 'guide.md#usage');
  assert.equal(preview.category, 'navigation');
  assert.match(previewMarkup(preview.document, preview.scope).html, /Use the tool/);
  const different = {kind: 'snapshot', id: 'sha256-' + '0'.repeat(64)};
  assert.equal((await pkg.resolve(ref, {observedAt: different})).status, 'unconfirmed');
  assert.equal((await pkg.resolve(ref + '&at=sha1-' + '0'.repeat(40))).status, 'unsupported');
  if (pkg.manifest.current.kind === 'commit') {
    await assert.rejects(pkg.verifySnapshot(), /history backend/); assert.equal(pkg.assurance, 'declared');
  }
  const bytes = await emitReview(pkg, newReview()), result = await validateExport(bytes, pkg);
  assert.equal(result.entries.length, 2); assert.equal(result.assurance, 'snapshot-verified');
  assert.deepEqual(result.manifest.review.of.current, pkg.manifest.current);
});
