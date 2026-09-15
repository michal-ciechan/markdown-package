import {test, expect} from '@playwright/test';
import {fillAuthor} from './author-name-helper.js';

const key = 'mdpkg-viewer:author-name';
const input = page => page.getByLabel('Your name');
const compact = page => page.getByRole('button', {name: 'Edit name', exact: true});
const feedback = page => page.getByLabel('Feedback', {exact: true});
async function attach(page, file = 'original.mdpkg') {
  await page.locator('#package-file').setInputFiles('../../docs/spec/review-fixtures/' + file);
  await expect(page.locator('.document-title')).toHaveText('guide.md');
}
async function compose(page) {
  await page.getByRole('button', {name: 'Review selected section', exact: true}).click();
  await expect(feedback(page)).toBeVisible();
}
async function saved(page) { await expect(page.locator('.local-save-status')).toHaveText('Saved in this browser'); }
async function cancel(page) {
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  await saved(page);
}
async function stored(page) { return page.evaluate(key => localStorage.getItem(key), key); }
test.beforeEach(async ({page}) => { await page.goto('/'); await attach(page); });

test('first run shows the full empty name input', async ({page}) => {
  await compose(page);
  await expect(input(page)).toBeVisible();
  await expect(input(page)).toHaveValue('');
  await expect(input(page)).toHaveAttribute('maxlength', '200');
  await expect(compact(page)).toBeHidden();
  expect(await stored(page)).toBeNull();
});

test('name persists across reload and a new page without a saved draft', async ({page, context}) => {
  await compose(page); await input(page).fill('Ada Lovelace');
  await feedback(page).focus(); await cancel(page);
  expect(await stored(page)).toBe('Ada Lovelace');
  await page.reload(); await attach(page); await compose(page);
  await expect(input(page)).toBeHidden();
  await expect(compact(page)).toHaveText('Ada Lovelace · Edit');
  await cancel(page); await page.close();
  const next = await context.newPage(); await next.goto('/');
  // A different package proves that this is a user preference, not draft restore.
  await attach(next, 'original-git.mdpkg'); await compose(next);
  await expect(compact(next)).toHaveText('Ada Lovelace · Edit');
  await expect(input(next)).toHaveValue('Ada Lovelace');
});

test('saved name is compact and click to edit saves on Enter without posting', async ({page}) => {
  await compose(page);
  const full = await input(page).boundingBox();
  await input(page).fill('Ada'); await feedback(page).fill('Do not post yet');
  await expect(compact(page)).toHaveText('Ada · Edit');
  const small = await compact(page).boundingBox();
  expect(small.height).toBeLessThan(full.height);
  expect(small.width).toBeLessThan(full.width);
  await compact(page).click();
  await expect(input(page)).toBeVisible(); await expect(input(page)).toBeFocused();
  await expect(input(page)).toHaveValue('Ada'); await expect(compact(page)).toBeHidden();
  await input(page).fill('Grace'); await input(page).press('Enter');
  await expect(compact(page)).toHaveText('Grace · Edit');
  await expect(compact(page)).toBeFocused(); await expect(input(page)).toBeHidden();
  await expect(feedback(page)).toHaveValue('Do not post yet');
  await expect(page.locator('.review-comment')).toHaveCount(0);
  expect(await stored(page)).toBe('Grace');
  await compact(page).press('Space'); await expect(input(page)).toBeFocused();
  await input(page).press('Enter'); await compact(page).press('Enter');
  await expect(input(page)).toBeFocused();
});

test('edited name persists after blur and clearing restores the first-run input', async ({page}) => {
  await compose(page); await input(page).fill('Original'); await input(page).press('Tab');
  await fillAuthor(page, '  Renamed 😀  '); await input(page).press('Tab');
  await expect(compact(page)).toHaveText('Renamed 😀 · Edit');
  expect(await stored(page)).toBe('Renamed 😀');
  await cancel(page); await page.reload(); await attach(page); await compose(page);
  await expect(compact(page)).toHaveText('Renamed 😀 · Edit');
  await page.evaluate(() => localStorage.setItem('unrelated-preference', 'keep'));
  await fillAuthor(page, '   '); await input(page).press('Tab');
  await expect(input(page)).toBeVisible(); await expect(compact(page)).toBeHidden();
  expect(await stored(page)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('unrelated-preference'))).toBe('keep');
  await cancel(page); await page.reload(); await attach(page); await compose(page);
  await expect(input(page)).toBeVisible(); await expect(input(page)).toHaveValue('');
});

