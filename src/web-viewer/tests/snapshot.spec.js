import {test, expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {openPackage} from '../src/inbound/open.js';

async function rows(page) {
  return page.evaluate(async () => { const {openStore} = await import('/test-api.js'); const store = await openStore();
    try { return (await store.all('reviews')).map(r => ({...r, artifact: r.artifact && {...r.artifact, bytes: undefined}})); }
    finally { store.close(); }
  });
}
async function download(page) {
  const pending = page.waitForEvent('download'); await page.getByRole('button', {name: 'Download review', exact: true}).click();
  return fs.readFile(await (await pending).path());
}
async function author(page, file) {
  await page.goto('/'); await page.locator('#package-file').setInputFiles(file);
  await expect(page.locator('.document-title')).toHaveText('guide.md');
  await page.getByRole('button', {name: 'Review selected section', exact: true}).click();
  await page.getByLabel('Your name').fill('Reviewer'); await page.getByLabel('Feedback', {exact: true}).fill('Preserve my IDs');
  await page.getByRole('button', {name: 'Save comment', exact: true}).click();
  await expect(page.locator('.local-save-status')).toHaveText('Saved in this browser');
}
async function prepare(page) {
  await page.getByRole('button', {name: 'Prepare review file', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Download review', exact: true})).toBeVisible();
  await expect(page.locator('.local-save-status')).toHaveText('Saved in this browser');
}

for (const name of ['original.mdpkg', 'original-git.mdpkg']) test('prepared artifact persists bytes and rotates only with revision: ' + name, async ({page}) => {
  const file = '../../docs/spec/review-fixtures/' + name, requests = [];
  page.on('request', request => requests.push(request.url()));
  await author(page, file); const workspace = (await rows(page))[0];
  await prepare(page); const first = await download(page), one = await openPackage(new Blob([first]));
  expect(await page.evaluate(async () => {
    const {openStore} = await import('/test-api.js'); const store = await openStore();
    try { return (await store.all('reviews'))[0].artifact.bytes instanceof ArrayBuffer; } finally { store.close(); }
  })).toBe(true);
  if (name === 'original-git.mdpkg') await fs.writeFile('test-results/browser-commit-target.mdpkg', first);
  await prepare(page); expect(await download(page)).toEqual(first);
  expect((await rows(page))[0].namespace).toBe(workspace.namespace);
  expect(one.manifest.namespace).not.toBe(workspace.namespace);
  expect(one.manifest.current.kind).toBe('snapshot'); expect(one.entries).toHaveLength(2);
  expect(one.manifest.review.of.current.kind).toBe(name === 'original.mdpkg' ? 'snapshot' : 'commit');
  await page.reload(); await page.locator('#package-file').setInputFiles(file);
  await expect(page.getByRole('button', {name: 'Download review', exact: true})).toBeVisible();
  expect(await download(page)).toEqual(first);
  await page.getByLabel('Thread state', {exact: true}).selectOption('resolved');
  await expect(page.getByRole('button', {name: 'Download review', exact: true})).toBeHidden();
  await prepare(page); const second = await download(page), two = await openPackage(new Blob([second]));
  expect(two.manifest.namespace).not.toBe(one.manifest.namespace);
  expect(two.manifest.review.of).toEqual(one.manifest.review.of);
  const before = JSON.parse(new TextDecoder().decode(await one.read(one.manifest.review.detail)));
  const after = JSON.parse(new TextDecoder().decode(await two.read(two.manifest.review.detail)));
  expect(after.threads[0].id).toBe(before.threads[0].id);
  expect(after.threads[0].comments).toEqual(before.threads[0].comments);
  expect((await rows(page))[0].namespace).toBe(workspace.namespace);
  expect(requests.some(url => /git-|isomorphic|buffer-shim/.test(url))).toBe(false);
});

test('cancelled and failed shares retain the same prepared bytes and unexported state', async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', {value: () => true, configurable: true});
    Object.defineProperty(navigator, 'share', {value: async () => { throw new DOMException('cancelled', 'AbortError'); }, configurable: true});
  });
  await author(page, '../../docs/spec/review-fixtures/original.mdpkg'); await prepare(page);
  const first = (await rows(page))[0];
  await page.getByRole('button', {name: 'Share review', exact: true}).click();
  await expect(page.locator('.review-status')).toContainText('cancelled');
  await page.evaluate(() => Object.defineProperty(navigator, 'share', {value: async () => { throw new Error('offline'); }, configurable: true}));
  await page.getByRole('button', {name: 'Share review', exact: true}).click();
  await expect(page.locator('.review-status')).toContainText('failed');
  const retry = (await rows(page))[0]; expect(retry.artifact).toEqual(first.artifact);
  expect(retry.exportRevision).not.toBe(retry.contentRevision);
  await page.reload(); await page.locator('#package-file').setInputFiles('../../docs/spec/review-fixtures/original.mdpkg');
  await expect(page.getByRole('button', {name: 'Download review', exact: true})).toBeVisible();
  expect((await rows(page))[0].artifact).toEqual(first.artifact);
});

