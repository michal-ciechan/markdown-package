import {test, expect} from '@playwright/test';
import {trackTableObservers, observedRows} from './table-observer-helper.js';

const source = '# Tables\n\n| Name | Details | Value |\n| :--- | :---: | ---: |\n' +
  '| **Alpha** | A sentence with `code`. | 42 |\n| same | same | 7 |\n\n' +
  '| Other | Notes |\n| --- | --- |\n| Beta | Other table |\n';
const wrap = (page, index = 1) => page.getByRole('button', {name: `Wrap table ${index} text`, exact: true});

async function mount(page, text = source) {
  await page.goto('/');
  await page.evaluate(async text => {
    const {readerView, outline} = await import('/test-api.js');
    document.querySelector('#app').hidden = false;
    document.querySelector('#browser').hidden = false;
    const host = document.querySelector('#reader');
    // Use the real grid/panel widths, with a fresh reader so callbacks are observable.
    host.replaceChildren();
    window.model = outline(new TextEncoder().encode(text), 'tables.md');
    window.reader = readerView(host, href => { window.navigated = href; }, () => {}, () => {
      try { window.quote = window.reader.anchor().select.quote; }
      catch (error) { window.anchorError = error.message; }
    });
    window.reader.show(window.model);
  }, text);
}

async function anchor(page, selector, needle) {
  return page.locator(selector).evaluate((element, needle) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node; while ((node = walker.nextNode()) && !node.data.includes(needle)) {}
    const range = document.createRange(), at = node.data.indexOf(needle);
    range.setStart(node, at); range.setEnd(node, at + needle.length);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    try { return {quote: window.reader.anchor().select.quote}; }
    catch (error) { return {error: error.message}; }
  }, needle);
}

