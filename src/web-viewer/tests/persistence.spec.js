import {test, expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {openPackage} from '../src/inbound/open.js';
import {writePackage} from '../src/container/writer.js';
import {canonicalJson, utf8} from '../src/format.js';

const bytes = await fs.readFile('../../docs/spec/review-fixtures/original.mdpkg');
const original = await openPackage(new Blob([bytes]));
const reserved = await Promise.all(original.entries.filter(e => e.name.startsWith('.')).map(async e =>
  ({name: e.name, bytes: await original.read(e.name), stored: e.method === 0})));
const file = (buffer = bytes, name = 'original.mdpkg') => ({name, mimeType: 'application/octet-stream', buffer});
async function packageWith(documents, changes = {}) {
  const manifest = {...original.manifest, ...changes};
  const {mdpkg, ...rest} = manifest;
  return Buffer.from(await writePackage([{...reserved[0], bytes: utf8.encode('{"mdpkg":' + JSON.stringify(mdpkg) + ',' + canonicalJson(rest).slice(1))},
    ...Object.entries(documents).map(([name, text]) => ({name, bytes: utf8.encode(text)})), ...reserved.slice(1)]));
}
async function open(page, input = file()) {
  await page.goto('/');
  await page.locator('#package-file').setInputFiles(input);
  await expect(page.locator('.document-title')).not.toBeEmpty();
}
async function rows(page, name) {
  return page.evaluate(async name => { const {openStore} = await import('/test-api.js'); const db = await openStore();
    try { return await db.all(name); } finally { db.close(); } }, name);
}
async function edit(page, body = 'Draft 😀 café\n  with whitespace  ') {
  await page.getByRole('button', {name: 'Review selected section', exact: true}).click();
  await page.getByLabel('Your name').fill('Reviewer');
  await page.getByLabel('Feedback', {exact: true}).fill(body);
}
async function saved(page) { await expect(page.locator('.local-save-status')).toHaveText('Saved in this browser'); }
async function reloadAttach(page, input = file()) {
  await page.reload();
  await expect(page.getByRole('button', {name: 'Choose file again', exact: true})).toBeVisible();
  await page.locator('#package-file').setInputFiles(input);
  await expect(page.locator('.document-title')).not.toBeEmpty();
}

test('file-only reload restores exact unfinished input; same snapshot renamed deduplicates', async ({page}) => {
  await open(page); await edit(page, ' \n😀 café\t ');
  await page.getByLabel('Your name').fill('');
  await page.getByLabel('Kind', {exact: true}).selectOption('change-request');
  const quote = await page.locator('.review-editor .review-quote').textContent();
  await saved(page);
  await reloadAttach(page, file(bytes, 'renamed.mdpkg'));
  await expect(page.getByLabel('Feedback', {exact: true})).toHaveValue(' \n😀 café\t ');
  await expect(page.getByLabel('Your name')).toHaveValue('');
  await expect(page.getByLabel('Kind', {exact: true})).toHaveValue('change-request');
  await expect(page.locator('.review-editor .review-quote')).toHaveText(quote);
  expect((await rows(page, 'packages')).filter(p => !p.removed)).toHaveLength(1);
  expect(await rows(page, 'handles')).toHaveLength(0);
  expect(await page.evaluate(async () => {
    const {openStore} = await import('/test-api.js'); const db = await openStore();
    function hasBlob(value) { return value instanceof Blob || (value && typeof value === 'object' && Object.values(value).some(hasBlob)); }
    try { return (await Promise.all(['packages', 'positions', 'reviews', 'drafts', 'resume', 'conflicts'].map(n => db.all(n)))).some(hasBlob); }
    finally { db.close(); }
  })).toBe(false);
});

test('committed checkpoint survives closing a page; new page resumes after reattachment', async ({page, context}) => {
  await open(page); await edit(page, 'Committed checkpoint'); await saved(page);
  await page.close();
  const next = await context.newPage(); await next.goto('/');
  await expect(next.getByRole('button', {name: 'Choose file again', exact: true})).toBeVisible();
  await next.locator('#package-file').setInputFiles(file());
  await expect(next.getByLabel('Feedback', {exact: true})).toHaveValue('Committed checkpoint');
});

test('submitted review, reply parent IDs, state and namespace survive with atomic draft deletion', async ({page}) => {
  await open(page); await edit(page, 'Parent feedback'); await saved(page);
  await page.getByRole('button', {name: 'Save comment', exact: true}).click(); await saved(page);
  const first = (await rows(page, 'reviews'))[0];
  expect((await rows(page, 'drafts'))[0].tombstone).toBe(true);
  await page.getByLabel('Thread state', {exact: true}).selectOption('resolved');
  await page.getByRole('button', {name: 'Reply', exact: true}).click();
  await page.getByLabel('Feedback', {exact: true}).fill('Recovered reply'); await saved(page);
  await reloadAttach(page);
  await expect(page.getByLabel('Thread state', {exact: true})).toHaveValue('resolved');
  await expect(page.getByLabel('Feedback', {exact: true})).toHaveValue('Recovered reply');
  await page.getByRole('button', {name: 'Save comment', exact: true}).click(); await saved(page);
  const restored = (await rows(page, 'reviews'))[0];
  expect(restored.namespace).toBe(first.namespace);
  expect(restored.review.threads[0].id).toBe(first.review.threads[0].id);
  expect(restored.review.threads[0].comments[1].inReplyTo).toBe(first.review.threads[0].comments[0].id);
  await reloadAttach(page);
  await expect(page.locator('.review-comment')).toHaveCount(2);
  await expect(page.locator('.review-editor')).toBeHidden();
  await page.getByRole('button', {name: 'Prepare review file'}).click();
  await expect(page.getByRole('button', {name: 'Download review'})).toBeVisible();
});

test('Cancel cannot be resurrected by a pending debounce or reload', async ({page}) => {
  await open(page); await edit(page, 'Durable old draft'); await saved(page);
  await page.getByLabel('Feedback', {exact: true}).fill('Late input');
  await page.getByRole('button', {name: 'Cancel', exact: true}).click(); await saved(page);
  expect((await rows(page, 'drafts')).every(d => d.tombstone)).toBe(true);
  await reloadAttach(page);
  await expect(page.locator('.review-editor')).toBeHidden();
});

test('invalid candidate preserves editor, recents and current package', async ({page}) => {
  await open(page); await edit(page, 'Keep this work'); await saved(page);
  const before = await rows(page, 'packages');
  await page.locator('#package-file').setInputFiles(file(Buffer.from('not a zip'), 'broken.mdpkg'));
  await expect(page.locator('#activity')).toContainText('Could not open package');
  await expect(page.getByLabel('Feedback', {exact: true})).toHaveValue('Keep this work');
  expect(await rows(page, 'packages')).toEqual(before);
});

test('different snapshot identity never receives old work and mismatch requires an explicit action', async ({page}) => {
  await open(page); await edit(page, 'Only for the original'); await saved(page);
  await page.reload();
  await expect(page.getByRole('button', {name: 'Choose file again', exact: true})).toBeVisible();
  // File chooser events are intercepted only to supply deterministic test files.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', {name: 'Choose file again', exact: true}).click();
  const other = await packageWith({'guide.md': '# Other\n\nDifferent snapshot\n'}, {namespace: '22222222-2222-2222-2222-222222222222'});
  await (await chooser).setFiles(file(other));
  await expect(page.locator('.resume-offer')).toContainText('different package/version');
  expect(await rows(page, 'packages')).toHaveLength(1);
  await page.getByRole('button', {name: 'Open as separate package'}).click();
  await expect(page.locator('#reader article')).toContainText('Different snapshot');
  await expect(page.locator('.review-editor')).toBeHidden();
  expect(await rows(page, 'packages')).toHaveLength(2);
  expect((await rows(page, 'drafts')).filter(d => !d.tombstone)).toHaveLength(1);
});

test('changed text under the same declared identity preserves feedback for recovery', async ({page}) => {
  await open(page); await edit(page, 'Do not relocate me'); await saved(page);
  const changed = await packageWith({'guide.md': '# Changed\n\nDifferent text\n'});
  await reloadAttach(page, file(changed));
  await expect(page.locator('.saved-recovery')).toContainText('Saved work could not be restored');
  await expect(page.getByLabel('Saved text for recovery')).toHaveValue(/Do not relocate me/);
  await expect(page.locator('.review-editor')).toBeHidden();
  expect((await rows(page, 'drafts')).filter(d => !d.tombstone)).toHaveLength(1);
});

test('two tabs preserve conflicting text and deletion defeats stale writers', async ({page, context}) => {
  await open(page); await edit(page, 'Shared checkpoint'); await saved(page);
  const other = await context.newPage(); await open(other);
  await expect(other.getByLabel('Feedback', {exact: true})).toHaveValue('Shared checkpoint');
  await page.getByLabel('Feedback', {exact: true}).fill('Tab one wins'); await saved(page);
  await other.getByLabel('Feedback', {exact: true}).fill('Tab two recovery');
  await expect(other.locator('.local-save-status')).toContainText('Another tab changed');
  expect((await rows(page, 'drafts')).find(d => !d.tombstone).body).toBe('Tab one wins');
  expect((await rows(page, 'conflicts'))[0].snapshot.draft.body).toBe('Tab two recovery');
  await other.close({runBeforeUnload: false});
  const stale = await context.newPage(); await open(stale);
  await page.locator('#saved-sessions summary').first().click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', {name: 'Delete saved work', exact: true}).click();
  await expect.poll(async () => (await rows(page, 'drafts')).length).toBe(0);
  await stale.getByLabel('Feedback', {exact: true}).fill('After deletion');
  await expect(stale.locator('.local-save-status')).toContainText('Another tab changed');
  expect(await rows(page, 'drafts')).toHaveLength(0);
  expect((await rows(page, 'conflicts'))[0].snapshot.draft.body).toBe('After deletion');
});

test('draft switch during another tab restore keeps the active draft and recovers stale input', async ({page, context}) => {
  await open(page); await edit(page, 'Draft A'); await saved(page);
  const other = await context.newPage(); await other.goto('/');
  await expect(other.getByRole('button', {name: 'Choose file again', exact: true})).toBeVisible();
  await other.evaluate(() => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(names, mode, ...args) {
      const tx = transaction.call(this, names, mode, ...args);
      if (mode === 'readonly' && [...tx.objectStoreNames].includes('packages') && !window.pausedRestore) {
        window.pausedRestore = true;
        // Delay only delivery of completion, after the real transaction has read
        // A and released its locks. Tab 1 can now commit Cancel and draft B.
        Object.defineProperty(tx, 'oncomplete', {set(callback) {
          tx.addEventListener('complete', event => { window.releaseRestore = () => callback.call(tx, event); });
        }});
      }
      return tx;
    };
  });
  await other.locator('#package-file').setInputFiles(file());
  await expect.poll(() => other.evaluate(() => typeof window.releaseRestore)).toBe('function');
  await page.getByRole('button', {name: 'Cancel', exact: true}).click(); await saved(page);
  await page.getByLabel('Document section').selectOption('2');
  await edit(page, 'Draft B must remain discoverable'); await saved(page);
  const b = (await rows(page, 'drafts')).find(d => !d.tombstone);
  await other.evaluate(() => window.releaseRestore());
  await expect(other.locator('.document-title')).toHaveText('guide.md');
  // A, its review and its pointer came from the same completed snapshot.
  // The old torn read instead restored no editor. The next write must conflict.
  await expect(other.getByLabel('Feedback', {exact: true})).toHaveValue('Draft A');
  await other.getByLabel('Feedback', {exact: true}).fill('Draft C from torn hydration');
  await expect(other.locator('.local-save-status')).toContainText('Another tab changed');
  const p = (await rows(page, 'packages'))[0];
  expect(p.activeDraftKey).toBe(b.targetKey);
  expect((await rows(page, 'resume'))[0].activeDraftKey).toBe(b.targetKey);
  expect((await rows(page, 'drafts')).filter(d => !d.tombstone)).toEqual([b]);
  const conflicts = await rows(page, 'conflicts');
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0].snapshot.draft.body).toBe('Draft C from torn hydration');
  await other.locator('.saved-recovery summary').click();
  await expect(other.getByLabel('Saved text for recovery')).toHaveValue(/Draft C from torn hydration/);
  await other.close({runBeforeUnload: false});
  await reloadAttach(page);
  await expect(page.getByLabel('Feedback', {exact: true})).toHaveValue('Draft B must remain discoverable');
});

