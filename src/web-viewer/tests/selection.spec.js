import {test, expect} from '@playwright/test';

const prose = '# Parent\n\nIntro text.\n\n## One\n\nDr. Smith uses e.g. *target words* here. Another sentence follows.\n\nA second paragraph.\n\n### Child\n\nNested text.\n\n## Two\n\nOther section.\n';
const toolbar = page => page.getByRole('toolbar', {name: 'Text selection'});
const selected = page => page.evaluate(() => getSelection().toString());

async function mount(page, source = prose) {
  await page.goto('/');
  await page.evaluate(async source => {
    const {readerView, outline} = await import('/test-api.js');
    document.querySelector('#app').hidden = true;
    const host = document.createElement('div'); host.id = 'test-reader'; host.className = 'reader-panel';
    host.style.margin = '60px 16px'; document.body.append(host);
    const model = outline(new TextEncoder().encode(source), 'test.md');
    window.testReader = readerView(host, href => { window.navigated = href; }, () => {}, () => {
      try { window.commentQuote = window.testReader.anchor().select.quote; }
      catch (error) { window.commentError = error.message; }
    });
    window.testReader.show(model);
  }, source);
}

async function point(page, selector, needle, offset = 1) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  return page.locator(selector).evaluate((element, {needle, offset}) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node; while ((node = walker.nextNode()) && !node.data.includes(needle)) {}
    if (!node) throw Error('Missing text: ' + needle);
    const range = document.createRange(), start = node.data.indexOf(needle) + offset;
    range.setStart(node, start); range.setEnd(node, start + 1);
    const rect = range.getBoundingClientRect();
    return {x: rect.left + rect.width / 3, y: rect.top + rect.height / 2};
  }, {needle, offset});
}

async function clickWord(page, selector, needle) {
  const {x, y} = await point(page, selector, needle);
  await page.mouse.click(x, y);
}

test('word click hands the exact selection to existing authoring and hides on save', async ({page}) => {
  await page.goto('/');
  await page.locator('#package-file').setInputFiles('../../docs/spec/review-fixtures/original.mdpkg');
  await expect(page.locator('.document-title')).toHaveText('guide.md');
  await clickWord(page, '.markdown > p:first-of-type', 'target');
  await expect(toolbar(page)).toBeVisible();
  expect(await selected(page)).toBe('target');
  await toolbar(page).getByRole('button', {name: 'Leave comment'}).click();
  await expect(page.locator('.review-editor .review-quote')).toHaveText('target');
  await expect(toolbar(page)).toBeHidden();
  await page.getByLabel('Your name').fill('Click reviewer');
  await page.getByLabel('Feedback', {exact: true}).fill('Comment from a word click.');
  await page.getByRole('button', {name: 'Save comment', exact: true}).click();
  await expect(page.locator('.review-thread')).toHaveCount(1);
  await expect(toolbar(page)).toBeHidden();
});

test('expand follows prose/block/section boundaries and collapse restores exact DOM endpoints', async ({page}) => {
  await mount(page);
  await clickWord(page, '.markdown em', 'target');
  const states = [];
  for (const expected of ['target', 'Dr. Smith uses e.g. target words here.',
    'Dr. Smith uses e.g. target words here. Another sentence follows.']) {
    expect(await selected(page)).toBe(expected);
    states.push(await page.evaluate(() => {
      const range = getSelection().getRangeAt(0);
      (window.visited ??= []).push(range.cloneRange());
      return range.toString();
    }));
    await toolbar(page).getByRole('button', {name: 'Expand selection'}).click();
  }
  const section = await selected(page);
  expect(section).toContain('One'); expect(section).toContain('Nested text.');
  expect(section).not.toContain('Other section.'); expect(section).not.toContain('Intro text.');
  await expect(toolbar(page).getByRole('button', {name: 'Expand selection'})).toBeDisabled();
  for (let index = states.length - 1; index >= 0; index--) {
    await toolbar(page).getByRole('button', {name: 'Collapse selection'}).click();
    expect(await selected(page)).toBe(states[index]);
    expect(await page.evaluate(index => {
      const a = getSelection().getRangeAt(0), b = window.visited[index];
      return a.startContainer === b.startContainer && a.startOffset === b.startOffset &&
        a.endContainer === b.endContainer && a.endOffset === b.endOffset;
    }, index)).toBe(true);
  }
  await expect(toolbar(page).getByRole('button', {name: 'Collapse selection'})).toBeDisabled();
  await toolbar(page).getByRole('button', {name: 'Expand selection'}).click();
  await toolbar(page).getByRole('button', {name: 'Leave comment'}).click();
  expect(await page.evaluate(() => window.commentQuote)).toBe('Dr. Smith uses e.g. *target words* here.');
});

