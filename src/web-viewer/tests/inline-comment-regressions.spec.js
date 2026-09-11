import {test, expect} from '@playwright/test';

async function open(page) {
  await page.goto('/');
  await page.locator('#package-file').setInputFiles('../../docs/spec/review-fixtures/original.mdpkg');
  await expect(page.locator('.document-title')).toHaveText('guide.md');
}
async function select(page, text) {
  const p = page.locator('#reader article > p').first();
  await p.scrollIntoViewIfNeeded();
  await p.evaluate((p, text) => {
    const range = document.createRange(), start = p.firstChild.data.indexOf(text);
    range.setStart(p.firstChild, start); range.setEnd(p.firstChild, start + text.length);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, text);
}
async function compose(page, text, feedback) {
  await select(page, text);
  await page.getByRole('button', {name: 'Review selected text', exact: true}).click();
  await page.getByLabel('Your name').fill('Original reviewer');
  await page.getByLabel('Feedback', {exact: true}).fill(feedback);
}
async function point(page, text, offset = 0, length = text.length) {
  return page.locator('#reader article > p').first().evaluate((p, {text, offset, length}) => {
    const range = document.createRange(), start = p.firstChild.data.indexOf(text) + offset;
    range.setStart(p.firstChild, start); range.setEnd(p.firstChild, start + length);
    const r = range.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2};
  }, {text, offset, length});
}
async function hover(page, text, offset, length) {
  const p = await point(page, text, offset, length); await page.mouse.move(p.x, p.y);
}
async function post(page) {
  await page.getByRole('button', {name: 'Save comment', exact: true}).click();
  await expect(page.locator('.review-editor')).toBeHidden();
  await page.evaluate(() => getSelection().removeAllRanges());
}

test('same-anchor re-entry restarts a cancelled preview and cancels visible dismissal', async ({page}) => {
  const start = Date.now();
  await page.clock.install({time: start});
  await open(page); await compose(page, 'target', 'Re-entry feedback'); await post(page);
  await expect(page.locator('.local-save-status')).toHaveText('Saved in this browser');
  await page.getByRole('button', {name: 'Collapse folds'}).click();
  await page.locator('#reader article > p').first().scrollIntoViewIfNeeded();
  await page.clock.pauseAt(start + 60_000);
  await page.clock.runFor(300);
  const anchor = await point(page, 'target'), neutral = await point(page, 'before');
  const outside = await page.locator('#reader').evaluate((r, y) => ({x: r.getBoundingClientRect().left - 10, y}), anchor.y);
  expect(await page.evaluate(p => !document.querySelector('#reader').contains(document.elementFromPoint(p.x, p.y)), outside)).toBe(true);
  const peek = page.locator('.comment-peek');
  // Clock control makes the exit/re-entry happen inside both timer windows,
  // regardless of test-machine speed; pointer events still come from the mouse.
  for (const away of [outside, neutral]) {
    await page.mouse.move(outside.x, outside.y); await page.clock.runFor(300);
    await page.mouse.move(anchor.x, anchor.y); await page.clock.runFor(50);
    await expect(peek).toBeHidden();
    await page.mouse.move(away.x, away.y); await page.clock.runFor(50);
    await page.mouse.move(anchor.x, anchor.y);
    await page.clock.runFor(200); await expect(peek).toBeHidden();
    // No additional pointer movement: the restarted preview must open itself.
    await page.clock.runFor(100); await expect(peek).toBeVisible();
    await expect(peek).toContainText('Re-entry feedback');
  }
  await page.mouse.move(outside.x, outside.y); await page.clock.runFor(50);
  await page.mouse.move(anchor.x, anchor.y); await page.clock.runFor(200);
  await expect(peek).toBeVisible();
  await page.mouse.move(outside.x, outside.y); await page.clock.runFor(200);
  await expect(peek).toBeHidden();
});

test('source hover follows adjacent and overlapping hit sets within one paragraph', async ({page}) => {
  await open(page);
  for (const text of ['target', 'words']) { await compose(page, text, `Feedback for ${text}`); await post(page); }
  await page.getByRole('button', {name: 'Collapse folds'}).click();
  const peek = page.getByRole('tooltip');
  await hover(page, 'target'); await expect(peek).toContainText('Feedback for target');
  await hover(page, 'words'); await expect(peek).toContainText('Feedback for words');
  await hover(page, 'target'); await expect(peek).toContainText('Feedback for target');
  await hover(page, 'before'); await expect(peek).toBeHidden();
  // Change anchors while a preview is still pending, before its hover delay.
  await hover(page, 'target'); await hover(page, 'words');
  await expect(peek).toContainText('Feedback for words');

  await compose(page, 'target words', 'Broad feedback'); await post(page);
  await page.getByRole('button', {name: 'Collapse folds'}).click();
  await hover(page, 'target'); await expect(peek).toContainText('Feedback for target');
  await expect(peek).toContainText('2 overlapping threads');
  await hover(page, 'words'); await expect(peek).toContainText('Feedback for words');
  await expect(peek).toContainText('2 overlapping threads');
  // Only the broad anchor covers the space between these adjacent words.
  await hover(page, 'target words', 6, 1); await expect(peek).toContainText('Broad feedback');
  await expect(peek).not.toContainText('overlapping threads');
  await hover(page, 'target'); await expect(peek).toContainText('Feedback for target');
  await expect(peek).toContainText('2 overlapping threads');
});

test('requesting another comment reveals and focuses the retained draft hidden by Read', async ({page}) => {
  await open(page); await compose(page, 'target', 'Keep this exact draft 😀\n  with whitespace  ');
  await page.getByLabel('Kind', {exact: true}).selectOption('change-request');
  const feedback = page.getByLabel('Feedback', {exact: true});
  const target = await page.locator('.review-target').textContent();
  for (const action of ['toolbar', 'text', 'scope']) {
    await page.getByRole('button', {name: 'Read without comments'}).click();
    await expect(feedback).toBeHidden();
    await select(page, 'words');
    if (action === 'toolbar') await page.getByRole('toolbar', {name: 'Text selection'}).getByRole('button', {name: 'Leave comment'}).click();
    else await page.getByRole('button', {name: action === 'text' ? 'Review selected text' : 'Review selected section', exact: true}).click();
    await expect(feedback).toBeVisible(); await expect(feedback).toBeFocused();
    await expect(feedback).toHaveValue('Keep this exact draft 😀\n  with whitespace  ');
    await expect(page.getByLabel('Your name')).toHaveValue('Original reviewer');
    await expect(page.getByLabel('Kind', {exact: true})).toHaveValue('change-request');
    await expect(page.locator('.review-target')).toHaveText(target);
    await expect(page.locator('.review-editor .review-quote')).toHaveText('target');
    await expect(page.locator('.review-editor')).toHaveCount(1);
    await expect(page.locator('.review-status')).toContainText('Save or cancel your current comment first.');
  }
  await post(page);
  await expect(page.locator('.review-thread')).toHaveCount(1);
  await expect(page.locator('.review-thread .review-quote')).toHaveText('target');
  await expect(page.locator('.review-thread .review-body')).toHaveText('Keep this exact draft 😀\n  with whitespace  ');
});