test('active pointer mismatch conflicts even with the current review revision', async ({page}) => {
  await open(page); await edit(page, 'Live draft B'); await saved(page);
  const result = await page.evaluate(async () => {
    const {openStore} = await import('/test-api.js'), db = await openStore();
    try {
      const p = (await db.all('packages'))[0];
      const {record, review, draft, resume} = await db.restore(p.id);
      const incoming = {...draft, targetKey: 'different-target', body: 'Recover incoming C'};
      // Models the review's torn expectations: fresh review, absent old draft.
      const outcome = await db.work(p.id, p.generation, {...review, draft: incoming}, {review: review.revision, draft: 0});
      return {outcome, record, draft, resume, after: await db.restore(p.id), conflicts: await db.all('conflicts')};
    } finally { db.close(); }
  });
  expect(result.outcome).toEqual({conflict: true});
  expect(result.after.record).toEqual(result.record);
  expect(result.after.draft).toEqual(result.draft);
  expect(result.after.resume).toEqual(result.resume);
  expect(result.conflicts).toHaveLength(1);
  expect(result.conflicts[0].snapshot.draft.body).toBe('Recover incoming C');
});

test('transaction abort retains last draft and retry uses the same submitted IDs', async ({page}) => {
  await open(page); await edit(page, 'Submit atomically'); await saved(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, ...args) {
      if (this.name === 'reviews' && value.review?.threads.length && !window.abortedSave) {
        window.abortedSave = true; this.transaction.abort();
      }
      return put.call(this, value, ...args);
    };
  });
  await page.getByRole('button', {name: 'Save comment', exact: true}).click();
  await expect(page.locator('.local-save-status')).toContainText('Could not save');
  expect((await rows(page, 'drafts')).find(d => !d.tombstone).body).toBe('Submit atomically');
  await expect(page.locator('.review-comment')).toHaveCount(1);
  await page.getByRole('button', {name: 'Retry browser save'}).click(); await saved(page);
  const review = (await rows(page, 'reviews'))[0].review;
  expect(review.threads).toHaveLength(1); expect(review.threads[0].comments).toHaveLength(1);
  expect((await rows(page, 'drafts')).every(d => d.tombstone)).toBe(true);
});