test('manual drag remains exact; expansion and keyboard collapse restore the manual range', async ({page}) => {
  await mount(page);
  const start = await point(page, '.markdown em', 'target', 2);
  const end = await point(page, '.markdown em', 'words', 3);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, {steps: 12}); await page.mouse.up();
  const manual = await selected(page);
  expect(manual).toBe('rget wor');
  await expect(toolbar(page)).toBeVisible();
  const expand = toolbar(page).getByRole('button', {name: 'Expand selection'});
  await expand.focus(); await page.keyboard.press('Enter');
  expect(await selected(page)).toBe('Dr. Smith uses e.g. target words here.');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Enter');
  expect(await selected(page)).toBe(manual);
  await toolbar(page).getByRole('button', {name: 'Leave comment'}).click();
  expect(await page.evaluate(() => window.commentQuote)).toBe(manual);
});

test('selection changes reset history; clearing, source changes, navigation and Escape hide the toolbar', async ({page}) => {
  await mount(page);
  await clickWord(page, '.markdown em', 'target');
  await toolbar(page).getByRole('button', {name: 'Expand selection'}).click();
  await clickWord(page, '.markdown > p:nth-of-type(3)', 'second');
  expect(await selected(page)).toBe('second');
  await expect(toolbar(page).getByRole('button', {name: 'Collapse selection'})).toBeDisabled();
  await page.evaluate(() => getSelection().removeAllRanges());
  await expect(toolbar(page)).toBeHidden();
  await clickWord(page, '.markdown em', 'target');
  await toolbar(page).getByRole('button', {name: 'Expand selection'}).focus();
  await page.keyboard.press('Escape');
  await expect(toolbar(page)).toBeHidden();
  await page.getByRole('button', {name: 'View source', exact: true}).click();
  await expect(toolbar(page)).toBeHidden();
  await page.evaluate(() => {
    const node = document.querySelector('.markdown code').firstChild;
    const range = document.createRange(), start = node.data.indexOf('*target');
    range.setStart(node, start); range.setEnd(node, start + 14);
    getSelection().removeAllRanges(); getSelection().addRange(range);
  });
  await expect(toolbar(page)).toBeVisible();
  await expect(toolbar(page).getByRole('button', {name: 'Expand selection'})).toBeDisabled();
  await toolbar(page).getByRole('button', {name: 'Leave comment'}).click();
  expect(await page.evaluate(() => window.commentQuote)).toBe('*target words*');
  await page.getByRole('button', {name: 'View rendered', exact: true}).click();
  await clickWord(page, '.markdown em', 'target');
  await page.locator('#test-reader').getByLabel('Document section').selectOption('5');
  await expect(toolbar(page)).toBeHidden();
});

test('inline word boundaries cross formatting; links and blank space retain native behavior', async ({page}) => {
  await mount(page, '# Title\n\nPlease co*oper*ate now.\n\n[Follow link](other.md)\n');
  // Exercise the older caretRangeFromPoint branch as well.
  await page.evaluate(() => { document.caretPositionFromPoint = undefined; });
  await clickWord(page, '.markdown em', 'oper');
  expect(await selected(page)).toBe('cooperate');
  await toolbar(page).getByRole('button', {name: 'Leave comment'}).click();
  expect(await page.evaluate(() => window.commentQuote)).toBe('co*oper*ate');
  await page.getByRole('link', {name: 'Follow link'}).click();
  expect(await page.evaluate(() => window.navigated)).toBe('other.md');
  await expect(toolbar(page)).toBeHidden();
  const box = await page.locator('.markdown > p').first().boundingBox();
  await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
  await expect(toolbar(page)).toBeHidden();
});

