import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {makeSelector, anchorRange} from '../src/review/selector.js';
import {newReview, newComment, newThread, validateComments, validateAnchors, readComments, DETAIL} from '../src/review/comments.js';
import {emitReview, validateExport} from '../src/review/emit.js';
import {openPackage} from '../src/inbound/open.js';
import {outline} from '../src/address/outline.js';
import {canonicalJson, utf8} from '../src/format.js';
import {writePackage} from '../src/container/writer.js';
import {defaultRoot} from '../src/address/root.js';

const fixture = new URL('../../../docs/spec/review-fixtures/original.mdpkg', import.meta.url);
const original = new Uint8Array(await fs.readFile(fixture));
const pkg = await openPackage(new Blob([original]));
const model = await pkg.document('guide.md');
async function authored() {
  const doc = newReview(), start = model.text.indexOf('target words');
  const first = newComment('Reviewer', 'change-request', 'Explain these words.');
  doc.threads.push(await newThread(pkg, model, anchorRange(model, start, start + 12), first));
  doc.threads[0].comments.push(newComment('Responder', 'comment', 'An ordered reply.', first.id));
  return doc;
}

test('selector matches independent Unicode fixture and probe offsets', async () => {
  const vector = JSON.parse(await fs.readFile(new URL('../../../docs/spec/review-fixtures/comments-v2.json', import.meta.url), 'utf8'));
  assert.deepEqual(makeSelector(model.text, 28, 40), vector.threads[0].select);
  assert.deepEqual(makeSelector('## Usage\n\nRun `build` to produce a package.\nRun `check` to validate it.\n', 25, 42),
    {start: 25, end: 42, quote: 'produce a package', occurrence: 0, prefix: '## Usage\n\nRun `build` to ', suffix: '.\nRun `check` to validate it.\n'});
});
test('repeated and overlapping quotes preserve occurrence', () => {
  assert.equal(makeSelector('aaaa', 2, 4).occurrence, 2);
  assert.equal(makeSelector('yes yes yes', 8, 11).occurrence, 2);
});
test('surrogate endpoints reject; context truncates without splitting pairs', () => {
  assert.throws(() => makeSelector('a😀b', 1, 2));
  assert.throws(() => makeSelector('a😀b', 2, 3));
  assert.throws(() => makeSelector('x', 0, 0));
  assert.throws(() => makeSelector('x', 0, 2));
  assert.equal(makeSelector('😀' + 'a'.repeat(39) + 'Q' + 'b'.repeat(39) + '😀', 41, 42).prefix.length, 39);
  assert.equal(makeSelector('Q' + 'b'.repeat(39) + '😀', 0, 1).suffix.length, 39);
});
test('canonical CRLF/BOM, Setext, duplicates, common ancestor and empty preamble', () => {
  const m = outline(utf8.encode('\uFEFFIntro\r\n\r\nTitle\r\n=====\r\n\r\n## Same\r\none\r\n\r\n## Same\r\ntwo\r\n\r\n'), 'a.md');
  const one = m.text.indexOf('one'), two = m.text.indexOf('two');
  assert.equal(anchorRange(m, one, one + 3).scope.trail.at(-1)[1], 0);
  assert.equal(anchorRange(m, two, two + 3).scope.trail.at(-1)[1], 1);
  assert.equal(anchorRange(m, one, two + 3).scope.title, 'Title\n=====');
  assert.equal(anchorRange(m, 0, 1).select.quote, '\uFEFF');
  assert.throws(() => makeSelector('', 0, 0));
});
test('v2 authoring preserves kinds, replies, states and canonical round trip', async () => {
  const doc = await authored(); doc.threads[0].state = 'obsolete';
  assert.deepEqual(validateComments(JSON.parse(canonicalJson(doc))), doc);
  await validateAnchors(doc, pkg);
});

test('empty comment arrays and bodies are accepted only when reading version 1', async () => {
  for (const empty of ['array', 'body']) {
    const doc = await authored();
    if (empty === 'array') doc.threads[0].comments = [];
    else doc.threads[0].comments[0].body = '';
    assert.throws(() => readComments(utf8.encode(canonicalJson(doc))));
    doc.version = 1;
    for (const c of doc.threads[0].comments) delete c.kind;
    assert.deepEqual(readComments(utf8.encode(canonicalJson(doc))), doc);
    assert.throws(() => validateComments(doc), /unsupported/);
  }
});