test('denied storage leaves reading, exact authoring and export usable', async ({page}) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'indexedDB', {get() { throw new DOMException('Denied', 'SecurityError'); }}); });
  await open(page); await edit(page, 'In memory');
  await expect(page.locator('.local-save-status')).toContainText('Could not save');
  await page.getByRole('button', {name: 'Save comment', exact: true}).click();
  await page.getByRole('button', {name: 'Prepare review file'}).click();
  await expect(page.getByRole('button', {name: 'Download review'})).toBeVisible();
  expect(await page.locator('#package-file').getAttribute('accept')).toBeNull();
});

test('remove recents retains saved work; explicit deletion removes it', async ({page}) => {
  await open(page); await edit(page, 'Recovery stays'); await saved(page);
  await page.locator('#saved-sessions summary').first().click();
  await page.getByRole('button', {name: 'Remove from recents'}).click();
  await expect(page.locator('.recent-list')).toContainText('Saved work');
  expect((await rows(page, 'drafts')).filter(d => !d.tombstone)).toHaveLength(1);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', {name: 'Delete saved work'}).click();
  await expect.poll(async () => (await rows(page, 'drafts')).length).toBe(0);
});

test('file permission adapter never requests permission during query; clone failure is isolated', async ({page}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const {permission, allow, fromHandle, choosePackage, hasFilePicker, openStore} = await import('/test-api.js');
    const calls = [], handle = {kind: 'file', queryPermission: async value => { calls.push(['query', value]); return 'prompt'; },
      requestPermission: async value => { calls.push(['request', value]); return 'denied'; }, getFile: async () => new File(['x'], 'x')};
    const prompt = await permission(handle), before = calls.length, denied = await allow(handle);
    const chosen = await choosePackage({showOpenFilePicker: async options => { calls.push(['picker', options]); return [handle]; }});
    const db = await openStore(); let cloneFailed = false;
    try { await db.saveHandle('test', handle); } catch { cloneFailed = true; }
    await db.openPackage('test', {filename: 'metadata still works'}); db.close();
    return {prompt, before, denied, calls, name: chosen.blob.name, cloneFailed,
      insecure: hasFilePicker({isSecureContext: false, showOpenFilePicker() {}}), unavailable: await permission({})};
  });
  expect(result).toMatchObject({prompt: 'prompt', before: 1, denied: 'denied', name: 'x', cloneFailed: true, insecure: false, unavailable: 'unavailable'});
  expect(result.calls).toEqual([['query', {mode: 'read'}], ['request', {mode: 'read'}], ['picker', {multiple: false}]]);
  expect((await rows(page, 'packages'))[0].filename).toBe('metadata still works');
});