test('ambiguous rendered selection still uses the existing source fallback', async ({page}) => {
  await mount(page, '# Test\n\n*repeat* and *repeat*\n');
  await clickWord(page, '.markdown em:first-child', 'repeat');
  await toolbar(page).getByRole('button', {name: 'Leave comment'}).click();
  expect(await page.evaluate(() => window.commentError)).toContain('Use View source');
  expect(await page.evaluate(() => window.commentQuote)).toBeUndefined();
});

test('DOM expansion respects list, quote, code, Setext and preamble boundaries', async ({page}) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const {readerView, outline, nextExpansion} = await import('/test-api.js');
    const cases = [
      {source: '# T\n\n- First word. Second sentence.\n- Other item.\n', selector: 'li', needle: 'word', sentence: 'First word.', paragraph: 'First word. Second sentence.'},
      {source: '# T\n\n- First word. Second sentence.\n  - Nested item.\n- Other item.\n', selector: 'li', needle: 'word', sentence: 'First word.', paragraph: 'First word. Second sentence.'},
      {source: '# T\n\n> First word. Second sentence.\n>\n> Another paragraph.\n', selector: 'blockquote p', needle: 'word', sentence: 'First word.', paragraph: 'First word. Second sentence.'},
      {source: '# T\n\n```\nFirst word. Second line.\n```\n', selector: 'pre', needle: 'word', sentence: 'First word.', paragraph: 'First word. Second line.'},
      {source: 'Intro word. More prose.\n\nTitle\n=====\n\nOther body.\n', selector: 'p', needle: 'word', sentence: 'Intro word.', paragraph: 'Intro word. More prose.'},
    ];
    return cases.map(c => {
      const host = document.createElement('div'); document.body.append(host);
      const model = outline(new TextEncoder().encode(c.source), 'test.md');
      readerView(host, () => {}, () => {}).show(model);
      const content = host.querySelector('.markdown'), element = content.querySelector(c.selector);
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node; while ((node = walker.nextNode()) && !node.data.includes(c.needle)) {}
      let range = document.createRange(); range.setStart(node, node.data.indexOf(c.needle)); range.setEnd(node, node.data.indexOf(c.needle) + c.needle.length);
      const outputs = [];
      for (let i = 0; i < 5; i++) {
        const next = nextExpansion(content, range, model); if (!next) break;
        outputs.push({level: next.level, text: next.range.toString()}); range = next.range;
      }
      host.remove(); return {outputs, sentence: c.sentence, paragraph: c.paragraph};
    });
  });
  for (const result of results) {
    expect(result.outputs[0]).toEqual({level: 'sentence', text: result.sentence});
    expect(result.outputs[1]).toEqual({level: 'paragraph', text: result.paragraph});
  }
  expect(results.at(-1).outputs).toHaveLength(2); // Preamble ends before the Setext heading.
});

test('manual partial words snap outward and cross-section ranges expand to their common section', async ({page}) => {
  await mount(page);
  await page.evaluate(() => {
    const node = document.querySelector('.markdown em').firstChild, range = document.createRange();
    range.setStart(node, 1); range.setEnd(node, 4);
    getSelection().removeAllRanges(); getSelection().addRange(range);
  });
  await expect(toolbar(page)).toBeVisible();
  await toolbar(page).getByRole('button', {name: 'Expand selection'}).click();
  expect(await selected(page)).toBe('target');
  await toolbar(page).getByRole('button', {name: 'Collapse selection'}).click();
  expect(await selected(page)).toBe('arg');
  await page.evaluate(() => {
    const paragraphs = document.querySelectorAll('.markdown p'), range = document.createRange();
    range.setStart(paragraphs[2].firstChild, 2); range.setEnd(paragraphs[4].firstChild, 5);
    getSelection().removeAllRanges(); getSelection().addRange(range);
  });
  await expect(toolbar(page).getByRole('button', {name: 'Collapse selection'})).toBeDisabled();
  const manual = await selected(page);
  await toolbar(page).getByRole('button', {name: 'Expand selection'}).click();
  const section = await selected(page);
  expect(section).toContain('Parent'); expect(section).toContain('Other section.');
  await expect(toolbar(page).getByRole('button', {name: 'Expand selection'})).toBeDisabled();
  await toolbar(page).getByRole('button', {name: 'Collapse selection'}).click();
  expect(await selected(page)).toBe(manual);
});