test('restoring a draft preserves its author without replacing the remembered default', async ({page}) => {
  await compose(page); await input(page).fill('  Draft author  ');
  await feedback(page).fill('Exact unfinished feedback'); await saved(page);
  await page.evaluate(key => localStorage.setItem(key, 'New default'), key);
  await page.reload(); await attach(page);
  await expect(feedback(page)).toHaveValue('Exact unfinished feedback');
  await expect(input(page)).toHaveValue('  Draft author  ');
  await expect(compact(page)).toHaveText('Draft author · Edit');
  expect(await stored(page)).toBe('New default');
  await cancel(page); await compose(page);
  await expect(compact(page)).toHaveText('New default · Edit');
});

test('an empty restored draft does not inherit the remembered name', async ({page}) => {
  await compose(page); await feedback(page).fill('Waiting for a name'); await saved(page);
  await page.evaluate(key => localStorage.setItem(key, 'New default'), key);
  await page.reload(); await attach(page);
  await expect(feedback(page)).toHaveValue('Waiting for a name');
  await expect(input(page)).toBeVisible(); await expect(input(page)).toHaveValue('');
  await expect(compact(page)).toBeHidden(); expect(await stored(page)).toBe('New default');
});

for (const failure of ['getter', 'write']) test('unavailable localStorage still allows comments and in-tab name reuse: ' + failure, async ({page}) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(failure => {
    if (failure === 'getter') Object.defineProperty(window, 'localStorage', {get() { throw new DOMException('Denied', 'SecurityError'); }});
    else {
      Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
      Storage.prototype.removeItem = () => { throw new DOMException('Denied', 'SecurityError'); };
    }
  }, failure);
  await page.reload(); await attach(page); await compose(page);
  await input(page).fill('Offline reviewer'); await feedback(page).fill('Still works');
  await expect(compact(page)).toHaveText('Offline reviewer · Edit');
  await page.getByRole('button', {name: 'Save comment', exact: true}).click();
  await expect(page.locator('.review-comment')).toContainText('Offline reviewer');
  await page.getByRole('button', {name: 'Reply', exact: true}).click();
  await expect(compact(page)).toHaveText('Offline reviewer · Edit');
  await fillAuthor(page, ''); await input(page).press('Tab');
  await expect(input(page)).toBeVisible(); await expect(compact(page)).toBeHidden();
  expect(errors).toEqual([]);
});

test('remembered names render literally and fit the mobile editor', async ({page}) => {
  const value = '<b>Ada</b> 😀 ' + 'x'.repeat(185);
  await page.setViewportSize({width: 390, height: 844});
  await compose(page); await input(page).fill(value); await input(page).press('Enter');
  await expect(compact(page)).toHaveText(value + ' · Edit');
  await expect(compact(page).locator('b')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: test.info().outputPath('username-mobile.png'), fullPage: true});
});

test('editing the default keeps submitted authors and uses the new name for replies', async ({page}) => {
  await compose(page); await input(page).fill('First author'); await feedback(page).fill('First comment');
  await page.getByRole('button', {name: 'Save comment', exact: true}).click(); await saved(page);
  await page.getByRole('button', {name: 'Reply', exact: true}).click();
  await expect(compact(page)).toHaveText('First author · Edit');
  await fillAuthor(page, 'Second author'); await feedback(page).fill('Second comment');
  await page.getByRole('button', {name: 'Save comment', exact: true}).click(); await saved(page);
  const comments = page.locator('.review-comment');
  await expect(comments).toHaveCount(2);
  await expect(comments.nth(0)).toContainText('First author');
  await expect(comments.nth(1)).toContainText('Second author');
});