test('ordinary scroll and source mode resume using source position at a different viewport width', async ({page}) => {
  const text = '# Long document\n\n' + Array.from({length: 40}, (_, i) => `## Repeated\n\nParagraph ${i} ${'reading words '.repeat(20)}\n\n`).join('');
  const long = file(await packageWith({'guide.md': text}));
  await open(page, long);
  await page.locator('#reader article > p').nth(20).evaluate(p => p.scrollIntoView());
  await expect.poll(async () => (await rows(page, 'positions'))[0]?.anchor).toBe(await page.locator('#reader article > p').nth(20).getAttribute('data-sourcepos'));
  const selected = await page.getByLabel('Document section').inputValue();
  await page.reload(); await page.setViewportSize({width: 800, height: 720});
  await page.locator('#package-file').setInputFiles(long);
  await expect.poll(() => page.locator('#reader article > p').nth(20).evaluate(p => Math.abs(p.getBoundingClientRect().top))).toBeLessThan(5);
  expect(await page.getByLabel('Document section').inputValue()).toBe(selected);
  await page.getByRole('button', {name: 'View source', exact: true}).click();
  await expect.poll(async () => (await rows(page, 'positions'))[0]?.sourceMode).toBe(true);
  await page.reload(); await page.locator('#package-file').setInputFiles(long);
  await expect(page.getByRole('button', {name: 'View rendered', exact: true})).toBeVisible();
});