test('timestamps preserve the schema grammar, calendar and 128-character boundary', async () => {
  const doc = await authored(), comment = doc.threads[0].comments[0];
  const atLimit = '2016-12-31T23:59:60.' + '1'.repeat(107) + 'Z';
  assert.equal(atLimit.length, 128);
  for (const at of ['2016-12-31T23:59:60Z', '2017-01-01T00:59:60.123+01:00',
    '2016-12-31T18:59:60-05:00', '2000-02-29T12:00:00Z', '0004-02-29T00:00:00Z',
    '0001-01-01T00:00:00+23:59', '9999-12-31T23:59:59-23:59', atLimit]) {
    comment.at = at;
    assert.equal(readComments(utf8.encode(canonicalJson(doc))).threads[0].comments[0].at, at);
  }
  for (const at of ['2016-12-31T23:59:61Z', '2016-12-31T24:00:00Z', '2016-12-31T23:60:00Z',
    '2016-12-31T23:59:60+24:00', '2016-12-31T23:59:60+00:60', '2016-12-31T23:59:60',
    '2016-12-31t23:59:60Z', '2016-12-31T23:59:60z', '2016-12-31T23:59:60.Z',
    '2016-12-31T23:59:60Z\n', '1900-02-29T00:00:60Z', '0000-01-01T00:00:00Z',
    '2026-02-30T12:00:00Z', '2026-00-01T00:00:00Z', '2026-13-01T00:00:00Z',
    '2026-01-00T00:00:00Z', atLimit.replace('Z', '1Z')]) {
    comment.at = at;
    assert.throws(() => readComments(utf8.encode(canonicalJson(doc))), /timestamp/, at);
  }
});
test('authoring uses live ledger roots and rejects reserved slots without birth overrides', async () => {
  const start = model.text.indexOf('target words'), anchor = anchorRange(model, start, start + 12);
  const live = 'f'.repeat(64), ledger = new Map([[live, {to: anchor.scope.locator}]]);
  const moved = {...pkg, ledger: async () => ledger};
  const thread = await newThread(moved, model, anchor, newComment('A', 'comment', 'Body'));
  assert.equal(thread.root, live);
  const reserved = await defaultRoot(pkg.manifest.namespace, anchor.scope.locator);
  ledger.clear(); ledger.set(reserved, {dead: 'deleted'});
  await assert.rejects(newThread(moved, model, anchor, newComment('A', 'comment', 'Body')), /reserved root/);
});
for (const mutation of ['kind', 'duplicate', 'empty', 'dangling', 'cycle', 'timestamp', 'surrogate', 'limit']) {
  test('reject malformed comments: ' + mutation, async () => {
    const doc = await authored(), t = doc.threads[0], c = t.comments[0];
    if (mutation === 'kind') c.kind = 'patch';
    if (mutation === 'duplicate') c.id = t.id;
    if (mutation === 'empty') t.comments = [];
    if (mutation === 'dangling') c.inReplyTo = crypto.randomUUID();
    if (mutation === 'cycle') c.inReplyTo = t.comments[1].id;
    if (mutation === 'timestamp') c.at = '2026-02-30T12:00:00.000Z';
    if (mutation === 'surrogate') c.body = '\uD800';
    if (mutation === 'limit') c.body = 'x'.repeat(65537);
    assert.throws(() => validateComments(doc));
  });
}
test('reject source evidence mutations and cross-thread replies', async () => {
  for (const field of ['quote', 'prefix', 'occurrence']) {
    const doc = await authored(); doc.threads[0].select[field] = field === 'occurrence' ? 3 : 'wrong';
    await assert.rejects(validateAnchors(doc, pkg));
  }
  const doc = await authored(), other = await authored();
  doc.threads.push(other.threads[0]); doc.threads[0].comments[0].inReplyTo = other.threads[0].comments[0].id;
  assert.throws(() => validateComments(doc));
});
test('writer round trip, snapshot identity, original preservation and corruption refusal', async () => {
  const doc = await authored();
  const bytes = await emitReview(pkg, doc, {namespace: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});
  const opened = await validateExport(bytes, pkg, doc);
  assert.equal(opened.manifest.review.shape, 'delta');
  assert.deepEqual(original, new Uint8Array(await fs.readFile(fixture)));
  const corrupt = bytes.slice(); corrupt[60] ^= 1;
  await assert.rejects(validateExport(corrupt, pkg, doc));
  const entries = await Promise.all(opened.entries.map(async e => ({name: e.name, bytes: await opened.read(e.name), stored: e.method === 0})));
  entries.find(e => e.name === DETAIL).bytes = utf8.encode(canonicalJson({...doc, version: 7}));
  await assert.rejects(validateExport(await writePackage(entries), pkg, doc));
  await fs.mkdir(new URL('../test-results/', import.meta.url), {recursive: true});
  await fs.writeFile(new URL('../test-results/node-review.mdpkg', import.meta.url), bytes);
});
test('STORE fallback remains a conforming review export', async () => {
  const native = globalThis.CompressionStream;
  globalThis.CompressionStream = class { constructor(format) {
    if (format === 'deflate-raw') throw new Error('Unsupported raw compression');
    return new native(format);
  } };
  try { await validateExport(await emitReview(pkg, await authored()), pkg); }
  finally { globalThis.CompressionStream = native; }
});
