import {test, expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {openPackage} from '../src/inbound/open.js';
import {writePackage} from '../src/container/writer.js';
import {utf8} from '../src/format.js';
import {outline} from '../src/address/outline.js';
import {referenceFor} from '../src/address/resolve.js';

const original = await openPackage(new Blob([await fs.readFile('../../docs/spec/review-fixtures/original.mdpkg')]));
const reserved = await Promise.all(original.entries.filter(e => e.name.startsWith('.')).map(async e =>
  ({name: e.name, bytes: await original.read(e.name), stored: e.method === 0})));
async function packageBytes(documents) {
  return Buffer.from(await writePackage([reserved[0], ...Object.entries(documents).map(([name, text]) => ({name, bytes: utf8.encode(text)})), ...reserved.slice(1)]));
}
const target = '# Storage\n\n## Retention policy\n\nKeep successful results for seven days. [guide][back]\n\n' +
  '| Link |\n| --- |\n| [self](#retention-policy) |\n\n![image](https://example.com/pixel.png)\n\n<script>alert(1)</script>\n\n' +
  '# Outside\n\n[back]: ../guide.md#alpha "Return"\n';
const targetModel = outline(utf8.encode(target), 'reference/storage.md');
const durable = await referenceFor(original, targetModel, targetModel.scopes[3]);
const hugeModel = outline(utf8.encode('old'), 'large.md');
const hugeUri = await referenceFor(original, hugeModel, hugeModel.scopes[0]);
const guide = '# Guide\n\nRead [storage](reference/storage.md#retention-policy "Policy"), [whole][document], [alpha](#alpha), ' +
  '[ambiguous](reference/collisions.md#foo-1), [missing](absent.md), [large](large.md), [large identity](' + hugeUri + '), ' +
  '[changed](' + durable + ').\n\n## Alpha\n\nOriginal selectable target words.\n\n[document]: reference/storage.md\n';
const data = await packageBytes({'guide.md': guide, 'reference/storage.md': target.replace('seven days', 'eight days'),
  'reference/collisions.md': '# Foo\n# Foo\n# Foo-1\n', 'large.md': 'x'.repeat(2 * 1024 * 1024 + 1)});
const card = page => page.locator('#reference-preview');
const local = (page, name) => page.locator('#reader article').getByRole('button', {name, exact: true});
async function open(page) {
  await page.goto('/');
  await page.locator('#package-file').setInputFiles({name: 'links.mdpkg', mimeType: 'application/zip', buffer: data});
  await expect(page.locator('.document-title')).toHaveText('guide.md');
}

test('preview preserves reader, definitions, IDs and drafts; nested links retain original origin; Open/Back works', async ({page}) => {
  const requests = [], errors = []; page.on('request', r => requests.push(r.url())); page.on('pageerror', e => errors.push(e.message));
  await open(page);
  await page.getByRole('button', {name: 'Review selected section', exact: true}).click();
  await page.getByLabel('Your name').fill('Reviewer'); await page.getByLabel('Feedback', {exact: true}).fill('Draft stays here');
  await local(page, 'storage').scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => ({text: document.querySelector('#reader article').textContent,
    scope: document.querySelector('[aria-label="Document section"]').value, y: scrollY, history: history.length}));
  await local(page, 'storage').click();
  await expect(card(page)).toBeVisible(); await expect(card(page)).toContainText('eight days');
  await expect(card(page).locator('h2').first()).toBeFocused();
  await expect(card(page).locator('table')).toHaveCount(1);
  await expect(card(page).getByRole('button', {name: 'guide', exact: true})).toBeVisible();
  await expect(page.locator('.document-title')).toHaveText('guide.md');
  expect(await page.evaluate(() => ({text: document.querySelector('#reader article').textContent,
    scope: document.querySelector('[aria-label="Document section"]').value, y: scrollY, history: history.length}))).toEqual(before);
  expect(await page.evaluate(() => { const ids = [...document.querySelectorAll('[id]')].map(e => e.id); return ids.length === new Set(ids).size; })).toBe(true);
  await expect(card(page).locator('img,script')).toHaveCount(0);
  await card(page).getByRole('button', {name: 'self', exact: true}).click();
  await expect(card(page)).toContainText('eight days');
  await card(page).getByRole('button', {name: 'guide', exact: true}).click();
  await expect(card(page)).toContainText('Original selectable target words');
  await page.keyboard.press('Escape'); await expect(local(page, 'storage')).toBeFocused();
  await local(page, 'storage').press('Space'); await expect(card(page)).toContainText('eight days');
  await card(page).getByRole('button', {name: 'Open section', exact: true}).click();
  await expect(page.locator('.document-title')).toHaveText('reference/storage.md');
  await page.getByRole('button', {name: 'Back to reference', exact: true}).click();
  await expect(page.locator('.document-title')).toHaveText('guide.md'); await expect(local(page, 'storage')).toBeFocused();
  await expect(page.getByLabel('Feedback', {exact: true})).toHaveValue('Draft stays here');
  expect(requests.some(url => /example\.com|\/git-[^/]+\.js/.test(url))).toBe(false); expect(errors).toEqual([]);
});