test('native double-click and backward drag keep their selections', async ({page}) => {
  await mount(page);
  const target = await point(page, '.markdown em', 'target');
  await page.mouse.dblclick(target.x, target.y);
  expect(await selected(page)).toBe('target');
  const end = await point(page, '.markdown em', 'words', 3);
  const start = await point(page, '.markdown em', 'target', 2);
  await page.mouse.move(end.x, end.y); await page.mouse.down();
  await page.mouse.move(start.x, start.y, {steps: 12}); await page.mouse.up();
  expect(await selected(page)).toBe('rget wor');
  await toolbar(page).getByRole('button', {name: 'Leave comment'}).click();
  expect(await page.evaluate(() => window.commentQuote)).toBe('rget wor');
});

test('Tab reaches the toolbar and keyboard focus remains usable at expansion limits', async ({page}) => {
  await mount(page);
  await clickWord(page, '.markdown em', 'target');
  await page.keyboard.press('Tab');
  await expect(toolbar(page).getByRole('button', {name: 'Expand selection'})).toBeFocused();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Enter');
  await expect(toolbar(page).getByRole('button', {name: 'Collapse selection'})).toBeFocused();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Space');
  expect(await selected(page)).toBe('target');
  await expect(toolbar(page).getByRole('button', {name: 'Leave comment'})).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.commentQuote)).toBe('target');
});

test('code-block horizontal scrolling hides clipped selections and anchors to visible portions', async ({page}) => {
  await mount(page, '# T\n\n```\n' + 'padding '.repeat(20) + 'target ' + 'tail '.repeat(40) + '\n```\n');
  const pre = page.locator('.markdown pre');
  await pre.evaluate(pre => { pre.scrollLeft = 800; });
  await clickWord(page, '.markdown pre', 'target');
  expect(await selected(page)).toBe('target');
  await expect(toolbar(page)).toBeVisible();
  // Review 44adf290: the word is outside the code block, but inside the viewport.
  const clipped = await pre.evaluate(pre => {
    const range = getSelection().getRangeAt(0), edge = pre.getBoundingClientRect().right;
    pre.scrollLeft -= edge + 15 - range.getBoundingClientRect().left;
    return {edge, selectionLeft: range.getBoundingClientRect().left, viewport: innerWidth};
  });
  expect(clipped.selectionLeft).toBeGreaterThan(clipped.edge);
  expect(clipped.selectionLeft).toBeLessThan(clipped.viewport);
  await expect(toolbar(page)).toBeHidden();
  expect(await selected(page)).toBe('target');

  // Part of the word reappears at the right edge; then at the left edge.
  for (const side of ['right', 'left']) {
    await pre.evaluate((pre, side) => {
      const range = getSelection().getRangeAt(0), box = pre.getBoundingClientRect();
      const left = box.left + pre.clientLeft, right = left + pre.clientWidth;
      pre.scrollLeft += side === 'right' ? range.getBoundingClientRect().left - (right - 15) :
        range.getBoundingClientRect().right - (left + 15);
    }, side);
    await expect(toolbar(page)).toBeVisible();
    await expect.poll(() => page.evaluate(side => {
      const pre = document.querySelector('.markdown pre'), box = pre.getBoundingClientRect();
      const selection = getSelection().getRangeAt(0).getBoundingClientRect();
      const left = Math.max(selection.left, box.left + pre.clientLeft);
      const right = Math.min(selection.right, box.left + pre.clientLeft + pre.clientWidth);
      const toolbar = document.querySelector('#test-reader .selection-toolbar').getBoundingClientRect();
      return toolbar.right >= left && toolbar.left <= right && (side === 'right' || toolbar.left >= left - 1);
    }, side)).toBe(true);
  }
  await pre.evaluate(pre => { pre.scrollLeft += 40; });
  await expect(toolbar(page)).toBeHidden();
  await pre.evaluate(pre => { pre.scrollLeft = 800; });
  await expect(toolbar(page)).toBeVisible();
});

