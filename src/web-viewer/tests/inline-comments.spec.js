import {test, expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {openPackage} from '../src/inbound/open.js';
import {writePackage} from '../src/container/writer.js';
import {utf8} from '../src/format.js';
const input = '../../docs/spec/review-fixtures/original.mdpkg';
async function open(page) {
  await page.goto('/'); await page.locator('#package-file').setInputFiles(input);
  await expect(page.locator('.document-title')).toHaveText('guide.md');
}
async function select(page, text, selector = '#reader article > p') {
  await page.locator(selector).first().scrollIntoViewIfNeeded();
  await page.locator(selector).first().evaluate((p, text) => {
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); let node;
    while ((node = walker.nextNode()) && !node.data.includes(text)) {}
    const at = node.data.indexOf(text), range = document.createRange();
    range.setStart(node, at); range.setEnd(node, at + text.length); getSelection().removeAllRanges(); getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, text);
}
async function compose(page, text, body, kind = 'comment') {
  await select(page, text); await page.getByRole('button', {name: 'Review selected text', exact: true}).click();
  await expect(page.locator('.inline-group .review-editor')).toBeVisible();
  await page.getByLabel('Your name').fill('Reviewer');
  await page.getByLabel('Kind', {exact: true}).selectOption(kind);
  await page.getByLabel('Feedback', {exact: true}).fill(body);
}
async function post(page) {
  if (!await page.getByLabel('Your name').inputValue()) await page.getByLabel('Your name').fill('Reviewer');
  await page.getByRole('button', {name: 'Save comment', exact: true}).click();
  await expect(page.locator('.review-editor')).toBeHidden();
  await expect(page.locator('.local-save-status')).toHaveText('Saved in this browser');
  await page.evaluate(() => getSelection().removeAllRanges());
}
const chips = page => page.locator('.comment-chip');
const folds = page => page.locator('.comment-fold:visible');

async function custom(page) {
  const original = await openPackage(new Blob([await fs.readFile(input)]));
  const reserved = await Promise.all(original.entries.filter(e => e.name.startsWith('.')).map(async e =>
    ({name: e.name, bytes: await original.read(e.name), stored: e.method === 0})));
  const docs = {'guide.md': '# Guide\n\nEntity &amp; example. [other](other.md#other)\n\n| Item |\n| --- |\n| cell target |\n\nFinal paragraph.\n', 'other.md': '# Other\n\nOther document.\n'};
  const buffer = Buffer.from(await writePackage([reserved[0], ...Object.entries(docs).map(([name, text]) => ({name, bytes: utf8.encode(text)})), ...reserved.slice(1)]));
  await page.goto('/'); await page.locator('#package-file').setInputFiles({name: 'inline.mdpkg', mimeType: 'application/zip', buffer});
  await expect(page.locator('.document-title')).toHaveText('guide.md');
}

test('real authoring becomes a reflowing inline fold without contaminating article text', async ({page}) => {
  await open(page);
  const before = await page.locator('#reader article').textContent();
  await compose(page, 'target words', 'Real inline feedback', 'change-request');
  await expect(page.locator('.inline-composer .review-quote')).toHaveText('target words');
  expect(await page.locator('#reader article .review-editor, #reader article .review-comment').count()).toBe(0);
  await post(page);
  await expect(chips(page)).toHaveCount(1); await expect(folds(page)).toContainText('Real inline feedback');
  expect(await page.locator('#reader article').textContent()).toBe(before);
  const layout = await page.locator('.inline-group').evaluate(g => {
    const p = document.querySelector('#reader article > p'), next = document.querySelector('#reader article h2');
    return {p: p.getBoundingClientRect().bottom, fold: g.getBoundingClientRect().top, end: g.getBoundingClientRect().bottom, next: next.getBoundingClientRect().top};
  });
  expect(layout.fold).toBeGreaterThanOrEqual(layout.p); expect(layout.next).toBeGreaterThanOrEqual(layout.end - 1);
  await page.getByRole('button', {name: 'Collapse folds'}).click(); await expect(folds(page)).toHaveCount(0);
  await chips(page).focus(); await expect(page.getByRole('tooltip')).toContainText('Real inline feedback');
  await page.keyboard.press('Escape'); await expect(page.getByRole('tooltip')).toBeHidden();
  await page.keyboard.press('Enter'); await expect(folds(page)).toHaveCount(1); await expect(chips(page)).toBeFocused();
  await page.screenshot({path: 'test-results/inline-comments-desktop.png', fullPage: true});
});

test('overlapping and adjacent threads remain individually reachable and marks cycle', async ({page}) => {
  await open(page);
  for (const [text, body, kind] of [['target words', 'First comment', 'comment'], ['target', 'Overlapping request', 'change-request'], ['Intro', 'Adjacent comment', 'comment']]) {
    await compose(page, text, body, kind); await post(page);
  }
  await expect(chips(page)).toHaveCount(3); await expect(folds(page)).toHaveCount(1);
  await page.getByRole('button', {name: 'Collapse folds'}).click();
  const point = await page.locator('#reader article > p').first().evaluate(p => {
    const r = document.createRange(), at = p.firstChild.data.indexOf('target'); r.setStart(p.firstChild, at); r.setEnd(p.firstChild, at + 6);
    const b = r.getBoundingClientRect(); return {x: b.x + 4, y: b.y + b.height / 2};
  });
  await page.mouse.move(point.x, point.y); await expect(page.getByRole('tooltip')).toContainText('overlapping threads');
  await page.mouse.click(point.x, point.y); await expect(folds(page)).toContainText('First comment');
  await page.mouse.click(point.x, point.y); await expect(folds(page)).toContainText('Overlapping request');
  await chips(page).nth(2).click(); await expect(folds(page)).toContainText('Adjacent comment');
  expect(await page.evaluate(() => CSS.highlights.get('review-mixed').size)).toBeGreaterThan(0);
});

test('state filters and Read preserve a live inline draft and restore keyboard access', async ({page}) => {
  await open(page); await compose(page, 'target words', 'Saved comment'); await post(page);
  await folds(page).getByLabel('Thread state').selectOption('resolved');
  await expect(chips(page)).toHaveAttribute('data-state', 'resolved');
  await compose(page, 'Intro', 'Keep this exact draft');
  await page.getByLabel('Filter threads', {exact: true}).selectOption('open');
  await expect(chips(page)).toHaveCount(0); await expect(page.getByLabel('Feedback', {exact: true})).toHaveValue('Keep this exact draft');
  await page.getByRole('button', {name: 'Read without comments'}).click();
  await expect(page.locator('.inline-group:visible')).toHaveCount(0);
  await page.getByRole('button', {name: 'Review comments', exact: true}).click();
  await expect(page.getByLabel('Feedback', {exact: true})).toHaveValue('Keep this exact draft');
  await page.getByLabel('Filter threads', {exact: true}).selectOption('resolved');
  await chips(page).click(); await expect(page.getByLabel('Feedback', {exact: true})).toHaveValue('Keep this exact draft');
  await select(page, 'before'); await page.getByRole('button', {name: 'Review selected text', exact: true}).click();
  await expect(page.getByLabel('Feedback', {exact: true})).toBeFocused();
  await expect(page.locator('.review-editor')).toHaveCount(1);
});

test('fold selections cannot author anchors; document selection still uses the existing toolbar', async ({page}) => {
  await open(page); await compose(page, 'target words', 'Do not anchor feedback text'); await post(page);
  await select(page, 'feedback', '.comment-fold .review-body');
  await page.getByRole('button', {name: 'Review selected text', exact: true}).click();
  await expect(page.locator('.review-editor')).toBeHidden();
  await expect(page.locator('.review-status')).toContainText('Open section');
  await select(page, 'Intro'); await page.getByRole('toolbar', {name: 'Text selection'}).getByRole('button', {name: 'Leave comment'}).click();
  await expect(page.locator('.inline-composer .review-quote')).toHaveText('Intro');
});

test('source mode and browser reattachment restore real folds and unfinished replies', async ({page}) => {
  await open(page); await compose(page, 'target words', 'Parent text'); await post(page);
  await page.getByRole('button', {name: 'Reply', exact: true}).click();
  await page.getByLabel('Feedback', {exact: true}).fill('Unfinished reply 😀');
  await expect(page.locator('.local-save-status')).toHaveText('Saved in this browser');
  await page.reload(); await page.locator('#package-file').setInputFiles(input);
  await expect(page.locator('.inline-composer textarea')).toHaveValue('Unfinished reply 😀');
  await page.getByRole('button', {name: 'View source', exact: true}).click();
  await expect(page.locator('.inline-composer textarea')).toHaveValue('Unfinished reply 😀');
  await post(page); await expect(folds(page).locator('.review-comment')).toHaveCount(2);
  await page.getByRole('button', {name: 'View rendered', exact: true}).click();
  await expect(folds(page)).toContainText('Unfinished reply 😀');
});

test('fold controls and draft stay bounded at narrow widths and 200 percent zoom', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844}); await open(page);
  await compose(page, 'target words', '<img src=x onerror=alert(1)> ' + 'long'.repeat(100)); await post(page);
  await expect(folds(page).locator('img')).toHaveCount(0);
  await page.getByRole('button', {name: 'Reply', exact: true}).click();
  await page.getByLabel('Feedback', {exact: true}).fill('Mobile draft');
  for (const zoom of ['1', '2']) {
    await page.setViewportSize({width: zoom === '1' ? 390 : 1280, height: 844});
    await page.evaluate(zoom => { document.body.style.zoom = zoom; }, zoom);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), {message: `Overflow at zoom ${zoom}`}).toBe(true);
    await page.locator('.inline-composer').scrollIntoViewIfNeeded();
    await page.screenshot({path: `test-results/inline-comments-mobile-${zoom}.png`});
    await page.getByLabel('Feedback', {exact: true}).focus();
    await chips(page).focus();
    await expect(page.getByRole('tooltip')).toBeVisible();
    const bounds = await page.getByRole('tooltip').evaluate(p => {
      const r = p.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    });
    expect(bounds).toBe(true); await page.keyboard.press('Escape');
  }
});