test('draft in document A stays there when the last read document is B', async ({page}) => {
  const input = file(await packageWith({'a.md': '# A\n\nA target\n', 'b.md': '# B\n\nB target\n'}));
  await open(page, input); await edit(page, 'A draft'); await saved(page);
  await page.locator('#documents').getByRole('button', {name: 'b.md', exact: true}).click();
  await expect(page.locator('.document-title')).toHaveText('b.md');
  await reloadAttach(page, input);
  await expect(page.locator('.document-title')).toHaveText('b.md');
  await expect(page.locator('.review-editor')).toBeHidden();
  await page.getByRole('button', {name: 'Resume draft in a.md'}).click();
  await expect(page.locator('.document-title')).toHaveText('a.md');
  await expect(page.getByLabel('Feedback', {exact: true})).toHaveValue('A draft');
});

for (const route of ['drop', 'paste']) test(`${route} inputs retain file-only history and restore drafts`, async ({page}) => {
  await page.goto('/');
  await page.evaluate(({bytes, route}) => {
    const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(bytes)], 'dropped.mdpkg'));
    const event = new Event(route, {bubbles: true, cancelable: true});
    Object.defineProperty(event, route === 'drop' ? 'dataTransfer' : 'clipboardData', {value: transfer});
    document.dispatchEvent(event);
  }, {bytes: [...bytes], route});
  await expect(page.locator('.document-title')).toHaveText('guide.md');
  await edit(page, route + ' draft'); await saved(page);
  await reloadAttach(page);
  await expect(page.getByLabel('Feedback', {exact: true})).toHaveValue(route + ' draft');
});

