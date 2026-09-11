// Investigation only. Opens a real package in the unmodified production build.
// CSS counterfactuals are temporary browser style elements, never source edits.
// Run after npm run build, from any directory; --package is required.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chromium} from '../../../src/web-viewer/node_modules/playwright/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const args = process.argv.slice(2);
function option(name, fallback) {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  if (!args[at + 1] || args[at + 1].startsWith('--')) throw Error('Missing value for ' + name);
  return args[at + 1];
}
const packagePath = path.resolve(option('--package', ''));
if (!args.includes('--package')) throw Error('Use --package <path to generated sizing.mdpkg>');
const out = path.resolve(option('--out', path.join(here, 'results')));
await fs.mkdir(out, {recursive: true});
const dist = path.join(repo, 'src/web-viewer/dist');
const mime = {'.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html'};
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(dist + path.sep)) throw Error('Outside dist');
    const bytes = await fs.readFile(file);
    res.setHeader('Content-Type', mime[path.extname(file)] ?? 'application/octet-stream');
    res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const localUrl = `http://127.0.0.1:${server.address().port}/`;
const targetUrl = option('--url', localUrl);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceFiles = ['src/styles.css', 'src/ui/table-controls.js', 'src/ui/reader-view.js',
  'src/ui/markdown-parser.js', 'src/ui/markdown-renderer.js'];
const sourceHashes = {};
for (const file of sourceFiles) sourceHashes[file] = sha256(await fs.readFile(path.join(repo, 'src/web-viewer', file)));
const browser = await chromium.launch({headless: true});
const report = {
  generatedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim(),
  browser: browser.version(), platform: process.platform, node: process.version,
  target: targetUrl === localUrl ? 'local production dist' : targetUrl,
  packageSha256: sha256(await fs.readFile(packagePath)),
  sourceHashes, localCssSha256: sha256(await fs.readFile(path.join(dist, 'main.css'))),
  build: JSON.parse(await fs.readFile(path.join(dist, 'build-report.json'), 'utf8')),
  measurements: [], checks: [], consoleErrors: [], requestedUrls: [],
};
const checks = (name, pass, detail) => report.checks.push({name, pass: !!pass, ...(detail === undefined ? {} : {detail})});
const variants = [
  ['shipped-nowrap', ''],
  ['probe-no-width-floor', '.table-nowrap table { min-width: 0; }'],
  ['probe-compact-wrapper', '.table-nowrap table { min-width: 0; } .table-container.table-nowrap { width: fit-content; }'],
];

async function measure(page, width, variant) {
  const value = await page.locator('.table-container').evaluateAll(containers => containers.map((container, index) => {
    const table = container.querySelector('table'), scroll = container.querySelector('.table-scroll');
    const rows = [...table.rows], cells = [...table.querySelectorAll('th,td')];
    const rect = table.getBoundingClientRect(), style = getComputedStyle(table);
    const textMetrics = cell => {
      const range = document.createRange(); range.selectNodeContents(cell);
      const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
      const centers = [];
      for (const r of rects) {
        const center = r.y + r.height / 2;
        if (!centers.some(y => Math.abs(y - center) < 6)) centers.push(center);
      }
      return {contentWidth: range.getBoundingClientRect().width, lines: centers.length};
    };
    scroll.scrollLeft = 100000;
    const maxScrollLeft = scroll.scrollLeft;
    scroll.scrollLeft = 0;
    return {index: index + 1, heading: [...container.parentElement.children].slice(0,
      [...container.parentElement.children].indexOf(container)).filter(e => /^H[1-6]$/.test(e.tagName)).at(-1)?.textContent ?? 'nested',
      tableWidth: rect.width, tableHeight: rect.height, tableArea: rect.width * rect.height,
      wrapperWidth: container.getBoundingClientRect().width,
      wrapperHeight: container.getBoundingClientRect().height,
      scrollClientWidth: scroll.clientWidth, scrollWidth: scroll.scrollWidth, maxScrollLeft,
      computed: {layout: style.tableLayout, width: style.width, minWidth: style.minWidth,
        borderCollapse: style.borderCollapse, borderSpacing: style.borderSpacing},
      columnWidths: [...rows[0].cells].map(c => c.getBoundingClientRect().width),
      rowHeights: rows.map(r => r.getBoundingClientRect().height),
      cells: cells.map(cell => ({text: cell.textContent,
        width: cell.getBoundingClientRect().width, height: cell.getBoundingClientRect().height,
        paddingX: parseFloat(getComputedStyle(cell).paddingLeft) + parseFloat(getComputedStyle(cell).paddingRight),
        lineHeight: getComputedStyle(cell).lineHeight,
        whiteSpace: getComputedStyle(cell).whiteSpace, overflowWrap: getComputedStyle(cell).overflowWrap,
        ...textMetrics(cell)})),
      toolbarRight: container.querySelector('.table-toolbar').getBoundingClientRect().right,
      tableRight: rect.right,
    };
  }));
  const document = await page.evaluate(() => ({viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    articleWidth: document.querySelector('.markdown').getBoundingClientRect().width,
    devicePixelRatio, font: getComputedStyle(document.querySelector('.markdown')).font}));
  const result = {width, variant, document, tables: value};
  report.measurements.push(result);
  checks(`${width}/${variant}: all fixture tables rendered`, value.length === 8);
  checks(`${width}/${variant}: no page overflow`, document.scrollWidth <= document.viewport);
  checks(`${width}/${variant}: scrollers bounded`, value.every(t => t.scrollClientWidth <= document.articleWidth + 1));
  if (variant !== 'shipped-wrap') checks(`${width}/${variant}: nowrap preserved`,
    value.every(t => t.cells.every(c => c.whiteSpace === 'nowrap')));
  if (variant !== 'shipped-wrap') checks(`${width}/${variant}: no extra text lines`,
    value.every(t => t.cells.every(c => c.lines <= 1)));
  return result;
}

