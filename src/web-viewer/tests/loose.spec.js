import {test, expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {openPackage} from '../src/inbound/open.js';
import {looseNamespace} from '../src/inbound/loose.js';

const SOURCE = '# Loose notes\n\nProse with target words in it.\n\n## Second section\n\nMore prose.\n';
const LAST_MODIFIED = Date.UTC(2020, 0, 2, 3, 4, 5);
const loose = (name = 'notes.md', text = SOURCE) =>
  ({name, mimeType: 'text/markdown', buffer: Buffer.from(text, 'utf8'), lastModified: LAST_MODIFIED});

const packages = page => page.evaluate(async () => {
  const {openStore} = await import('/test-api.js'); const store = await openStore();
  try { return await store.all('packages'); } finally { store.close(); }
});

async function sendFile(page, file, route = 'drop') {
  await page.evaluate(({name, type, text, lastModified, route}) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], name, {type, lastModified}));
    const event = new Event(route, {bubbles: true, cancelable: true});
    Object.defineProperty(event, route === 'drop' ? 'dataTransfer' : 'clipboardData', {value: transfer});
    document.dispatchEvent(event);
  }, {name: file.name, type: file.mimeType, text: file.buffer.toString('utf8'), lastModified: LAST_MODIFIED, route});
}
const dropFile = (page, file) => sendFile(page, file, 'drop');

test('the picker opens a loose .md, outlines it, and keeps recents on the original file', async ({page}) => {
  await page.goto('/');
  await page.locator('#package-file').setInputFiles(loose());
  await expect(page.locator('.document-title')).toHaveText('notes.md');
  await expect(page.locator('#activity')).toHaveText('notes.md');
  await expect(page.locator('#package-details strong')).toHaveText('notes.md');
  await expect(page.locator('#package-details .loose-note')).toContainText('synthesized on this device');
  await expect(page.locator('#conformance')).toBeHidden();
  // Outline: the sidebar has the one document and the reader shows both headings.
  await expect(page.locator('.document-list button')).toHaveCount(1);
  await expect(page.locator('.markdown h1')).toHaveText('Loose notes');
  await expect(page.locator('.markdown h2')).toHaveText('Second section');
  // The integration trap: recents metadata must describe the user's original
  // File, never the synthesized ZIP's size or Date.now() modification time.
  await expect.poll(async () => (await packages(page))[0]?.filename).toBe('notes.md');
  const [record] = await packages(page);
  expect(record.size).toBe(Buffer.byteLength(SOURCE, 'utf8'));
  expect(JSON.parse(record.packageKey)[1]).toBe(await looseNamespace('notes.md'));
});

test('drag-drop opens a loose .md and a same-named file resumes its saved work', async ({page}) => {
  await page.goto('/');
  await dropFile(page, loose());
  await expect(page.locator('.document-title')).toHaveText('notes.md');
  // The original File's own lastModified reaches recents, not Date.now().
  await expect.poll(async () => (await packages(page))[0]?.lastModified).toBe(LAST_MODIFIED);
  await page.getByRole('button', {name: 'Review selected section', exact: true}).click();
  await page.getByLabel('Your name').fill('Loose Reviewer');
  await page.getByLabel('Feedback', {exact: true}).fill('Saved against a loose file.');
  await page.getByRole('button', {name: 'Save comment', exact: true}).click();
  await expect(page.locator('.review-thread')).toHaveCount(1);
  await expect(page.locator('.local-save-status')).toHaveText('Saved in this browser');
  // Name-derived identity: a different File object with the same basename and
  // the same content resumes the prior namespace, position and comments.
  await page.reload();
  await dropFile(page, {...loose(), buffer: Buffer.from(SOURCE, 'utf8')});
  await expect(page.locator('.document-title')).toHaveText('notes.md');
  await expect(page.locator('.review-thread')).toHaveCount(1);
  await expect(page.locator('.review-body')).toHaveText('Saved against a loose file.');
});

test('Ctrl+V pastes a loose .md through the same route', async ({page}) => {
  await page.goto('/');
  await sendFile(page, loose('pasted.md'), 'paste');
  await expect(page.locator('.document-title')).toHaveText('pasted.md');
  await expect(page.locator('.markdown h1')).toHaveText('Loose notes');
  await expect(page.locator('#package-details .loose-note')).toContainText('synthesized on this device');
  await expect.poll(async () => (await packages(page))[0]?.size).toBe(Buffer.byteLength(SOURCE, 'utf8'));
});