test('repeated quotes restore the original occurrence and source endpoints', async ({page}) => {
  const text = '# Repeated\n\nsame words and same words\n';
  const input = file(await packageWith({'guide.md': text}));
  await open(page, input);
  await page.getByRole('button', {name: 'View source', exact: true}).click();
  await page.locator('#reader pre code').evaluate(code => {
    const node = code.firstChild, start = node.data.lastIndexOf('same words'), range = document.createRange();
    range.setStart(node, start); range.setEnd(node, start + 10); getSelection().removeAllRanges(); getSelection().addRange(range);
  });
  await page.getByRole('button', {name: 'Review selected text', exact: true}).click();
  await page.getByLabel('Your name').fill('A'); await page.getByLabel('Feedback', {exact: true}).fill('Second occurrence'); await saved(page);
  const before = (await rows(page, 'drafts')).find(d => !d.tombstone);
  expect(before.target[5].occurrence).toBe(1);
  await reloadAttach(page, input);
  await expect(page.getByLabel('Feedback', {exact: true})).toHaveValue('Second occurrence');
  await page.getByRole('button', {name: 'Save comment', exact: true}).click(); await saved(page);
  expect((await rows(page, 'reviews'))[0].review.threads[0].select).toEqual(before.target[5]);
});

test('quota retry is bounded and keeps the previous committed input', async ({page}) => {
  await open(page); await edit(page, 'Last durable text'); await saved(page);
  await page.evaluate(() => {
    window.quotaPuts = 0; const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, ...args) {
      if (this.name === 'reviews' && window.quotaPuts++ < 2) throw new DOMException('Full', 'QuotaExceededError');
      return put.call(this, value, ...args);
    };
  });
  await page.getByLabel('Feedback', {exact: true}).fill('Not yet durable');
  await expect(page.locator('.local-save-status')).toContainText('Could not save');
  expect(await page.evaluate(() => window.quotaPuts)).toBe(2);
  expect((await rows(page, 'drafts')).find(d => !d.tombstone).body).toBe('Last durable text');
  await page.getByRole('button', {name: 'Retry browser save'}).click(); await saved(page);
  expect((await rows(page, 'drafts')).find(d => !d.tombstone).body).toBe('Not yet durable');
});

test('newer draft versions are preserved and surfaced for explicit recovery', async ({page}) => {
  await open(page); await edit(page, 'Future version text'); await saved(page);
  await page.evaluate(async () => {
    const opening = indexedDB.open('mdpkg-viewer:snapshot-draft2:/', 1);
    const db = await new Promise(resolve => { opening.onsuccess = () => resolve(opening.result); });
    const tx = db.transaction('drafts', 'readwrite'), store = tx.objectStore('drafts'), request = store.openCursor();
    request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.update({...cursor.value, version: 999}); cursor.continue(); } };
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = reject; }); db.close();
  });
  await reloadAttach(page);
  await expect(page.locator('.saved-recovery')).toContainText('unsupported version');
  expect((await rows(page, 'drafts'))[0].version).toBe(999);
  await expect(page.locator('.review-editor')).toBeHidden();
  await page.locator('.saved-recovery summary').click();
  await expect(page.getByLabel('Saved text for recovery')).toHaveValue(/Future version text/);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', {name: 'Discard saved recovery'}).click();
  await expect.poll(async () => (await rows(page, 'drafts')).length).toBe(0);
});

test('retention bounds history-only packages and positions while keeping older authored work', async ({page}) => {
  await open(page); await edit(page, 'Older saved work'); await saved(page);
  const result = await page.evaluate(async () => {
    const {openStore} = await import('/test-api.js'); const db = await openStore();
    const original = (await db.all('packages'))[0];
    for (let i = 0; i < 22; i++) await db.openPackage('history-' + i, {filename: 'file-' + i});
    for (let i = 0; i < 22; i++) await db.position('history-21', 0, {documentPath: 'doc-' + i});
    await db.prune();
    const packages = await db.all('packages'), positions = await db.all('positions'); db.close();
    return {work: packages.find(p => p.id === original.id), history: packages.filter(p => !p.removed && !p.hasWork).length,
      positions: positions.filter(p => p.packageKey === 'history-21').length};
  });
  expect(result.work.hasWork).toBe(true); expect(result.history).toBeLessThanOrEqual(20); expect(result.positions).toBe(20);
});

