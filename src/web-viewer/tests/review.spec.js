import {test, expect} from '@playwright/test';
import fs from 'node:fs/promises';

test('browser authors request, reply and state; downloads an independently readable delta', async ({page}) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('#package-file').setInputFiles('../../docs/spec/review-fixtures/original.mdpkg');
  await expect(page.locator('.document-title')).toHaveText('guide.md');
  await page.evaluate(() => {
    const paragraph = document.querySelector('.markdown > p'), node = paragraph.firstChild;
    const start = node.data.indexOf('target words'), range = document.createRange();
    range.setStart(node, start); range.setEnd(node, start + 12);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  await page.getByRole('button', {name: 'Review selected text', exact: true}).click();
  await expect(page.locator('.review-editor .review-quote')).toHaveText('target words');
  await page.getByLabel('Your name').fill('Browser Reviewer');
  await page.getByLabel('Kind', {exact: true}).selectOption('change-request');
  await page.getByLabel('Feedback', {exact: true}).fill('Explain these words.');
  await page.getByRole('button', {name: 'Save comment', exact: true}).click();
  await expect(page.locator('.review-thread')).toHaveCount(1);
  await page.getByRole('button', {name: 'Reply', exact: true}).click();
  await page.getByLabel('Feedback', {exact: true}).fill('This reply keeps source order.');
  await page.getByRole('button', {name: 'Save comment', exact: true}).click();
  await expect(page.locator('.review-comment')).toHaveCount(2);
  await page.getByLabel('Thread state', {exact: true}).selectOption('resolved');
  await page.getByRole('button', {name: 'Prepare review file'}).click();
  await expect(page.getByRole('button', {name: 'Download review'})).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Download review'}).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('original-review.mdpkg');
  await download.saveAs('test-results/browser-review.mdpkg');
  const bytes = [...await fs.readFile('test-results/browser-review.mdpkg')];
  const document = await page.evaluate(async data => {
    const {openPackage, readComments} = await import('/test-api.js');
    const pkg = await openPackage(new Blob([new Uint8Array(data)]));
    return {manifest: pkg.manifest, doc: readComments(await pkg.read(pkg.manifest.review.detail)), ordinary: pkg.documents.length};
  }, bytes);
  expect(document.manifest.review.shape).toBe('delta'); expect(document.ordinary).toBe(0);
  const thread = document.doc.threads[0];
  expect(document.doc.version).toBe(2); expect(thread.state).toBe('resolved');
  expect(thread.select).toMatchObject({start: 28, end: 40, quote: 'target words'});
  expect(thread.comments.map(c => c.kind)).toEqual(['change-request', 'comment']);
  expect(thread.comments[1].inReplyTo).toBe(thread.comments[0].id);
  await page.getByLabel('Thread state', {exact: true}).selectOption('obsolete');
  await expect(page.getByRole('button', {name: 'Download review'})).toBeHidden();
  await page.setViewportSize({width: 390, height: 844});
  await page.screenshot({path: 'test-results/review-mobile.png', fullPage: true});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('DOM selection maps inline/block/source selections and refuses transformed or ambiguous endpoints', async ({page}) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const {readerView, outline, selectionAnchor} = await import('/test-api.js');
    const cases = [
      {source: '# Test\n\nPlain 😀 target words.\n', element: 'p', needle: 'target', quote: 'target'},
      {source: '# Test\n\nBefore *emphasis* after.\n', element: 'em', needle: 'emphasis', quote: 'emphasis'},
      {source: '# Test\n\nBefore `code span` after.\n', element: 'code', needle: 'code span', quote: 'code span'},
      {source: '# Test\n\n- list target\n', element: 'li', needle: 'target', quote: 'target'},
      {source: '# Test\n\nA &amp; entity.\n', element: 'p', needle: '&', fail: true},
      {source: '# Test\n\n*x* and *x*\n', element: 'em', needle: 'x', fail: true},
      // Unique normalized code literal also occurs elsewhere: never map there.
      {source: '# Test\n\n`a\nb` and [else](a%20b) a b\n', element: 'code', needle: 'a b', fail: true},
    ];
    const results = [];
    for (const c of cases) {
      const host = document.createElement('div'); document.body.append(host);
      const model = outline(new TextEncoder().encode(c.source), 'test.md');
      const view = readerView(host, () => {}, () => {}); view.show(model);
      const block = host.querySelector('.markdown'), element = block.querySelector(c.element);
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node; while ((node = walker.nextNode()) && !node.data.includes(c.needle)) {}
      const range = document.createRange(), at = node.data.indexOf(c.needle);
      range.setStart(node, at); range.setEnd(node, at + c.needle.length);
      try { results.push({quote: selectionAnchor(model, block, range, false).select.quote, expected: c.quote, fail: c.fail ?? false}); }
      catch (error) { results.push({error: error.message, fail: c.fail ?? false}); }
      host.remove();
    }
    // Actual range crosses two child sections: choose their common parent.
    const host = document.createElement('div'); document.body.append(host);
    const model = outline(new TextEncoder().encode('# Parent\n\n## One\n\nfirst\n\n## Two\n\nsecond\n'), 'test.md');
    const view = readerView(host, () => {}, () => {}); view.show(model);
    const block = host.querySelector('.markdown'), paragraphs = block.querySelectorAll('p'), range = document.createRange();
    range.setStart(paragraphs[0].firstChild, 0); range.setEnd(paragraphs[1].firstChild, 6);
    const spanning = selectionAnchor(model, block, range, false);
    // Source mode can select entity syntax exactly.
    host.querySelector('.reader-controls button').click();
    const code = block.querySelector('code'), sourceRange = document.createRange();
    sourceRange.setStart(code.firstChild, 0); sourceRange.setEnd(code.firstChild, 8);
    const source = selectionAnchor(model, block, sourceRange, true);
    return {results, spanning: {title: spanning.scope.title, quote: spanning.select.quote}, source: source.select.quote};
  });
  for (const result of results.results) {
    if (result.fail) expect(result.error).toBeTruthy();
    else { expect(result.error).toBeUndefined(); expect(result.quote).toBe(result.expected); }
  }
  expect(results.spanning).toEqual({title: '# Parent', quote: 'first\n\n## Two\n\nsecond'});
  expect(results.source).toBe('# Parent');
});

