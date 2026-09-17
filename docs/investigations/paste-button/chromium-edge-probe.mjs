// Follow-up (Chromium): what does navigator.clipboard.read() return for an EMPTY clipboard,
// and what happens without Playwright's clipboard-read grant (prompt state) in headed and headless modes?
import {chromium} from 'file:///C:/src/markdown-package/src/web-viewer/node_modules/playwright/index.mjs';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
const ps = c => execFileSync('powershell', ['-NoProfile', '-Command', c], {stdio: 'pipe'});
const fixture = 'C:/src/markdown-package/docs/spec/review-fixtures/original.mdpkg';
const html = `<!doctype html><meta charset="utf-8"><button id="read">read</button><script>
window.results = {};
document.getElementById('read').addEventListener('click', async () => { window.results.read = 'pending';
  try { const items = await navigator.clipboard.read(); window.results.read = {ok: true, count: items.length, items: items.map(i => [...i.types])}; }
  catch (e) { window.results.read = {ok: false, name: e.name, message: e.message}; } });
</script>`;
const server = http.createServer((_, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html); }).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const out = [];
for (const [label, prepare] of [['empty', () => ps('Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::Clear()')], ['file', () => ps(`Set-Clipboard -Path '${fixture}'`)]]) {
  for (const headless of [false, true]) for (const grant of [true, false]) {
    prepare();
    const browser = await chromium.launch({headless});
    const context = await browser.newContext();
    if (grant) await context.grantPermissions(['clipboard-read']);
    const page = await context.newPage(); await page.goto(url);
    await page.locator('#read').click({noWaitAfter: true});
    try { await page.waitForFunction(() => window.results.read !== 'pending', null, {timeout: 5000}); } catch {}
    const read = await page.evaluate(() => window.results.read);
    out.push({clipboard: label, headless, grant, read}); console.error(JSON.stringify(out.at(-1)));
    await browser.close();
  }
}
server.close();
console.log(JSON.stringify(out, null, 2));