test('renders semantic tables, aligned cells and inline content with independent keyboard toggles', async ({page}) => {
  await mount(page);
  await expect(page.locator('.markdown table')).toHaveCount(2);
  await expect(page.locator('thead th[scope="col"]')).toHaveCount(5);
  await expect(page.locator('td strong')).toHaveText('Alpha');
  await expect(page.locator('td code')).toHaveText('code');
  expect(await page.locator('thead tr').first().locator('th').evaluateAll(cells =>
    cells.map(cell => getComputedStyle(cell).textAlign))).toEqual(['left', 'center', 'right']);
  await expect(wrap(page)).toHaveAttribute('aria-pressed', 'true');
  await wrap(page).focus(); await page.keyboard.press('Space');
  await expect(wrap(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(wrap(page, 2)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Enter');
  await expect(wrap(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await wrap(page).evaluate(button => ({width: button.offsetWidth, height: button.offsetHeight})))
    .toEqual({width: 32, height: 32});
  await page.keyboard.press('Tab');
  await expect(page.getByRole('region', {name: 'Table 1', exact: true})).toBeFocused();
  await page.screenshot({path: 'test-results/tables-controls.png', fullPage: true});
});

for (const width of [1280, 700, 699, 390]) {
  test(`wrap control placement, quiet state and 44px hit area at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 844});
    await mount(page);
    await wrap(page).scrollIntoViewIfNeeded();
    if (width >= 700) await expect.poll(() => page.locator('.table-container').first().evaluate(container => {
      const button = container.querySelector('button').getBoundingClientRect();
      const row = container.querySelector('tr').getBoundingClientRect();
      return Math.abs(button.y + button.height / 2 - row.y - row.height / 2);
    })).toBeLessThanOrEqual(1);
    const layout = await wrap(page).evaluate(button => {
      const box = button.getBoundingClientRect(), container = button.closest('.table-container');
      const table = container.querySelector('.table-scroll').getBoundingClientRect();
      const article = button.closest('.markdown');
      // Probe all four corners of the 44px target, outside the visible box.
      const hits = [-21.5, 21.5].flatMap(dx => [-21.5, 21.5].map(dy =>
        document.elementFromPoint(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy) === button));
      return {width: box.width, height: box.height, left: box.left, right: box.right,
        bottom: box.bottom, tableLeft: table.left, tableTop: table.top, tableRight: table.right,
        padding: getComputedStyle(article).paddingLeft, hits,
        background: getComputedStyle(button).backgroundColor};
    });
    expect(layout.width).toBe(32); expect(layout.height).toBe(32);
    expect(layout.hits).toEqual([true, true, true, true]);
    expect(layout.background).toBe('rgb(255, 255, 255)');
    if (width >= 700) {
      expect(layout.right).toBeLessThan(layout.tableLeft);
      expect(layout.padding).toBe('44px');
    } else {
      expect(layout.bottom).toBeLessThan(layout.tableTop);
      expect(layout.left).toBeGreaterThan(layout.tableLeft);
      expect(layout.right + 6).toBeCloseTo(layout.tableRight, 0);
      expect(layout.padding).toBe('0px');
    }
    // Activate via the invisible extension, then check the non-default tint.
    const box = await wrap(page).boundingBox();
    await page.mouse.click(box.x - 5, box.y + box.height / 2);
    await expect(wrap(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(wrap(page)).toHaveCSS('background-color', 'rgb(226, 236, 245)');
    await expect(wrap(page, 2)).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path: `test-results/table-gutter-${width}.png`, fullPage: true});
  });
}

for (const observer of [true, false]) {
  test(`nowrap gutter follows breakpoint transitions with ResizeObserver ${observer ? 'enabled' : 'unavailable'}`, async ({page}) => {
    if (!observer) await page.addInitScript(() => { window.ResizeObserver = undefined; });
    await page.setViewportSize({width: 699, height: 844});
    await mount(page, '| ' + 'wide'.repeat(150) + ' | second |\n| --- | --- |\n| normal | row |\n');
    await wrap(page).click();
    await expect(wrap(page)).toHaveAttribute('aria-pressed', 'false');
    const container = page.locator('.table-container');
    if (observer) await expect.poll(() => container.evaluate(element =>
      element.style.getPropertyValue('--gutter-offset'))).toBe('0px');
    const rowSize = () => container.locator('tr').first().evaluate(row => {
      const {width, height} = row.getBoundingClientRect();
      return {width, height};
    });
    const initialSize = await rowSize();
    for (const width of [700, 701, 900, 699, 700]) {
      await page.setViewportSize({width, height: 844});
      await expect.poll(() => container.evaluate((element, observer) => {
        const button = element.querySelector('button').getBoundingClientRect();
        const table = element.querySelector('.table-scroll').getBoundingClientRect();
        const row = element.querySelector('tr').getBoundingClientRect();
        if (innerWidth < 700) return button.bottom < table.top;
        const aligned = observer
          ? Math.abs(button.y + button.height / 2 - row.y - row.height / 2) <= 1
          : button.top === table.top;
        return button.right < table.left && aligned;
      }, observer)).toBe(true);
      expect(await rowSize()).toEqual(initialSize);
      if (observer) await expect.poll(() => container.evaluate(element =>
        element.style.getPropertyValue('--gutter-offset') === `${element.offsetLeft}px`)).toBe(true);
      else expect(await container.evaluate(element => element.style.getPropertyValue('--gutter-offset'))).toBe('');
    }
  });
}

test('header alignment follows wrapping, resizing and zoom', async ({page}) => {
  await mount(page, '| ' + 'Long heading '.repeat(8) + '| Short |\n| --- | --- |\n| cell | value |\n');
  const alignment = () => page.locator('.table-container').evaluate(container => {
    const button = container.querySelector('button').getBoundingClientRect();
    const row = container.querySelector('tr').getBoundingClientRect();
    return Math.abs(button.y + button.height / 2 - row.y - row.height / 2);
  });
  const heights = [];
  for (const width of [1280, 800]) {
    await page.setViewportSize({width, height: 900});
    for (const nowrap of [false, true]) {
      if ((await wrap(page).getAttribute('aria-pressed') === 'false') !== nowrap) await wrap(page).click();
      await expect.poll(alignment).toBeLessThanOrEqual(1);
      heights.push(await page.locator('tr').first().evaluate(row => row.getBoundingClientRect().height));
    }
  }
  expect(heights[0]).toBeGreaterThan(heights[1]);
  expect(heights[2]).toBeGreaterThan(heights[0]);
  await page.evaluate(() => { document.body.style.zoom = '2'; });
  await expect.poll(alignment).toBeLessThanOrEqual(1);
});

test('nested tables share the article gutter with top-level tables', async ({page}) => {
  await mount(page, source + '\n> | Quote |\n> | --- |\n> | cell |\n\n' +
    '- | List |\n  | --- |\n  | cell |\n\n  > | Nested quote |\n  > | --- |\n  > | cell |\n');
  await expect(wrap(page, 5)).toHaveCount(1);
  await expect.poll(() => page.locator('.table-toolbar button').evaluateAll(buttons => {
    const positions = buttons.map(button => button.getBoundingClientRect().left);
    return Math.max(...positions) - Math.min(...positions);
  })).toBeLessThanOrEqual(1);
});

test('missing ResizeObserver uses top alignment and still toggles', async ({page}) => {
  await page.addInitScript(() => { window.ResizeObserver = undefined; });
  await mount(page, '| ' + 'Long heading '.repeat(8) + '| Short |\n| --- | --- |\n| cell | value |\n');
  const gap = await wrap(page).evaluate(button => button.getBoundingClientRect().top -
    button.closest('.table-container').querySelector('.table-scroll').getBoundingClientRect().top);
  expect(gap).toBe(0);
  await wrap(page).click();
  await expect(wrap(page)).toHaveAttribute('aria-pressed', 'false');
});

test('one row observer is shared and released on source mode, navigation and clear', async ({page}) => {
  await trackTableObservers(page);
  await mount(page);
  expect(await observedRows(page)).toEqual([2]);
  await page.getByRole('button', {name: 'View source', exact: true}).click();
  expect(await observedRows(page)).toEqual([]);
  await page.getByRole('button', {name: 'View rendered', exact: true}).click();
  expect(await observedRows(page)).toEqual([2]);
  await page.evaluate(() => window.reader.show(window.model));
  expect(await observedRows(page)).toEqual([2]);
  await page.evaluate(() => window.reader.clear());
  expect(await observedRows(page)).toEqual([]);
});

test('wrap preferences survive source/render switching and document navigation; clear resets them', async ({page}) => {
  await mount(page); await wrap(page).click();
  await page.getByRole('button', {name: 'View source', exact: true}).click();
  await expect(wrap(page)).toHaveCount(0);
  await expect(page.locator('.markdown pre code')).toHaveText(source);
  await page.getByRole('button', {name: 'View rendered', exact: true}).click();
  await expect(wrap(page)).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(async () => {
    const {outline} = await import('/test-api.js');
    window.reader.show(outline(new TextEncoder().encode(window.model.text), 'other.md'));
  });
  await expect(wrap(page)).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.reader.show(window.model));
  await expect(wrap(page)).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => { window.reader.clear(); window.reader.show(window.model); });
  await expect(wrap(page)).toHaveAttribute('aria-pressed', 'true');
});

for (const width of [1280, 390]) {
  test(`wide tables stay inside their scrollport in both modes at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 844});
    const long = 'token'.repeat(100);
    const many = '| ' + Array.from({length: 36}, (_, i) => `Column ${i}`).join(' | ') + ' |\n' +
      '| ' + Array(36).fill('---').join(' | ') + ' |\n' + '| ' + Array(36).fill(long).join(' | ') + ' |\n';
    await mount(page, '| Code | Prose |\n| --- | --- |\n| `' + long + '` | ' + 'words '.repeat(60) + '|\n\n' + many);
    for (const nowrap of [false, true, false]) {
      if (nowrap || (await wrap(page).getAttribute('aria-pressed')) === 'false') {
        await wrap(page).click(); await wrap(page, 2).click();
      }
      const metrics = await page.locator('.table-scroll').evaluateAll(scrollports => scrollports.map(scroll => {
        const table = scroll.querySelector('table'), cell = table.querySelector('td');
        scroll.scrollLeft = 100;
        return {client: scroll.clientWidth, width: scroll.scrollWidth, scrolled: scroll.scrollLeft,
          whiteSpace: getComputedStyle(cell).whiteSpace, tableWidth: table.getBoundingClientRect().width};
      }));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const metric of metrics) {
        expect(metric.whiteSpace).toBe(nowrap ? 'nowrap' : 'normal');
        if (nowrap) { expect(metric.width).toBeGreaterThan(metric.client); expect(metric.scrolled).toBeGreaterThan(0); }
      }
      if (!nowrap) expect(metrics[0].tableWidth).toBeLessThanOrEqual(metrics[0].client + 1);
    }
    await page.screenshot({path: `test-results/tables-${width}.png`, fullPage: true});
  });
}