try {
  for (const width of [1280, 800, 390]) {
    const page = await browser.newPage({viewport: {width, height: 1000}, deviceScaleFactor: 1});
    page.on('pageerror', error => report.consoleErrors.push(error.message));
    page.on('request', request => report.requestedUrls.push(request.url().replace(localUrl, 'LOCAL/')));
    await page.goto(targetUrl);
    await page.locator('#package-file').setInputFiles(packagePath);
    await page.locator('.markdown table').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await measure(page, width, 'shipped-wrap');
    for (const button of await page.getByRole('button', {name: /^Wrap table \d+ text$/}).all()) await button.click();
    checks(`${width}: actual controls all toggled`, (await page.locator('.table-toolbar button').evaluateAll(
      buttons => buttons.every(button => button.getAttribute('aria-pressed') === 'false'))));
    let style;
    for (const [variant, css] of variants) {
      if (style) await style.evaluate(element => element.remove());
      style = css ? await page.addStyleTag({content: css}) : undefined;
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await measure(page, width, variant);
      if (width === 1280 && ['shipped-nowrap', 'probe-compact-wrapper'].includes(variant)) {
        await page.locator('.table-container').first().screenshot({path: path.join(out, `${width}-${variant}-compact.png`)});
      }
      if (width === 390 && variant !== 'probe-no-width-floor') {
        await page.locator('.table-container').nth(1).screenshot({path: path.join(out, `${width}-${variant}-long-prose.png`)});
      }
    }
    await page.close();
  }
  for (const width of [1280, 800, 390]) {
    const get = variant => report.measurements.find(m => m.width === width && m.variant === variant);
    const baseline = get('shipped-nowrap'), noFloor = get('probe-no-width-floor'), compact = get('probe-compact-wrapper');
    checks(`${width}: shipped columns are unequal`, Math.max(...baseline.tables[0].columnWidths) - Math.min(...baseline.tables[0].columnWidths) > 30);
    checks(`${width}: floor removal does not increase table width`, noFloor.tables.every((t, i) => t.tableWidth <= baseline.tables[i].tableWidth + 1));
    checks(`${width}: floor removal preserves row heights`, noFloor.tables.every((t, i) => t.rowHeights.every((h, r) => Math.abs(h - baseline.tables[i].rowHeights[r]) < 1)));
    checks(`${width}: compact wrapper preserves row heights`, compact.tables.every((t, i) => t.rowHeights.every((h, r) => Math.abs(h - baseline.tables[i].rowHeights[r]) < 1)));
    checks(`${width}: long table remains scrollable`, compact.tables[1].maxScrollLeft > 0);
    checks(`${width}: width floor is active for one-column table`, baseline.tables[5].tableWidth > noFloor.tables[5].tableWidth + 30);
    for (const table of noFloor.tables) {
      const n = table.columnWidths.length;
      const natural = table.columnWidths.map((_, column) => Math.max(...table.cells.filter((cell, i) => i % n === column)
        .map(cell => cell.contentWidth + cell.paddingX + 1)));
      checks(`${width}/table-${table.index}: columns match widest inline content plus existing padding/border`,
        table.columnWidths.every((w, i) => Math.abs(w - natural[i]) < 1),
        {actual: table.columnWidths, natural});
    }
  }
  checks('no browser errors', report.consoleErrors.length === 0);
  report.summary = {passed: report.checks.filter(c => c.pass).length,
    failed: report.checks.filter(c => !c.pass).length,
    layouts: report.measurements.length, tableMeasurements: report.measurements.reduce((n, m) => n + m.tables.length, 0)};
  await fs.writeFile(path.join(out, 'measurements.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({summary: report.summary, failed: report.checks.filter(c => !c.pass), out}, null, 2));
  if (report.summary.failed) process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