test('nested scroll clipping keeps later visible text in a multi-block selection available', async ({page}) => {
  await mount(page, '# T\n\n```\ntarget words\n```\n\nVisible paragraph.\n');
  await page.locator('.markdown pre').evaluate(pre => {
    const wrapper = document.createElement('div'); wrapper.id = 'clip-wrapper';
    wrapper.style.cssText = 'height:120px; overflow:auto; border:7px solid black';
    const before = document.createElement('div'), after = document.createElement('div');
    before.style.height = '100px'; after.style.height = '300px';
    pre.before(wrapper); wrapper.append(before, pre, after);
    pre.style.cssText = 'height:70px; margin:0; overflow:auto';
    wrapper.scrollTop = 100;
  });
  await clickWord(page, '.markdown pre', 'target');
  await expect(toolbar(page)).toBeVisible();
  await page.locator('#clip-wrapper').evaluate(wrapper => { wrapper.scrollTop = 200; });
  expect(await page.evaluate(() => {
    const rect = getSelection().getRangeAt(0).getBoundingClientRect();
    return rect.top > 0 && rect.bottom < innerHeight;
  })).toBe(true);
  await expect(toolbar(page)).toBeHidden();
  await page.locator('#clip-wrapper').evaluate(wrapper => { wrapper.scrollTop = 100; });
  await expect(toolbar(page)).toBeVisible();
  await page.locator('#clip-wrapper').evaluate(wrapper => { wrapper.scrollTop = 200; });
  await expect(toolbar(page)).toBeHidden();
  await page.evaluate(() => {
    const range = getSelection().getRangeAt(0).cloneRange();
    range.setEnd(document.querySelector('.markdown > p').firstChild, 7);
    getSelection().removeAllRanges(); getSelection().addRange(range);
  });
  await expect(toolbar(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const range = document.createRange(); range.selectNodeContents(document.querySelector('.markdown > p'));
    const paragraph = range.getBoundingClientRect();
    const toolbar = document.querySelector('#test-reader .selection-toolbar').getBoundingClientRect();
    return Math.abs(toolbar.bottom + 8 - paragraph.top) < 1;
  })).toBe(true);
});

test('touch toolbar has generous targets and stays within the viewport during resize and scroll', async ({browser}) => {
  const context = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});
  const page = await context.newPage();
  await mount(page);
  const {x, y} = await point(page, '.markdown em', 'target');
  await page.touchscreen.tap(x, y);
  await expect(toolbar(page)).toBeVisible();
  expect(await selected(page)).toBe('target');
  for (const button of await toolbar(page).getByRole('button').all()) {
    const box = await button.boundingBox(); expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await toolbar(page).getByRole('button', {name: 'Expand selection'}).tap();
  expect(await selected(page)).toBe('Dr. Smith uses e.g. target words here.');
  await page.setViewportSize({width: 320, height: 568});
  await expect.poll(async () => {
    const box = await toolbar(page).boundingBox();
    return !!box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 320 && box.y + box.height <= 568;
  }).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: 'test-results/selection-mobile.png'});
  await page.evaluate(() => { document.body.style.paddingBottom = '1500px'; window.scrollTo(0, document.body.scrollHeight); });
  await expect(toolbar(page)).toBeHidden();
  await page.locator('.markdown em').scrollIntoViewIfNeeded();
  await expect(toolbar(page)).toBeVisible();
  await context.close();
});
