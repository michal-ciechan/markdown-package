import {test} from 'node:test';
import assert from 'node:assert/strict';
import {packageKey, databaseName, validateDraft, debounce, encodeDraft, recoveryText} from '../src/persistence/model.js';

const manifest = {mdpkg: 'markdown-package/1', namespace: 'one', current: 'snapshot', addressing: {anchor: 'a', digest: 'd'}};
test('package identity is an unambiguous tuple and ignores filenames', () => {
  assert.equal(packageKey(manifest), packageKey({...manifest, filename: 'renamed.mdpkg'}));
  for (const field of ['mdpkg', 'namespace', 'current']) assert.notEqual(packageKey(manifest), packageKey({...manifest, [field]: 'different'}));
  assert.notEqual(packageKey(manifest), packageKey({...manifest, addressing: {...manifest.addressing, digest: 'other'}}));
  assert.notEqual(packageKey({...manifest, namespace: 'a|b', current: 'c'}), packageKey({...manifest, namespace: 'a', current: 'b|c'}));
  assert.equal(databaseName('https://example.com/viewer/index.html'), 'mdpkg-viewer:/viewer/');
  assert.notEqual(databaseName('https://example.com/a/'), databaseName('https://example.com/b/'));
});
test('unfinished editors preserve incomplete names, whitespace and Unicode with bounded bodies', () => {
  const draft = {version: 1, namespace: '11111111-1111-1111-1111-111111111111', target: ['reply'], author: '', kind: 'change-request', body: ' \n😀 café\t '};
  assert.equal(validateDraft(draft).body, draft.body);
  assert.throws(() => validateDraft({...draft, version: 2}));
  assert.throws(() => validateDraft({...draft, body: 'x'.repeat(256 * 1024 + 1)}));
});
test('reply identity excludes form fields and includes the exact parent', async () => {
  const namespace = '11111111-1111-1111-1111-111111111111';
  const draft = {context: {model: {text: 'document'}, thread: {id: 'thread'}, inReplyTo: 'parent'}, author: '', kind: 'comment', body: ''};
  const first = await encodeDraft(undefined, namespace, draft);
  assert.equal(first.targetKey, (await encodeDraft(undefined, namespace, {...draft, author: 'changed', kind: 'change-request', body: 'new'})).targetKey);
  assert.notEqual(first.targetKey, (await encodeDraft(undefined, namespace, {...draft, context: {...draft.context, inReplyTo: 'another'}})).targetKey);
});
test('debounce saves continuous input by maxWait and cancel defeats trailing writes', () => {
  let time = 0, id = 0, calls = [];
  const queue = new Map(), timers = {setTimeout(fn, delay) { queue.set(++id, {fn, at: time + delay}); return id; }, clearTimeout(id) { queue.delete(id); }};
  function tick(delta) {
    const end = time + delta;
    while (true) {
      const next = [...queue].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      time = next[1].at; queue.delete(next[0]); next[1].fn();
    }
    time = end;
  }
  const timer = debounce(() => calls.push(time), 400, 1500, timers);
  timer.schedule(); for (let i = 0; i < 5; i++) { tick(300); timer.schedule(); }
  assert.deepEqual(calls, [1500]); timer.cancel(); tick(500); assert.deepEqual(calls, [1500]);
  timer.schedule(); tick(100); timer.flush(); tick(2000); assert.deepEqual(calls, [1500, 2100]);
});

test('malformed cyclic recovery data cannot prevent an otherwise valid package open', () => {
  const record = {body: 'Recover exactly this text'}; record.cycle = record;
  assert.equal(recoveryText(record), record.body);
  assert.match(recoveryText({deep: record}), /retained in browser storage/);
});