test('section authoring, source fallback, unsaved guard and share cancellation', async ({page}) => {
  await page.addInitScript(() => {
    navigator.canShare = () => true;
    navigator.share = async data => { window.sharedFile = {name: data.files[0].name, size: data.files[0].size}; throw new DOMException('Cancelled', 'AbortError'); };
  });
  await page.goto('/');
  await page.locator('#package-file').setInputFiles('../../docs/spec/review-fixtures/original.mdpkg');
  await page.getByLabel('Document section').selectOption('3');
  await page.getByRole('button', {name: 'Review selected section', exact: true}).click();
  await expect(page.locator('.review-editor .review-quote')).toContainText('## Usage');
  await page.getByLabel('Your name').fill('A <script>');
  await page.getByLabel('Feedback', {exact: true}).fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', {name: 'Save comment', exact: true}).click();
  expect(await page.locator('.review-comment img').count()).toBe(0);
  await page.getByRole('button', {name: 'Prepare review file'}).click();
  await page.getByRole('button', {name: 'Share review', exact: true}).click();
  await expect(page.locator('.review-status')).toContainText('Sharing cancelled');
  expect(await page.evaluate(() => window.sharedFile)).toMatchObject({name: 'original-review.mdpkg'});
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#package-file').setInputFiles('../../docs/spec/review-fixtures/original.mdpkg');
  await expect(page.locator('.review-thread')).toHaveCount(1);
});

test('draft mutation during preparation cannot offer a stale download', async ({page}) => {
  await page.goto('/');
  await page.locator('#package-file').setInputFiles('../../docs/spec/review-fixtures/original.mdpkg');
  await expect(page.locator('.document-title')).toHaveText('guide.md');
  await page.getByRole('button', {name: 'Review selected section', exact: true}).click();
  await page.getByLabel('Your name').fill('Reviewer');
  await page.getByLabel('Feedback', {exact: true}).fill('Initial feedback');
  await page.getByRole('button', {name: 'Save comment', exact: true}).click();
  // Stall snapshot hashing after the export snapshot is taken; no Git chunk loads.
  await page.evaluate(() => {
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let once = true;
    crypto.subtle.digest = async (...args) => {
      if (once) { once = false; await new Promise(resolve => { window.releaseHash = resolve; }); }
      return digest(...args);
    };
  });
  await page.getByRole('button', {name: 'Prepare review file'}).click();
  await expect(page.locator('.review-status')).toContainText('Building');
  await page.getByLabel('Thread state', {exact: true}).selectOption('obsolete');
  await page.evaluate(() => window.releaseHash());
  await expect(page.locator('.review-status')).toContainText('Draft changed');
  await expect(page.getByRole('button', {name: 'Download review'})).toBeHidden();
  await page.getByRole('button', {name: 'Prepare review file'}).click();
  await expect(page.getByRole('button', {name: 'Download review'})).toBeVisible();
});