test('a loose review export is allowed and every export surface carries the caveat', async ({page}) => {
  await page.goto('/');
  await page.locator('#package-file').setInputFiles(loose());
  await expect(page.locator('.document-title')).toHaveText('notes.md');
  const notice = page.locator('.review-loose');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('synthesized snapshot that exists only on this device');
  await page.getByRole('button', {name: 'Review selected section', exact: true}).click();
  await page.getByLabel('Your name').fill('Loose Reviewer');
  await page.getByLabel('Feedback', {exact: true}).fill('Explain these words.');
  await page.getByRole('button', {name: 'Save comment', exact: true}).click();
  await page.getByRole('button', {name: 'Prepare review file', exact: true}).click();
  const button = page.getByRole('button', {name: 'Download review', exact: true});
  await expect(button).toBeVisible();
  await expect(page.locator('.review-status')).toContainText('Review ready: 1 threads');
  await expect(page.locator('.review-status')).toContainText('not a packaged .mdpkg the recipient can obtain');
  const pending = page.waitForEvent('download'); await button.click();
  await expect(page.locator('.review-status')).toContainText('Review download requested');
  await expect(page.locator('.review-status')).toContainText('not a packaged .mdpkg the recipient can obtain');
  // The export itself is a real conforming delta against the synthesized snapshot.
  const exported = await openPackage(new Blob([await fs.readFile(await (await pending).path())]));
  await exported.verifySnapshot();
  expect(exported.manifest.review.shape).toBe('delta');
  expect(exported.manifest.review.of.namespace).toBe(await looseNamespace('notes.md'));
  expect(exported.manifest.review.of.current.kind).toBe('snapshot');
});

test('a real .mdpkg keeps the packaged copy and shows no loose caveat', async ({page}) => {
  await page.goto('/');
  await page.locator('#package-file').setInputFiles('../../docs/spec/review-fixtures/original.mdpkg');
  await expect(page.locator('.document-title')).toHaveText('guide.md');
  await expect(page.locator('#activity')).toHaveText('guide.md');
  await expect(page.locator('.review-loose')).toBeHidden();
  await expect(page.locator('#package-details .loose-note')).toHaveCount(0);
  await page.getByRole('button', {name: 'Review selected section', exact: true}).click();
  await page.getByLabel('Your name').fill('Packaged Reviewer');
  await page.getByLabel('Feedback', {exact: true}).fill('Packaged feedback.');
  await page.getByRole('button', {name: 'Save comment', exact: true}).click();
  await page.getByRole('button', {name: 'Prepare review file', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Download review', exact: true})).toBeVisible();
  await expect(page.locator('.review-status')).toContainText('Review ready: 1 threads');
  await expect(page.locator('.review-status')).not.toContainText('loose Markdown file');
});

test('a truncated .mdpkg still reports a container error instead of rendering as source', async ({page}) => {
  const full = await fs.readFile('../../docs/spec/review-fixtures/original.mdpkg');
  await page.goto('/');
  await page.locator('#package-file').setInputFiles({name: 'truncated.mdpkg', mimeType: 'application/octet-stream', buffer: full.subarray(0, full.length - 40)});
  await expect(page.locator('#activity')).toContainText('Could not open package');
  await expect(page.locator('#browser')).toBeHidden();
});

test('CRLF and a leading BOM are handled, and a non-UTF-8 file is refused', async ({page}) => {
  await page.goto('/');
  await page.locator('#package-file').setInputFiles(loose('crlf.md', SOURCE.replace(/\n/g, '\r\n')));
  await expect(page.locator('.markdown h1')).toHaveText('Loose notes');
  await expect(page.locator('#activity')).toHaveText('crlf.md');

  await page.reload();
  await page.locator('#package-file').setInputFiles({name: 'bom.md', mimeType: 'text/markdown',
    buffer: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(SOURCE, 'utf8')])});
  await expect(page.locator('.markdown h1')).toHaveText('Loose notes');
  await expect(page.locator('#package-details .loose-note')).toContainText('byte order mark was removed');

  await page.reload();
  await page.locator('#package-file').setInputFiles({name: 'latin1.md', mimeType: 'text/markdown', buffer: Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a])});
  await expect(page.locator('#activity')).toContainText('not UTF-8 text');
  await expect(page.locator('#browser')).toBeHidden();
});