test('blocked database open fails promptly; version changes close old connections', async ({page}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const {openStore} = await import('/test-api.js');
    let message;
    try { await openStore(location.href, {open() { const req = {}; queueMicrotask(() => req.onblocked()); return req; }}); }
    catch (e) { message = e.message; }
    const db = await openStore(new URL('/isolated/', location.href).href);
    const upgrade = indexedDB.open('mdpkg-viewer:snapshot-draft2:/isolated/', 2);
    await new Promise((resolve, reject) => { upgrade.onsuccess = resolve; upgrade.onerror = reject; });
    upgrade.result.close(); let closed = false;
    try { await db.all('packages'); } catch { closed = true; }
    return {message, closed};
  });
  expect(result.message).toContain('blocked'); expect(result.closed).toBe(true);
});

for (const grant of ['granted', 'prompt', 'denied', 'missing']) test(`injected saved handle ${grant} follows startup permission rules`, async ({page}) => {
  await open(page); await edit(page, 'Handle checkpoint'); await saved(page);
  await page.evaluate(async () => {
    const {openStore} = await import('/test-api.js'); const db = await openStore(), p = (await db.all('packages'))[0];
    await db.saveHandle(p.id, {testHandle: true}); db.close();
  });
  // Deterministic API doubles, not evidence of native OS prompts or grants.
  await page.addInitScript(({grant, bytes}) => {
    window.permissionRequests = 0;
    const descriptor = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'result');
    Object.defineProperty(IDBRequest.prototype, 'result', {...descriptor, get() {
      const value = descriptor.get.call(this);
      if (value?.handle?.testHandle) value.handle = {kind: 'file',
        queryPermission: async () => grant === 'missing' ? 'granted' : grant,
        requestPermission: async () => { window.permissionRequests++; return 'granted'; },
        getFile: async () => { if (grant === 'missing') throw new Error('File moved'); return new File([new Uint8Array(bytes)], 'original.mdpkg'); }};
      return value;
    }});
  }, {grant, bytes: [...bytes]});
  await page.reload();
  if (grant === 'granted') await expect(page.getByLabel('Feedback', {exact: true})).toHaveValue('Handle checkpoint');
  else if (grant === 'prompt') {
    await expect(page.getByRole('button', {name: 'Allow access'})).toBeVisible();
    expect(await page.evaluate(() => window.permissionRequests)).toBe(0);
    await page.getByRole('button', {name: 'Allow access'}).click();
    await expect(page.getByLabel('Feedback', {exact: true})).toHaveValue('Handle checkpoint');
  } else await expect(page.getByRole('button', {name: 'Choose file again', exact: true})).toBeVisible();
  expect(await page.evaluate(() => window.permissionRequests)).toBe(grant === 'prompt' ? 1 : 0);
});

test('same-tab document pointer wins over another tab last-used document', async ({page, context}) => {
  const input = file(await packageWith({'a.md': '# A\n\nText A\n', 'b.md': '# B\n\nText B\n'}));
  await open(page, input);
  const other = await context.newPage(); await open(other, input);
  await other.locator('#documents').getByRole('button', {name: 'b.md', exact: true}).click();
  await expect(other.locator('.document-title')).toHaveText('b.md');
  await expect.poll(async () => (await rows(other, 'resume'))[0]?.documentPath).toBe('b.md');
  await reloadAttach(page, input);
  await expect(page.locator('.document-title')).toHaveText('a.md');
});

test('a slow older open cannot replace a newer package or add a recent entry', async ({page}) => {
  await page.goto('/');
  await page.evaluate(() => {
    const slice = Blob.prototype.slice, delayed = new WeakSet();
    window.restoreBlobReads = () => { Blob.prototype.slice = slice; };
    Blob.prototype.slice = function(...args) {
      const blob = slice.apply(this, args);
      if (this.name === 'slow.mdpkg' || delayed.has(this)) {
        delayed.add(blob);
        const read = blob.arrayBuffer.bind(blob);
        blob.arrayBuffer = async () => { await new Promise(resolve => { window.releaseOldOpen = resolve; }); return read(); };
      }
      return blob;
    };
  });
  await page.locator('#package-file').setInputFiles(file(bytes, 'slow.mdpkg'));
  await expect.poll(() => page.evaluate(() => typeof window.releaseOldOpen)).toBe('function');
  const other = await packageWith({'guide.md': '# Newest\n\nKeep this package\n'}, {namespace: '33333333-3333-3333-3333-333333333333'});
  await page.locator('#package-file').setInputFiles(file(other, 'newest.mdpkg'));
  await expect(page.locator('#reader article')).toContainText('Keep this package');
  await page.evaluate(() => { window.restoreBlobReads(); window.releaseOldOpen(); });
  await expect(page.locator('#package-details strong')).toHaveText('newest.mdpkg');
  expect((await rows(page, 'packages')).map(p => p.filename)).toEqual(['newest.mdpkg']);
});

