import {test, expect} from '@playwright/test';
import {fillAuthor} from './author-name-helper.js';
import fs from 'node:fs/promises';
import {openPackage} from '../src/inbound/open.js';
import {looseNamespace, MAX_LOOSE_BYTES} from '../src/inbound/loose.js';

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

// Review 30af66b7, defect 1: persistence re-runs reviews.setPackage(getPackage())
// on both of these paths. The flag used to be a defaulted call argument, so each
// one silently cleared it and the export caveat vanished while the very same
// synthesized package was still open and still exportable.
test('deleting saved work keeps the loose export caveat on the still-open package', async ({page}) => {
  await page.goto('/');
  await page.locator('#package-file').setInputFiles(loose());
  await expect(page.locator('.document-title')).toHaveText('notes.md');
  await expect(page.locator('.review-loose')).toBeVisible();
  await page.getByRole('button', {name: 'Review selected section', exact: true}).click();
  await fillAuthor(page, 'Loose Reviewer');
  await page.getByLabel('Feedback', {exact: true}).fill('Work that will be deleted.');
  await page.getByRole('button', {name: 'Save comment', exact: true}).click();
  await expect(page.locator('.local-save-status')).toHaveText('Saved in this browser');

  await page.locator('#saved-sessions summary').first().click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', {name: 'Delete saved work', exact: true}).click();
  await expect(page.locator('.local-save-status')).toHaveText('Saved work deleted.');

  // The same loose package is still open, so both surfaces must still say so.
  await expect(page.locator('.review-loose')).toBeVisible();
  await expect(page.locator('.review-loose')).toContainText('synthesized snapshot that exists only on this device');
  await expect(page.locator('#package-details .loose-note')).toContainText('synthesized on this device');
  await page.getByRole('button', {name: 'Review selected section', exact: true}).click();
  await fillAuthor(page, 'Loose Reviewer');
  await page.getByLabel('Feedback', {exact: true}).fill('Feedback written after the delete.');
  await page.getByRole('button', {name: 'Save comment', exact: true}).click();
  await page.getByRole('button', {name: 'Prepare review file', exact: true}).click();
  await expect(page.locator('.review-status')).toContainText('Review ready: 1 threads');
  await expect(page.locator('.review-status')).toContainText('not a packaged .mdpkg the recipient can obtain');
});

test('discarding unrestorable saved work keeps the loose export caveat', async ({page}) => {
  await page.goto('/');
  await page.locator('#package-file').setInputFiles(loose());
  await expect(page.locator('.document-title')).toHaveText('notes.md');
  await page.getByRole('button', {name: 'Review selected section', exact: true}).click();
  await fillAuthor(page, 'Loose Reviewer');
  await page.getByLabel('Feedback', {exact: true}).fill('Draft that will not restore.');
  await expect(page.locator('.local-save-status')).toHaveText('Saved in this browser');
  // Force the recovery branch: an unsupported draft version cannot be decoded.
  await page.evaluate(async () => {
    const opening = indexedDB.open('mdpkg-viewer:snapshot-draft2:/', 1);
    const db = await new Promise(resolve => { opening.onsuccess = () => resolve(opening.result); });
    const tx = db.transaction('drafts', 'readwrite'), request = tx.objectStore('drafts').openCursor();
    request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.update({...cursor.value, version: 999}); cursor.continue(); } };
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = reject; }); db.close();
  });

  await page.reload();
  await expect(page.getByRole('button', {name: 'Choose file again', exact: true})).toBeVisible();
  await page.locator('#package-file').setInputFiles(loose());
  await expect(page.locator('.document-title')).toHaveText('notes.md');
  await expect(page.locator('.saved-recovery')).toContainText('could not be restored');
  await expect(page.locator('.review-loose')).toBeVisible();
  await page.locator('.saved-recovery summary').click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', {name: 'Discard saved recovery'}).click();
  await expect.poll(async () => await page.locator('.saved-recovery summary').count()).toBe(0);

  await expect(page.locator('.review-loose')).toBeVisible();
  await expect(page.locator('.review-loose')).toContainText('synthesized snapshot that exists only on this device');
  await page.getByRole('button', {name: 'Review selected section', exact: true}).click();
  await fillAuthor(page, 'Loose Reviewer');
  await page.getByLabel('Feedback', {exact: true}).fill('Feedback written after the discard.');
  await page.getByRole('button', {name: 'Save comment', exact: true}).click();
  await page.getByRole('button', {name: 'Prepare review file', exact: true}).click();
  await expect(page.locator('.review-status')).toContainText('not a packaged .mdpkg the recipient can obtain');
});

// Review 30af66b7, defect 2: the cap was only enforced inside synthesizeLoose,
// after main.js had already buffered the whole file with arrayBuffer().
test('an oversized non-ZIP file is refused on its declared size, without being read', async ({page}) => {
  await page.goto('/');
  const readWhole = await page.evaluate(async limit => {
    const file = new File(['# Too big\n'], 'huge.md', {type: 'text/markdown'});
    // Declare a size past the cap while keeping the bytes tiny, and make any
    // whole-file read observable: the refusal must arrive without one.
    Object.defineProperty(file, 'size', {value: limit + 1});
    let read = false;
    const original = file.arrayBuffer.bind(file);
    file.arrayBuffer = () => { read = true; return original(); };
    const event = new Event('drop', {bubbles: true, cancelable: true});
    Object.defineProperty(event, 'dataTransfer', {value: {types: ['Files'], files: [file]}});
    document.dispatchEvent(event);
    await new Promise(resolve => setTimeout(resolve, 250));
    return read;
  }, MAX_LOOSE_BYTES);
  await expect(page.locator('#activity')).toContainText('too large to open as a loose document');
  await expect(page.locator('#browser')).toBeHidden();
  expect(readWhole).toBe(false);
});

// Review 30af66b7, defect 3: the sniff matched only the two bytes "PK", so a
// Markdown file beginning with them went to openPackage and failed with a
// container error instead of rendering. Review 6ad4a13a: the first fixture here
// began "# PKCS", whose first two bytes are "# " - the old predicate already
// sent it down the loose path, so the case passed either way and guarded
// nothing. A Setext heading puts P and K in the file's first two bytes.
test('a Markdown file whose text starts with PK opens as a loose document', async ({page}) => {
  await page.goto('/');
  await page.locator('#package-file').setInputFiles(loose('pkcs.md', 'PKCS#11 notes\n=============\n\nPKI prose.\n\n## Second section\n\nMore prose.\n'));
  await expect(page.locator('.document-title')).toHaveText('pkcs.md');
  await expect(page.locator('.markdown h1')).toHaveText('PKCS#11 notes');
  await expect(page.locator('.markdown h2')).toHaveText('Second section');
  await expect(page.locator('#package-details .loose-note')).toContainText('synthesized on this device');
});

// The narrowest form of the same guard: the two signature bytes and nothing a
// ZIP local file header, end of central directory or spanning marker could
// follow them with.
test('a file that begins with a bare PK line opens as loose, not as a container', async ({page}) => {
  await page.goto('/');
  await page.locator('#package-file').setInputFiles(loose('pk.md', 'PK\n\nNot a container.\n'));
  await expect(page.locator('.document-title')).toHaveText('pk.md');
  await expect(page.locator('article.markdown')).toContainText('Not a container.');
  await expect(page.locator('#package-details .loose-note')).toContainText('synthesized on this device');
  await expect(page.locator('#activity')).not.toContainText('Could not open');
});