test('table comments keep exact cell endpoints, repeated values, inline markup and surrounding prose', async ({page}) => {
  await mount(page, source + '\nAfter table prose.\n');
  expect(await anchor(page, 'td strong', 'Alpha')).toEqual({quote: 'Alpha'});
  expect(await anchor(page, 'tbody tr:nth-child(2) td:nth-child(2)', 'same')).toEqual({quote: 'same'});
  await wrap(page).click();
  expect(await anchor(page, 'td code', 'code')).toEqual({quote: 'code'});
  expect(await anchor(page, '.markdown > p', 'After table')).toEqual({quote: 'After table'});
  const quote = await page.evaluate(() => {
    const cells = document.querySelector('tbody tr').querySelectorAll('td');
    const range = document.createRange(); range.setStart(cells[0].querySelector('strong').firstChild, 0);
    range.setEnd(cells[2].firstChild, 2);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    return window.reader.anchor().select.quote;
  });
  expect(quote).toBe('Alpha** | A sentence with `code`. | 42');
});

test('transformed table content uses the established source-view fallback', async ({page}) => {
  await mount(page, '| Value |\n| --- |\n| &#65;lpha |\n| `a\\|b` |\n');
  expect((await anchor(page, 'tbody tr:first-child td', 'Alpha')).error).toContain('View source');
  expect((await anchor(page, 'td code', 'a|b')).error).toContain('View source');
});

