// The manual-copy fallback for the plain-Markdown export
// (docs/plans/2026-09-23-review-as-plain-markdown.md).
//
// Its own file so every engine runs it. navigator.clipboard is undefined
// outside a secure context, so off HTTPS/localhost this textarea is the only
// copy path there is — and unlike the clipboard-read case in review.spec.js it
// reads nothing from the clipboard, so it needs no permission Firefox blocks or
// WebKit rejects (CARD-0057).
import {test, expect} from '@playwright/test';
import {fillAuthor} from './author-name-helper.js';

const copy = page => page.getByRole('button', {name: 'Copy review as Markdown', exact: true});
const field = page => page.getByLabel('Review as Markdown');

async function openWithComment(page, body) {
  await page.addInitScript(() => {
    Clipboard.prototype.writeText = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  });
  await page.goto('/');
  await page.locator('#package-file').setInputFiles('../../docs/spec/review-fixtures/original.mdpkg');
  await expect(page.locator('.document-title')).toHaveText('guide.md');
  // Nothing to export yet, so neither Markdown button is offered.
  await expect(copy(page)).toBeDisabled();
  await page.getByRole('button', {name: 'Review selected section', exact: true}).click();
  await fillAuthor(page, 'Priya');
  await page.getByLabel('Feedback', {exact: true}).fill(body);
  await page.getByRole('button', {name: 'Save comment', exact: true}).click();
}

test('the Markdown copy falls back to a readonly text box when the clipboard refuses', async ({page}) => {
  await openWithComment(page, 'Whole-section feedback.');
  await copy(page).click();
  await expect(page.locator('.review-status')).toHaveText('Select and copy the Markdown from the text box.');
  await expect(field(page)).toBeVisible();
  await expect(field(page)).toBeFocused();
  await expect(field(page)).toHaveJSProperty('readOnly', true);
  expect(await field(page).inputValue()).toContain('> Whole-section feedback.');
  // select() so the keyboard copy works: the whole value must be selected.
  expect(await field(page).evaluate(node => node.selectionEnd - node.selectionStart === node.value.length && node.value.length > 0)).toBe(true);
});

// Review dcdede68, defect 1. The fallback holds a rendered snapshot, so anything
// that changes the review makes it stale. A stale box that is still visible and
// still labelled "Review as Markdown" is worse than no box: the reviewer copies
// an export that silently omits the change they just made. Both paths below go
// through invalidate(), and the thread-state one does not even redraw.
test('a change to the review never leaves stale Markdown in the fallback text box', async ({page}) => {
  await openWithComment(page, 'First note.');
  await copy(page).click();
  await expect(field(page)).toBeVisible();
  expect(await field(page).inputValue()).toContain('First note.');

  // Path 1: the thread-state handler calls invalidate() without draw().
  await page.getByLabel('Thread state', {exact: true}).selectOption('resolved');
  await expect(field(page)).toBeHidden();
  expect(await field(page).inputValue()).toBe('');

  // Re-rendering on demand is what makes hiding it safe, so prove the new state
  // reaches the export rather than only that the stale copy went away.
  await copy(page).click();
  await expect(field(page)).toBeVisible();
  expect(await field(page).inputValue()).toContain('_resolved_');

  // Path 2: saving a comment. The reply is the change the stale box would hide.
  await page.getByRole('button', {name: 'Reply', exact: true}).click();
  await page.getByLabel('Feedback', {exact: true}).fill('Second note.');
  await page.getByRole('button', {name: 'Save comment', exact: true}).click();
  await expect(field(page)).toBeHidden();
  expect(await field(page).inputValue()).toBe('');

  await copy(page).click();
  await expect(field(page)).toBeVisible();
  const text = await field(page).inputValue();
  expect(text).toContain('First note.');
  expect(text).toContain('Second note.');
});
