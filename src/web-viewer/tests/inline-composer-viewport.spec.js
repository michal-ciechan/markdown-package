// CARD-0064: the inline comment composer lands off-screen on long documents.
// Two independent causes (plan 2026-09-22-inline-composer-viewport-plan.md §1):
// Chromium/Firefox place the composer at a stale position because layout() reads
// the host rect and the spacer rects across a forced layout that scroll anchoring
// moves; WebKit places it correctly but focus() reveals only the caret line.
// toBeVisible() does not check the viewport, so every assertion here is a rect
// bounds check, and the failure message carries the measured rect.
import {test, expect} from '@playwright/test';

const PHRASE = 'deep target words';
const SECTIONS = 40, TARGET_SECTION = 30;

function longDocument() {
  const lines = ['# Long guide', '', 'An intro paragraph before the sections begin.', ''];
  for (let s = 1; s <= SECTIONS; s++) {
    lines.push(`## Section ${s}`, '');
    for (let p = 1; p <= 3; p++) {
      lines.push(s === TARGET_SECTION && p === 2
        ? `Section ${s} paragraph ${p} carries the ${PHRASE} this review targets.`
        : `Section ${s} paragraph ${p} is ordinary prose that gives the document real height.`, '');
    }
  }
  return lines.join('\n');
}

async function openLong(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto('/');
  await page.locator('#package-file').setInputFiles(
    {name: 'long.md', mimeType: 'text/markdown', buffer: Buffer.from(longDocument(), 'utf8')});
  await expect(page.locator('.document-title')).toHaveText('long.md');
}

const target = page => page.locator('#reader article > p', {hasText: PHRASE}).first();

// The programmatic selection pattern of inline-comments.spec.js select().
async function selectPhrase(page) {
  await target(page).scrollIntoViewIfNeeded();
  await target(page).evaluate((p, text) => {
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); let node;
    while ((node = walker.nextNode()) && !node.data.includes(text)) {}
    const at = node.data.indexOf(text), range = document.createRange();
    range.setStart(node, at); range.setEnd(node, at + text.length);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, PHRASE);
}

// The same selection the way a user makes it, so the toolbar path is driven by
// real pointer events rather than a synthetic selectionchange.
async function dragPhrase(page) {
  await target(page).scrollIntoViewIfNeeded();
  const path = await target(page).evaluate((p, text) => {
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); let node;
    while ((node = walker.nextNode()) && !node.data.includes(text)) {}
    const at = node.data.indexOf(text);
    const head = document.createRange(); head.setStart(node, at); head.setEnd(node, at + 1);
    const tail = document.createRange(); tail.setStart(node, at + text.length - 1); tail.setEnd(node, at + text.length);
    const a = head.getBoundingClientRect(), b = tail.getBoundingClientRect();
    return {x1: a.left + 1, y1: a.top + a.height / 2, x2: b.right - 1, y2: b.top + b.height / 2};
  }, PHRASE);
  await page.mouse.move(path.x1, path.y1);
  await page.mouse.down();
  for (let step = 1; step <= 5; step++) {
    await page.mouse.move(path.x1 + (path.x2 - path.x1) * step / 5, path.y1 + (path.y2 - path.y1) * step / 5);
  }
  await page.mouse.up();
  expect(await page.evaluate(() => getSelection().toString().trim().length), 'mouse drag selected nothing').toBeGreaterThan(0);
}

const openViaToolbar = page => page.getByRole('toolbar', {name: 'Text selection'})
  .getByRole('button', {name: 'Leave comment'}).click();

// The panel path needs the viewport below the insertion point when the composer
// is placed: that is the scroll-anchoring precondition for the Chromium/Firefox
// cause. Scroll explicitly so it does not depend on Playwright's own scrolling.
async function openViaPanel(page) {
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await page.getByRole('button', {name: 'Review selected text', exact: true}).click();
}

const measure = locator => locator.evaluate(element => {
  const r = element.getBoundingClientRect();
  return {top: r.top, left: r.left, bottom: r.bottom, right: r.right, innerWidth, innerHeight,
    inView: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth};
});

async function expectInView(locator, what) {
  const rect = await measure(locator);
  expect(rect.inView, `${what} is outside the viewport: ${JSON.stringify(rect)}`).toBe(true);
}

async function expectComposerRevealed(page, viewport) {
  // The composer must be placed inline, not left sitting in the review panel:
  // otherwise a skipped placement would pass a bounds check for the wrong reason.
  await expect(page.locator('.inline-group .review-editor')).toBeVisible();
  await expect(page.locator('.inline-group .review-editor')).toHaveCount(1);
  // WebKit's caret reveal arrives ~25 ms after focus() returns; settle first so
  // the assertion measures the state the user is left looking at.
  await page.waitForTimeout(400);
  await expect(page.getByLabel('Feedback', {exact: true})).toBeFocused();
  await expectInView(page.getByLabel('Feedback', {exact: true}), 'the Feedback textarea');
  await expectInView(page.getByRole('button', {name: 'Save comment', exact: true}), 'the Save comment button');
  // At 1280x400 the form is taller than the viewport by design (plan D-3), so the
  // whole-form check applies only where it can fit.
  if (viewport.height >= 720) await expectInView(page.locator('.inline-group .review-editor'), 'the composer form');
}

const VIEWPORTS = [{width: 1280, height: 720}, {width: 390, height: 844}, {width: 1280, height: 400}];

for (const viewport of VIEWPORTS) {
  const size = `${viewport.width}x${viewport.height}`;
  test(`the composer opens inside the viewport from the selection toolbar at ${size}`, async ({page}) => {
    await openLong(page, viewport);
    await selectPhrase(page);
    await openViaToolbar(page);
    await expectComposerRevealed(page, viewport);
  });

  test(`the composer opens inside the viewport from the review panel at ${size}`, async ({page}) => {
    await openLong(page, viewport);
    await selectPhrase(page);
    await openViaPanel(page);
    await expectComposerRevealed(page, viewport);
  });
}

test('the composer opens inside the viewport after a real mouse drag selection', async ({page}) => {
  const viewport = VIEWPORTS[0];
  await openLong(page, viewport);
  await dragPhrase(page);
  await openViaToolbar(page);
  await expectComposerRevealed(page, viewport);
});