test('table and paragraph folds coexist with compact gutters, previews and document navigation', async ({page}) => {
  await custom(page);
  await select(page, 'cell target', '#reader article td');
  await page.getByRole('button', {name: 'Review selected text', exact: true}).click();
  await page.getByLabel('Feedback', {exact: true}).fill('Table feedback'); await post(page);
  await select(page, 'Final', '#reader article > p:last-of-type');
  await page.getByRole('button', {name: 'Review selected text', exact: true}).click();
  await page.getByLabel('Feedback', {exact: true}).fill('Paragraph feedback'); await post(page);
  await expect(folds(page)).toHaveCount(2);
  await page.getByRole('button', {name: 'Wrap table 1 text'}).click();
  await expect.poll(() => page.locator('.inline-group').first().evaluate(g => Math.abs(g.getBoundingClientRect().width - document.querySelector('.comment-space').getBoundingClientRect().width))).toBeLessThan(1);
  expect(await page.locator('.inline-group').first().evaluate(g => g.getBoundingClientRect().width > document.querySelector('.table-container').getBoundingClientRect().width)).toBe(true);
  expect(await page.locator('#reader article .comment-space').count()).toBe(2);
  await page.locator('#reader article').getByRole('button', {name: 'other', exact: true}).click();
  await expect(page.locator('#reference-preview')).toContainText('Other document.');
  await expect(folds(page)).toHaveCount(2);
  await page.locator('#reference-preview').getByRole('button', {name: 'Open section', exact: true}).click();
  await expect(page.locator('.document-title')).toHaveText('other.md');
  await expect(page.locator('.review-threads .review-thread:visible')).toHaveCount(2);
  await page.getByRole('button', {name: 'Back to reference', exact: true}).click();
  await expect(folds(page)).toHaveCount(2);
});

test('transformed source uses a labelled block fallback and obsolete history stays accessible', async ({page}) => {
  await custom(page); await page.getByRole('button', {name: 'View source', exact: true}).click();
  await select(page, '&amp;', '#reader article pre');
  await page.getByRole('button', {name: 'Review selected text', exact: true}).click();
  await page.getByLabel('Feedback', {exact: true}).fill('Entity source feedback'); await post(page);
  await page.getByRole('button', {name: 'View rendered', exact: true}).click();
  await expect(folds(page)).toContainText('Block location only');
  await expect(folds(page).locator('.review-quote')).toHaveText('&amp;');
  expect(await page.evaluate(() => CSS.highlights.get('review-comment').size)).toBe(0);
  expect(await page.locator('#reader article > p').first().evaluate(p => p.nextElementSibling.className)).toBe('comment-space');
  await folds(page).getByLabel('Thread state').selectOption('obsolete');
  await page.getByLabel('Filter threads', {exact: true}).selectOption('obsolete');
  await expect(folds(page)).toContainText('retained as review history');
  await expect(chips(page)).toHaveAttribute('data-state', 'obsolete');
});
