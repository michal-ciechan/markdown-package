// Regenerate the shared loose-reference contract, consumed independently by Reader.
import fs from 'node:fs/promises';
import {outline} from '../src/address/outline.js';
import {defaultRoot} from '../src/address/root.js';
import {formatReference, encodeLocator} from '../src/address/reference.js';
import {utf8} from '../src/format.js';
const namespace = 'c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8', current = 'sha1-4d22851602b61c912a1616962e838147a7777fbf';
const source = 'Preamble.\n\n# Guide\n\n## Setup\n\nInstall here.\n';
const model = outline(utf8.encode(source), 'guide.md'), scope = model.scopes.at(-1);
const root = await defaultRoot(namespace, scope.locator), digest = await model.digest(scope);
const uri = formatReference(namespace, root, scope.locator, digest), birth = 'b'.repeat(64);
const cases = [];
function add(name, changes = {}, status = 'survives', reason = 'same-source', live = scope.locator) {
  cases.push({name, documents: {'guide.md': source}, coverage: 'complete', ledger: {}, uri,
    category: 'identity', status, reason, live, ...changes});
}
add('unchanged');
add('body-edit', {documents: {'guide.md': source.replace('Install here.', 'New body.')}}, 'flagged-changed', 'source-changed');
for (const [name, path, text] of [
  ['heading-move', 'guide.md', source.replace('Setup', 'Installation')],
  ['ancestor-move', 'guide.md', source.replace('# Guide', '# Manual')],
  ['file-move', 'other.md', source],
  ['cross-file-move', 'reference/storage.md', source.replace('Setup', 'Installation')],
]) {
  const moved = outline(utf8.encode(text), path), target = moved.scopes.at(-1).locator;
  add(name, {documents: {[path]: text}, ledger: {[root]: {to: target}}},
    (await moved.digest(moved.scopes.at(-1))) === digest ? 'survives' : 'flagged-changed', (await moved.digest(moved.scopes.at(-1))) === digest ? 'same-source' : 'source-changed', target);
}
add('move-back', {ledger: {[root]: {to: scope.locator}}});
for (const dead of ['deleted', 'split', 'merge']) add(dead, {ledger: {[root]: {dead, next: [birth]}}}, 'flagged-changed', dead, null);
add('unknown', {coverage: 'partial', ledger: {[root]: {unknown: 'unknown'}}}, 'unconfirmed', 'incomplete-correspondence', null);
add('missing-override', {uri: uri.replace(root, birth)}, 'unconfirmed', 'missing-override', null);
add('absent-target', {documents: {}}, 'unconfirmed', 'possibly-renamed-moved-or-deleted', null);
add('reserved-slot', {ledger: {[birth]: {to: scope.locator}}}, 'unconfirmed', 'reserved-slot', null);
add('reserved-birth', {ledger: {[root]: {dead: 'deleted'}, [birth]: {to: scope.locator}}, uri: uri.replace(root, birth)});
add('partial', {coverage: 'partial'}, 'unconfirmed', 'incomplete-correspondence', null);
add('partial-current-at', {coverage: 'partial', uri: uri + '&at=' + current}, 'unconfirmed', 'incomplete-correspondence', null);
add('current-at', {uri: uri + '&at=' + current});
add('historical-at', {uri: uri + '&at=sha1-' + '2'.repeat(40), category: 'capability'}, 'unsupported', 'history-reader-required', null);
add('locator-only', {uri: uri.replace('&expect=' + digest, ''), coverage: 'partial', ledger: {[root]: {dead: 'deleted'}},
  category: 'navigation'}, null, 'current-location');
for (const [name, changed] of [
  ['empty-expect', uri.replace(digest, '')], ['invalid-expect', uri.replace(digest, 'bad')],
  ['duplicate', uri + '&expect=' + digest], ['encoded-duplicate', uri + '&%65xpect=' + digest],
  ['unknown-param', uri + '&preview=true'], ['version', uri.replace('/v2/', '/v3/')],
  ['bad-percent', uri + '%'], ['profile', uri.replace('cm0312-source-lf-v1', 'other')],
  ['kind-disagreement', uri.replace('/section/', '/document/')],
  ['reserved-locator', uri.replace(encodeLocator(scope.locator), encodeLocator(['section', '.git/a.md', scope.trail]))],
]) add(name, {uri: changed}, 'invalidated', 'malformed-reference', null);
for (const [name, locator] of [
  ['locator-type', ['section', 42, [['# A', 0]]]],
  ['heading-cr', ['section', 'guide.md', [['# A\r', 0]]]],
  ['trail-depth', ['section', 'guide.md', Array.from({length: 7}, () => ['# A', 0])]],
  ['occurrence-type', ['section', 'guide.md', [['# A', '0']]]],
  ['locator-traversal', ['section', '../guide.md', [['# A', 0]]]],
]) add(name, {uri: uri.replace(encodeLocator(scope.locator), encodeLocator(locator))}, 'invalidated', 'malformed-reference', null);
add('foreign', {uri: uri.replace(namespace, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')}, 'invalidated', 'wrong-lineage', null);
for (const kind of ['commit', 'diff', 'hunk']) {
  const destination = kind === 'commit' ? current : `${current}..sha1-${'2'.repeat(40)}?document=${root}&profile=git-myers-u3-v1` +
    (kind === 'hunk' ? `&patch=${digest}&ordinal=0` : '');
  add(kind, {uri: `mdpkg://${namespace}/v2/${kind}/${destination}`, category: 'capability'}, 'unsupported', 'history-reader-required', null);
}
for (const target of model.scopes.slice(0, 2)) add(target.kind, {uri: formatReference(namespace,
  await defaultRoot(namespace, target.locator), target.locator, await model.digest(target))}, 'survives', 'same-source', target.locator);
const destinations = [
  ['guide.md', 'reference/storage.md#retention-policy', 'reference/storage.md', 'retention-policy'],
  ['reference/storage.md', '../guide.md', 'guide.md', ''], ['reference/storage.md', '/guide.md#Guide', 'guide.md', 'Guide'],
  ['guide.md', '', 'guide.md', ''], ['guide.md', '#', 'guide.md', ''], ['guide.md', '#retry-limits', 'guide.md', 'retry-limits'],
  ['guide.md', 'caf%C3%A9%20notes.md#%F0%9F%98%80', 'café notes.md', '😀'],
  ['reference/storage.md', '%2e%2e%2fguide.md', 'guide.md', ''],
].map(([source, href, path, fragment]) => ({source, href, path, fragment}));
for (const href of ['../a.md', '%2e%2e/a.md', '%2f%2fevil/a.md', '//evil/a.md', 'a%5cb.md',
  '.Git/a.md', '%2emdpkg/a.md', 'a.md?q=x', 'a.md%3fq=x', 'a%00.md', '%zz', 'a.md#%zz', 'javascript:alert(1)'])
  destinations.push({source: 'guide.md', href, invalid: true});
await fs.writeFile(process.argv[2] ?? new URL('../../../docs/spec/link-fixtures.json', import.meta.url),
  JSON.stringify({namespace, current: {id: current, kind: 'commit'}, cases, destinations}, null, 2) + '\n');