test('lookup ambiguity, absent targets, changed source and size errors show distinct actions', async ({page}) => {
  await open(page);
  for (const [name, notice, canOpen] of [['ambiguous', 'Choose a section', true], ['missing', 'Target not found', false],
    ['large', 'Document too large to preview', true], ['large identity', 'Document too large to preview', false],
    ['changed', 'Content changed since this link was copied', true]]) {
    await local(page, name).click(); await expect(card(page)).toContainText(notice);
    expect(await card(page).getByRole('button', {name: /^Open (section|document)$/}).count()).toBe(canOpen ? 1 : 0);
    await card(page).getByRole('button', {name: 'Close', exact: true}).click();
  }
});

test('Enter, Space, repeated activation, Tab, Escape and outside focus have disclosure behavior', async ({page}) => {
  await open(page); await local(page, 'storage').focus(); await page.keyboard.press('Enter');
  await expect(card(page)).toBeVisible(); await expect(local(page, 'storage')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab'); await expect(card(page).getByRole('button', {name: 'Close', exact: true})).toBeFocused();
  await page.keyboard.press('Escape'); await expect(card(page)).toBeHidden(); await expect(local(page, 'storage')).toBeFocused();
  await page.keyboard.press('Space'); await expect(card(page)).toContainText('eight days');
  await local(page, 'storage').focus(); await page.keyboard.press('Enter'); await expect(card(page)).toBeHidden();
  await local(page, 'storage').click(); await expect(card(page)).toBeVisible();
  await page.getByRole('button', {name: 'View source', exact: true}).focus(); await expect(card(page)).toBeHidden();
  await expect(page.getByRole('button', {name: 'View source', exact: true})).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.locator('#reader article')).toHaveText(guide);
  await expect(page.locator('#reader article a')).toHaveCount(0);
});

test('copy Markdown uses the editable plain label and retains expect', async ({page, context}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']); await open(page);
  await page.getByLabel('Document section').selectOption('3');
  await page.getByRole('button', {name: 'Reference to selected section', exact: true}).click();
  await expect(page.getByLabel('Link label', {exact: true})).toHaveValue('Alpha');
  await page.getByLabel('Link label', {exact: true}).fill('an [escaped] *label*');
  await page.getByRole('button', {name: 'Copy Markdown link', exact: true}).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^\[an \\\[escaped\\\] \\\*label\\\*\]\(mdpkg:\/\//); expect(copied).toContain('&expect=');
  await page.getByRole('button', {name: 'Copy reference', exact: true}).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await page.locator('#generated-reference').inputValue());
});

