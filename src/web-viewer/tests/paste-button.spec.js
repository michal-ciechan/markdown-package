// CARD-0057. Chromium project only (playwright.config.js lists the Firefox/WebKit
// specs by name): Firefox cannot grant clipboard-read and blocks read() behind its
// paste prompt, and WebKit always rejects read(). The investigation
// (docs/investigations/2026-09-17-card-0057-paste-from-clipboard-button.md) measured
// that no engine hands an OS-copied file to navigator.clipboard.read(); the file
// case below therefore stubs read(), which is also how a future engine would behave.
import {test, expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {fillAuthor} from './author-name-helper.js';

const bytes = await fs.readFile('../../docs/spec/review-fixtures/original.mdpkg');
const KEYBOARD = 'Ctrl+V (Cmd+V on Mac)';
const activity = page => page.locator('#activity');
const button = page => page.getByRole('button', {name: 'Paste package', exact: true});
async function open(page) {
  await page.goto('/');
  await page.locator('#package-file').setInputFiles({name: 'original.mdpkg', mimeType: 'application/octet-stream', buffer: bytes});
  await expect(page.locator('.document-title')).toHaveText('guide.md');
}
// Replace Clipboard.prototype.read before any page script runs. `items` are
// ClipboardItem-shaped: {types, bytes?}; `error` rejects with that name/message.
const stubRead = (page, {items, error}) => page.addInitScript(({items, error}) => {
  Clipboard.prototype.read = async function () {
    if (error) throw Object.assign(new Error(error.message), {name: error.name});
    return items.map(({types, bytes}) => ({types, getType: async () => new Blob([new Uint8Array(bytes ?? [])])}));
  };
}, {items, error});

test('the button sits beside Open and the empty state names the keyboard shortcut', async ({page}) => {
  await page.goto('/');
  await expect(button(page)).toBeVisible();
  await expect(page.locator('.open-actions #paste-package')).toHaveCount(1);
  await expect(page.locator('.open-actions .open-button')).toBeVisible();
  await expect(activity(page)).toHaveText('Choose a file, drop a package here, or copy a package file and press ' + KEYBOARD + '. Files stay on this device.');
  await expect(activity(page)).not.toHaveClass('error');
});

for (const route of ['drop', 'paste']) test(`${route} of several files is refused and loads nothing`, async ({page}) => {
  await page.goto('/');
  await page.evaluate(({bytes, route}) => {
    const transfer = new DataTransfer();
    for (const name of ['one.mdpkg', 'two.mdpkg']) transfer.items.add(new File([new Uint8Array(bytes)], name));
    const event = new Event(route, {bubbles: true, cancelable: true});
    Object.defineProperty(event, route === 'drop' ? 'dataTransfer' : 'clipboardData', {value: transfer});
    document.dispatchEvent(event);
  }, {bytes: [...bytes], route});
  await expect(activity(page)).toHaveText((route === 'drop' ? 'Open' : 'Paste') + ' one package at a time.');
  await expect(activity(page)).toHaveClass('error');
  await expect(page.locator('#browser')).toBeHidden();
});

test('a clipboard item with no types (Chromium for an OS file or an empty clipboard) points at the shortcut', async ({page, context}) => {
  await context.grantPermissions(['clipboard-read']);
  await stubRead(page, {items: [{types: []}]});
  await page.goto('/');
  await button(page).click();
  await expect(activity(page)).toHaveText('Nothing readable is on the clipboard. If you copied a package file, press ' + KEYBOARD + ' on this page.');
  await expect(activity(page)).not.toHaveClass('error');
  await expect(page.locator('#browser')).toBeHidden();
});

test('text on the real clipboard is refused and leaves the package and draft untouched', async ({page, context}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await page.getByRole('button', {name: 'Review selected section', exact: true}).click();
  await fillAuthor(page, 'Reviewer');
  await page.getByLabel('Feedback', {exact: true}).fill('Keep this work');
  await page.evaluate(() => navigator.clipboard.writeText('# not a package'));
  await button(page).click();
  await expect(activity(page)).toHaveText('The clipboard holds text, not a package file. Copy a .mdpkg file and press Ctrl+V, or use Open package.');
  await expect(activity(page)).toHaveClass('error');
  await expect(page.locator('.document-title')).toHaveText('guide.md');
  await expect(page.getByLabel('Feedback', {exact: true})).toHaveValue('Keep this work');
});

test('an image-only clipboard is refused as not a package', async ({page}) => {
  await stubRead(page, {items: [{types: ['image/png']}]});
  await page.goto('/');
  await button(page).click();
  await expect(activity(page)).toContainText('The clipboard holds an image or other content, not a package file.');
  await expect(activity(page)).toHaveClass('error');
});

test('denied clipboard permission (no grant, headless) is guidance, not an error', async ({page}) => {
  await page.goto('/');
  await button(page).click();
  await expect(activity(page)).toHaveText('Clipboard access was not allowed. Press ' + KEYBOARD + ' on this page to paste the copied package, or use Open package.');
  await expect(activity(page)).not.toHaveClass('error');
  await expect(page.locator('#browser')).toBeHidden();
});

test('a stubbed NotAllowedError takes the same denied branch', async ({page}) => {
  await stubRead(page, {error: {name: 'NotAllowedError', message: 'Read permission denied.'}});
  await page.goto('/');
  await button(page).click();
  await expect(activity(page)).toContainText('Clipboard access was not allowed.');
  await expect(activity(page)).not.toHaveClass('error');
});

test('a browser without navigator.clipboard gets the unsupported guidance', async ({page}) => {
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'clipboard', {get: () => undefined}));
  await page.goto('/');
  await expect(button(page)).toBeVisible();
  await button(page).click();
  await expect(activity(page)).toHaveText('Pasting from a button is not available in this browser. Copy the package file and press ' + KEYBOARD + ' on this page, or use Open package.');
  await expect(activity(page)).not.toHaveClass('error');
});

test('any other read() failure is reported like an open failure', async ({page}) => {
  await stubRead(page, {error: {name: 'DataError', message: 'boom'}});
  await page.goto('/');
  await button(page).click();
  await expect(activity(page)).toHaveText('Could not read the clipboard: boom');
  await expect(activity(page)).toHaveClass('error');
});

test('a file representation from read() opens through the ordinary package route', async ({page}) => {
  await stubRead(page, {items: [{types: ['text/plain', 'application/zip'], bytes: [...bytes]}]});
  await page.goto('/');
  await button(page).click();
  await expect(page.locator('.document-title')).toHaveText('guide.md');
  await expect(activity(page)).toHaveText('guide.md');
  await expect(activity(page)).not.toHaveClass('error');
  await expect(page.locator('#browser')).toBeVisible();
  await expect(page.locator('#saved-sessions')).toContainText('Pasted package');
});

test('a file representation that is not a package fails like a broken file', async ({page}) => {
  await stubRead(page, {items: [{types: ['application/octet-stream'], bytes: [...Buffer.from('not a zip')]}]});
  await page.goto('/');
  await button(page).click();
  await expect(activity(page)).toContainText('Could not open package');
  await expect(activity(page)).toHaveClass('error');
  await expect(page.locator('#browser')).toBeHidden();
});
