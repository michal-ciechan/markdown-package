// Follow-up: in WebKit with Playwright's clipboard-read grant, does execCommand('paste') fire a paste
// event carrying the OS-copied file, and does navigator.clipboard.read() resolve?
import {webkit} from 'file:///C:/src/markdown-package/src/web-viewer/node_modules/playwright/index.mjs';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
const fixture = 'C:/src/markdown-package/docs/spec/review-fixtures/original.mdpkg';
execFileSync('powershell', ['-NoProfile', '-Command', `Set-Clipboard -Path '${fixture}'`]);
const html = `<!doctype html><meta charset="utf-8"><button id="exec">exec</button><button id="read">read</button><script>
window.results = {};
document.addEventListener('paste', e => { window.results.paste = {types: [...e.clipboardData.types], files: [...e.clipboardData.files].map(f => ({name: f.name, size: f.size}))}; });
document.getElementById('exec').addEventListener('click', () => { window.results.exec = {supported: document.queryCommandSupported('paste'), returned: document.execCommand('paste')}; });
document.getElementById('read').addEventListener('click', async () => { window.results.read = 'pending';
  try { const items = await navigator.clipboard.read(); window.results.read = {ok: true, items: items.map(i => [...i.types])}; }
  catch (e) { window.results.read = {ok: false, name: e.name}; } });
</script>`;
const server = http.createServer((_, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html); }).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const url = `http://127.0.0.1:${server.address().port}/`;
for (const grant of [false, true]) {
  const browser = await webkit.launch({headless: false});
  const context = await browser.newContext();
  if (grant) await context.grantPermissions(['clipboard-read']);
  const page = await context.newPage(); await page.goto(url);
  await page.locator('#exec').click({noWaitAfter: true}); await page.waitForTimeout(700);
  const exec = await page.evaluate(() => window.results);
  await page.evaluate(() => { window.results = {}; });
  await page.locator('#read').click({noWaitAfter: true});
  try { await page.waitForFunction(() => window.results.read !== 'pending', null, {timeout: 5000}); } catch {}
  const read = await page.evaluate(() => window.results.read);
  console.log(JSON.stringify({engine: 'webkit', version: browser.version(), grant, afterExecClick: exec, read}));
  await browser.close();
}
server.close();