test('click selection and expansion stay within cells before expanding to the enclosing section', async ({page}) => {
  await mount(page);
  const cell = page.locator('tbody tr').first().locator('td').nth(1);
  await cell.scrollIntoViewIfNeeded();
  const point = await cell.evaluate(cell => {
    const range = document.createRange(); range.setStart(cell.firstChild, 3); range.setEnd(cell.firstChild, 4);
    const rect = range.getBoundingClientRect(); return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
  });
  await page.mouse.click(point.x, point.y);
  const toolbar = page.getByRole('toolbar', {name: 'Text selection'});
  await expect(toolbar).toBeVisible();
  expect(await page.evaluate(() => getSelection().toString())).toBe('sentence');
  await toolbar.getByRole('button', {name: 'Expand selection'}).click();
  expect(await page.evaluate(() => getSelection().toString())).toBe('A sentence with code.');
  await toolbar.getByRole('button', {name: 'Expand selection'}).click();
  expect(await page.evaluate(() => getSelection().toString())).toContain('Other table');
  await toolbar.getByRole('button', {name: 'Collapse selection'}).click();
  expect(await page.evaluate(() => getSelection().toString())).toBe('A sentence with code.');
  await toolbar.getByRole('button', {name: 'Leave comment'}).click();
  expect(await page.evaluate(() => window.quote)).toBe('A sentence with `code`.');
});

test('links in cells retain safe external and package navigation and images never load', async ({page}) => {
  const requests = []; page.on('request', request => { if (request.url().startsWith('https://example.com')) requests.push(request.url()); });
  await mount(page, '| Content |\n| --- |\n| [local](guide.md#intro) |\n| [external](https://example.com) |\n' +
    '| [bad](javascript:alert%281%29) |\n| ![image](https://example.com/pixel.png) |\n| <img src=x onerror=alert(1)> |\n');
  await page.getByRole('button', {name: 'local'}).click();
  expect(await page.evaluate(() => window.navigated)).toBe('guide.md#intro');
  await expect(page.getByRole('link', {name: 'external'})).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('td a').filter({hasText: 'bad'})).not.toHaveAttribute('href');
  await expect(page.locator('.markdown img, .markdown script')).toHaveCount(0);
  expect(requests).toEqual([]);
});

test('nested cells map exact UTF-16 offsets across tabs and Unicode', async ({page}) => {
  await mount(page, '# Section\n\n> | Left | Right |\n> | --- | --- |\n> | same | same |\n\n' +
    '- | Left | Right |\n  | --- | --- |\n  | 🧭 café |\tvalue\t|\n');
  expect(await anchor(page, 'blockquote td:nth-child(2)', 'same')).toEqual({quote: 'same'});
  expect(await anchor(page, 'li td:first-child', '🧭 café')).toEqual({quote: '🧭 café'});
  expect(await anchor(page, 'li td:nth-child(2)', 'value')).toEqual({quote: 'value'});
});

test.describe('mobile touch', () => {
  test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
  test('tap toggles an individual table and scrollport is keyboard focusable', async ({page}) => {
    await mount(page);
    await wrap(page).tap();
    await expect(wrap(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(wrap(page, 2)).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('region', {name: 'Table 1', exact: true}).focus();
    await expect(page.getByRole('region', {name: 'Table 1', exact: true})).toBeFocused();
  });
});