for (const width of [1280, 390, 640]) test(`preview viewport bounds and tables at ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height: 844}); await open(page); await local(page, 'storage').click();
  await expect(card(page)).toContainText('eight days');
  const bounds = await card(page).boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(7); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 7);
  expect(bounds.y).toBeGreaterThanOrEqual(7); expect(bounds.y + bounds.height).toBeLessThanOrEqual(837);
  expect(bounds.height).toBeLessThanOrEqual(423);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await card(page).getByRole('button', {name: 'Wrap table 1 text', exact: true}).click();
  await expect(card(page).getByRole('button', {name: 'Wrap table 1 text', exact: true})).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({path: `test-results/preview-${width}.png`, fullPage: true});
});

test.describe('touch preview', () => {
  test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
  test('tap opens and closes the bottom card', async ({page}) => {
    await open(page); await local(page, 'storage').tap(); await expect(card(page)).toContainText('eight days');
    await card(page).getByRole('button', {name: 'Close', exact: true}).tap(); await expect(card(page)).toBeHidden();
  });
});

async function harness(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const {readerView, outline, referencePreview} = await import('/test-api.js');
    document.querySelector('#reference-preview').remove(); document.querySelector('#browser').hidden = false;
    const host = document.querySelector('#reader'); host.replaceChildren();
    const text = '# Main\n\n[A](a.md) [B](b.md) [C](c.md)\n\nOriginal target words.\n';
    const model = outline(new TextEncoder().encode(text), 'main.md');
    window.reads = []; window.inflight = 0; window.maximum = 0; window.releases = [];
    window.testPkg = {documents: ['a.md', 'b.md', 'c.md'].map(name => ({name})), releasePreview() {},
      async previewDocument(name) {
        window.reads.push(name); window.inflight++; window.maximum = Math.max(window.maximum, window.inflight);
        await new Promise(resolve => window.releases.push(resolve)); window.inflight--;
        return outline(new TextEncoder().encode('# ' + name + '\n\nPreview target words.\n'), name);
      }};
    window.testPreview = referencePreview({getPackage: () => window.testPkg, onOpen() {}, onBrowse() {}, onOrdinary() {}});
    window.reader = readerView(host, (...args) => window.testPreview.activate(...args), () => {}, () => {}, () => window.testPreview.close(false));
    window.reader.show(model); window.model = model;
  });
}
test('rapid activation bounds reads and drops intermediate and dismissed loads', async ({page}) => {
  await harness(page); await local(page, 'A').click();
  // The adjacent card may occlude the next phrase. Keyboard activation also
  // exercises outside-focus dismissal while the previous read is pending.
  await local(page, 'B').focus(); await page.keyboard.press('Enter');
  await local(page, 'C').focus(); await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.reads)).toEqual(['a.md']);
  await page.evaluate(() => window.releases.shift()());
  await expect.poll(() => page.evaluate(() => window.reads)).toEqual(['a.md', 'c.md']);
  await page.evaluate(() => window.releases.shift()()); await expect(card(page)).toContainText('c.md');
  expect(await page.evaluate(() => window.maximum)).toBe(1);
  await local(page, 'A').click(); await page.keyboard.press('Escape');
  await page.evaluate(() => window.releases.shift()()); await expect(card(page)).toBeHidden();
});
test('package change, source change and origin removal invalidate outstanding preview', async ({page}) => {
  for (const change of ['package', 'source', 'origin']) {
    await harness(page); await local(page, 'A').click();
    await page.evaluate(change => {
      if (change === 'package') { window.testPreview.close(false); window.testPkg = undefined; }
      if (change === 'source') document.querySelector('.reader-controls button').click();
      if (change === 'origin') document.querySelector('#reader article a').remove();
      window.releases.shift()();
    }, change);
    await expect(card(page)).toBeHidden();
  }
});
test('preview selection is isolated and original selection verification remains exact', async ({page}) => {
  await harness(page); await local(page, 'A').click(); await page.evaluate(() => window.releases.shift()());
  await expect(card(page)).toContainText('Preview target words');
  const result = await page.evaluate(async () => {
    const {selectionAnchor} = await import('/test-api.js');
    const article = document.querySelector('#reader article'), p = article.querySelectorAll('p')[1];
    const range = document.createRange(); range.setStart(p.firstChild, 9); range.setEnd(p.firstChild, 21);
    const quote = selectionAnchor(window.model, article, range, false).select.quote;
    const previewText = document.querySelector('.preview-content p').firstChild;
    range.setStart(previewText, 0); range.setEnd(previewText, 7);
    getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event('selectionchange'));
    let error; try { window.reader.anchor(); } catch (e) { error = e.message; }
    return {quote, error};
  });
  expect(result.quote).toBe('target words'); expect(result.error).toContain('Open section');
  await expect(page.getByRole('toolbar', {name: 'Text selection'}).last()).toBeHidden();
});
test('modified and drag selection gestures do not open previews', async ({page}) => {
  await harness(page); await local(page, 'A').click({modifiers: ['Shift']}); await expect(card(page)).toBeHidden();
  await local(page, 'A').click({modifiers: ['Control']}); await expect(card(page)).toBeHidden();
  await local(page, 'A').evaluate(link => {
    link.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, clientX: 1, clientY: 1}));
    link.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, detail: 1, clientX: 100, clientY: 1}));
  });
  await expect(card(page)).toBeHidden(); expect(await page.evaluate(() => window.reads)).toEqual([]);
});

test('200% CSS zoom preserves card bounds and closes when a desktop origin leaves view', async ({page}) => {
  await page.setViewportSize({width: 1280, height: 844}); await open(page);
  await page.evaluate(() => { document.body.style.zoom = '2'; });
  await local(page, 'storage').click(); await expect(card(page)).toContainText('eight days');
  const bounds = await card(page).boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(1280);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  await page.evaluate(() => window.scrollTo(0, 0)); await expect(card(page)).toBeHidden();
});

test('one MiB targets produce bounded excerpts; collect representative retained heap measurements', async ({page}) => {
  const text = 'x'.repeat(1024 * 1024 - 1) + '\n';
  const bytes = await packageBytes({'guide.md': '# Guide\n\n[A](a.md) [B](b.md)\n', 'a.md': text, 'b.md': text.replace(/^x/, 'y')});
  await page.goto('/'); await page.locator('#package-file').setInputFiles({name: 'memory.mdpkg', mimeType: 'application/zip', buffer: bytes});
  await expect(page.locator('.document-title')).toHaveText('a.md');
  await page.locator('#documents').getByRole('button', {name: 'guide.md', exact: true}).click();
  await expect(page.locator('.document-title')).toHaveText('guide.md');
  const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
  async function heap() {
    await cdp.send('HeapProfiler.collectGarbage');
    return (await cdp.send('Performance.getMetrics')).metrics.find(m => m.name === 'JSHeapUsedSize').value;
  }
  const samples = {documentBytes: 1024 * 1024, baseline: await heap(), active: []};
  for (let i = 0; i < 6; i++) {
    await local(page, i % 2 ? 'B' : 'A').focus(); await page.keyboard.press('Enter');
    await expect(card(page)).toContainText('Canonical source excerpt');
    expect((await card(page).locator('pre').textContent()).length).toBe(16000);
    samples.active.push(await heap());
  }
  await page.keyboard.press('Escape'); samples.closed = await heap();
  await fs.writeFile('test-results/preview-memory.json', JSON.stringify(samples, null, 2));
  // Broad leak tripwire only; exact measurements are recorded, not portable budgets.
  expect(samples.active.at(-1) - samples.active[0]).toBeLessThan(4 * 1024 * 1024);
});