test('explicit section navigation wins over a delayed scroll restore', async ({page}) => {
  const text = '# Document\n\n' + Array.from({length: 30}, (_, i) => `## Part ${i}\n\n${'words '.repeat(100)}\n\n`).join('');
  const input = file(await packageWith({'guide.md': text}));
  await open(page, input);
  await page.locator('#reader article > p').nth(20).evaluate(p => p.scrollIntoView());
  await expect.poll(async () => (await rows(page, 'positions'))[0]?.anchor).toBe(await page.locator('#reader article > p').nth(20).getAttribute('data-sourcepos'));
  await page.addInitScript(text => {
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = async (algorithm, bytes) => {
      if (new TextDecoder().decode(bytes) === text && !window.resumeReleased)
        await new Promise(resolve => { window.releaseResume = () => { window.resumeReleased = true; resolve(); }; });
      return digest(algorithm, bytes);
    };
  }, text);
  await page.reload(); await page.locator('#package-file').setInputFiles(input);
  await expect.poll(() => page.evaluate(() => typeof window.releaseResume)).toBe('function');
  await page.getByLabel('Document section').selectOption({label: '## Part 2'});
  // Let the explicit navigation paint before comparing it with delayed restore.
  const before = await page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(scrollY)))));
  await page.evaluate(() => window.releaseResume());
  await expect.poll(async () => (await rows(page, 'positions'))[0]?.locator?.[2]?.at(-1)?.[0]).toBe('## Part 2');
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(before, 0);
});

test('cancelled enhanced picker leaves the active editor and history intact', async ({page}) => {
  await page.addInitScript(() => { window.showOpenFilePicker = async () => { throw new DOMException('Cancelled', 'AbortError'); }; });
  await open(page); await edit(page, 'Keep after cancel'); await saved(page);
  const before = await rows(page, 'packages');
  await page.getByRole('button', {name: 'Open package', exact: true}).click();
  await expect(page.getByLabel('Feedback', {exact: true})).toHaveValue('Keep after cancel');
  expect(await rows(page, 'packages')).toEqual(before);
});

test('cleared site data starts empty without a restore claim', async ({page}) => {
  await open(page); await edit(page, 'Deliberately clear'); await saved(page);
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('mdpkg-viewer:snapshot-draft2:/'); request.onsuccess = resolve; request.onerror = reject;
    });
    sessionStorage.removeItem('mdpkg-viewer:snapshot-draft2:/:resume');
  });
  await page.reload();
  await expect(page.locator('.recent-list')).toHaveText('No recently opened packages.');
  await expect(page.locator('.resume-offer')).toBeEmpty();
  await page.locator('#package-file').setInputFiles(file());
  await expect(page.locator('.document-title')).toHaveText('guide.md');
  await expect(page.locator('.review-editor')).toBeHidden();
});

test('recent document selection in the active package restores that document section', async ({page}) => {
  const input = file(await packageWith({'a.md': '# A\n\nIntro\n\n## Second\n\nDetails\n', 'b.md': '# B\n\nText B\n'}));
  await open(page, input);
  await page.getByLabel('Document section').selectOption({label: '## Second'});
  await page.locator('#documents').getByRole('button', {name: 'b.md', exact: true}).click();
  await expect(page.locator('.document-title')).toHaveText('b.md');
  await page.locator('#saved-sessions summary').first().click();
  await page.locator('.recent-list').getByRole('button', {name: 'a.md', exact: true}).click();
  await expect(page.locator('.document-title')).toHaveText('a.md');
  await expect(page.getByLabel('Document section')).toHaveValue('3');
  await expect(page.locator('.recent-list small')).toContainText('## Second');
});