test('restore revalidates prepared bytes instead of trusting saved metadata', async ({page}) => {
  await author(page, '../../docs/spec/review-fixtures/original.mdpkg'); await prepare(page);
  await page.evaluate(async () => {
    const {databaseName} = await import('/test-api.js');
    await new Promise((resolve, reject) => {
      const opening = indexedDB.open(databaseName(location.href), 1);
      opening.onerror = reject;
      opening.onsuccess = () => {
        const db = opening.result, tx = db.transaction('reviews', 'readwrite'), store = tx.objectStore('reviews');
        const request = store.getAll(); request.onsuccess = () => {
          const row = request.result[0]; row.artifact.bytes = new TextEncoder().encode('not the prepared package').buffer; store.put(row);
        };
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = reject;
      };
    });
  });
  await page.reload(); await page.locator('#package-file').setInputFiles('../../docs/spec/review-fixtures/original.mdpkg');
  await expect(page.locator('.document-title')).toHaveText('guide.md');
  await expect(page.getByRole('button', {name: 'Download review', exact: true})).toBeHidden();
  await expect(page.locator('.saved-recovery')).toContainText('could not be restored');
  expect(await rows(page)).toHaveLength(1);
});

test('fresh database domain leaves old data intact and materialized state opens separately', async ({page}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const opening = indexedDB.open('mdpkg-viewer:/', 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore('sentinel');
      opening.onerror = reject;
      opening.onsuccess = () => { const db = opening.result, tx = db.transaction('sentinel', 'readwrite');
        tx.objectStore('sentinel').put('untouched', 'value'); tx.oncomplete = () => { db.close(); resolve(); };
      };
    });
  });
  await page.addInitScript(() => {
    window.databaseOpens = []; const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function(name, ...rest) { window.databaseOpens.push(name); return open.call(this, name, ...rest); };
    const remove = IDBFactory.prototype.deleteDatabase;
    IDBFactory.prototype.deleteDatabase = function(name) { throw new Error('Unexpected automatic database deletion: ' + name); };
  });
  await author(page, '../../docs/spec/review-fixtures/original.mdpkg');
  const original = (await rows(page))[0];
  await page.locator('#package-file').setInputFiles('../../docs/spec/review-fixtures/original-git.mdpkg');
  await expect(page.locator('.review-thread')).toHaveCount(0);
  expect((await rows(page))[0].packageKey).toBe(original.packageKey);
  expect(await page.evaluate(async () => {
    const {openStore} = await import('/test-api.js'); const store = await openStore();
    try { return (await store.all('packages')).map(p => p.id); } finally { store.close(); }
  })).toHaveLength(2);
  expect((await page.evaluate(() => window.databaseOpens)).every(name => name.startsWith('mdpkg-viewer:snapshot-draft2:'))).toBe(true);
  expect(await page.evaluate(() => new Promise(resolve => {
    const opening = indexedDB.open('mdpkg-viewer:/', 1);
    opening.onsuccess = () => { const db = opening.result, request = db.transaction('sentinel').objectStore('sentinel').get('value');
      request.onsuccess = () => { db.close(); resolve(request.result); };
    };
  }))).toBe('untouched');
});
