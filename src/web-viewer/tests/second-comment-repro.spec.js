import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import {fillAuthor} from './author-name-helper.js';

// Reproduction for "after one saved comment the reader cannot add a second"
// (task 18d59e3e). Not a fix: the first test is expected to FAIL until the
// stuck deferred draft is fixed.
//
// Mechanism: an unfinished comment (even an empty opened composer) is saved as
// a draft. On reopen, persistence attach() calls reviews.deferDraft(true) and
// navigated() is supposed to restoreDraft() it. Any wheel/touchstart/
// pointerdown/keydown/input during the restore bumps `intent`, so navigated()
// takes the early return at session.js:254 and never restores the draft or
// clears deferredDraft. Every later edit() is then refused at
// review-view.js:102 with a message written only to the side panel's
// .review-status, far off-screen; the only recovery is a "Resume draft in …"
// button in the saved-sessions region at the top of the page.

async function select(page, text) {
  await page.evaluate(text => {
    const walker = document.createTreeWalker(document.querySelector('#reader article'), NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const start = node.data.indexOf(text); if (start < 0) continue;
      node.parentElement.scrollIntoView({block: 'center'});
      const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + text.length);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      return;
    }
    throw new Error('Text not rendered: ' + text);
  }, text);
}
async function request(page, text) {
  await select(page, text);
  await page.getByRole('button', {name: 'Review selected text', exact: true}).click();
}
async function saveComment(page, text, feedback) {
  await request(page, text);
  await fillAuthor(page, 'Reviewer');
  await page.getByLabel('Feedback', {exact: true}).fill(feedback);
  await page.getByRole('button', {name: 'Save comment', exact: true}).click();
  await expect(page.locator('.review-editor')).toBeHidden();
}
async function saved(page) { await expect(page.locator('.local-save-status')).toHaveText('Saved in this browser'); }
// Reattach after reload. With `touch`, deliver one keydown the moment the
// document title renders, i.e. while navigated() is still restoring the
// position. A real click or wheel just after the document appears does the
// same (observed 4/5 clicks and 1/5 wheels on the user's package).
async function reloadAttach(page, file, title, touch) {
  await page.reload();
  await expect(page.getByRole('button', {name: 'Choose file again', exact: true})).toBeVisible({timeout: 12000});
  if (touch) await page.evaluate(() => {
    const heading = document.querySelector('.document-title');
    new MutationObserver((_, observer) => {
      if (!heading.textContent) return;
      observer.disconnect(); document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Shift'}));
    }).observe(heading, {childList: true, characterData: true, subtree: true});
  });
  await page.locator('#package-file').setInputFiles(file);
  await expect(page.locator('.document-title')).toHaveText(title, {timeout: 12000});
}

test('second comment after reopening with an unfinished draft and input during restore', async ({page}) => {
  const file = '../../docs/spec/review-fixtures/original.mdpkg';
  await page.goto('/'); await page.locator('#package-file').setInputFiles(file);
  await expect(page.locator('.document-title')).toHaveText('guide.md');
  await saveComment(page, 'target', 'First comment'); await saved(page);
  // Start a second comment and leave without saving or cancelling it.
  await request(page, 'words'); await expect(page.getByLabel('Feedback', {exact: true})).toBeVisible(); await saved(page);

  await reloadAttach(page, file, 'guide.md', true);
  await expect(page.locator('.review-thread')).toHaveCount(1);
  await request(page, 'Use the tool');
  // Fails today: the editor stays hidden; .review-status (off-screen) reads
  // "Resume or cancel your saved draft before starting another comment."
  await expect(page.locator('.review-editor'), await page.locator('.review-status').textContent()).toBeVisible();
});

// Scenario matrix on the reported package. Set MDPKG_REPRO to its path.
const REPRO = process.env.MDPKG_REPRO;
test.describe('reported package', () => {
  test.skip(!REPRO || !fs.existsSync(REPRO), 'MDPKG_REPRO not set');
  const FIRST = 'Code after the rename: 291 tests pass', OTHER_BLOCK = 'This document is for developers', SAME_BLOCK = 'including Kafka integration tests';
  async function open(page) {
    await page.goto('/'); await page.locator('#package-file').setInputFiles(REPRO);
    await expect(page.locator('.document-title')).toHaveText('README.md');
    await saveComment(page, FIRST, 'First comment'); await saved(page);
  }
  for (const [name, text] of [['a different block', OTHER_BLOCK], ['the same block', SAME_BLOCK]]) {
    test(`same tab: second comment on ${name}`, async ({page}) => {
      await open(page);
      await saveComment(page, text, 'Second comment');
      await expect(page.locator('.review-thread')).toHaveCount(2);
    });
  }
  for (const touch of [false, true]) {
    test(`restored session, no draft, input during restore=${touch}`, async ({page}) => {
      await open(page);
      await reloadAttach(page, REPRO, 'README.md', touch);
      await expect(page.locator('.review-thread')).toHaveCount(1);
      await saveComment(page, OTHER_BLOCK, 'Second comment');
      await expect(page.locator('.review-thread')).toHaveCount(2);
    });
    test(`restored session with unfinished draft, input during restore=${touch}`, async ({page}) => {
      await open(page);
      await request(page, SAME_BLOCK); await saved(page);
      await reloadAttach(page, REPRO, 'README.md', touch);
      // Clean restore reopens the draft (expected); cancelling it frees the editor.
      if (await page.locator('.review-editor').isVisible()) await page.getByRole('button', {name: 'Cancel', exact: true}).click();
      await request(page, OTHER_BLOCK);
      await expect(page.locator('.review-editor'), await page.locator('.review-status').textContent()).toBeVisible();
    });
  }
});
