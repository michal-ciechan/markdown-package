// Probe: what do the paste event and navigator.clipboard.read() expose for an
// OS-copied file versus copied text, in each Playwright engine on Windows?
// Every step runs in a fresh page so a browser paste popup cannot block later steps.
import {chromium, firefox, webkit} from 'file:///C:/src/markdown-package/src/web-viewer/node_modules/playwright/index.mjs';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const fixture = path.resolve('C:/src/markdown-package/docs/spec/review-fixtures/original.mdpkg');
const size = fs.statSync(fixture).size;
const ps = command => execFileSync('powershell', ['-NoProfile', '-Command', command], {stdio: 'pipe'});
const clip = {
  file: () => ps(`Set-Clipboard -Path '${fixture}'`),
  text: () => ps(`Set-Clipboard -Value 'plain clipboard text'`),
};
const html = `<!doctype html><meta charset="utf-8"><title>probe</title>
<div id="focus" tabindex="0" style="height:200px;background:#eee">focus target</div>
<button id="read">read</button><button id="readText">readText</button><button id="exec">execCommand paste</button>
<script>
window.results = {};
document.addEventListener('paste', event => {
  const d = event.clipboardData;
  window.results.paste = {types: [...d.types], files: [...d.files].map(f => ({name: f.name, size: f.size, type: f.type})),
    items: [...d.items].map(i => ({kind: i.kind, type: i.type})), text: d.getData('text/plain').slice(0, 40)};
});
document.getElementById('read').addEventListener('click', async () => {
  window.results.read = 'pending';
  try { const items = await navigator.clipboard.read(); window.results.read = {ok: true, items: items.map(i => [...i.types])}; }
  catch (e) { window.results.read = {ok: false, name: e.name, message: e.message}; }
});
document.getElementById('readText').addEventListener('click', async () => {
  window.results.readText = 'pending';
  try { const t = await navigator.clipboard.readText(); window.results.readText = {ok: true, text: t.slice(0, 40)}; }
  catch (e) { window.results.readText = {ok: false, name: e.name, message: e.message}; }
});
document.getElementById('exec').addEventListener('click', () => {
  window.results.exec = {supported: document.queryCommandSupported('paste'), returned: document.execCommand('paste')};
});
</script>`;
const server = http.createServer((_, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html); }).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const report = {fixture, size, platform: process.platform, node: process.version, results: {}};
const step = async (label, fn) => { try { return await fn(); } catch (e) { return {stepError: label + ': ' + e.message.split('\n')[0]}; } };
for (const [name, engine] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  console.error('--- ' + name);
  const browser = await engine.launch({headless: false});
  const out = {version: browser.version(), permissions: 'not requested', runs: {}};
  const context = await browser.newContext();
  if (name === 'chromium') { await context.grantPermissions(['clipboard-read', 'clipboard-write']); out.permissions = 'granted clipboard-read, clipboard-write'; }
  else out.permissions = await step('grant', async () => { await context.grantPermissions(['clipboard-read']); return 'granted clipboard-read'; });
  const fresh = async () => { const page = await context.newPage(); await page.goto(url); return page; };
  {
    const page = await fresh();
    out.secureContext = await page.evaluate(() => window.isSecureContext);
    out.api = await page.evaluate(() => ({clipboard: typeof navigator.clipboard, read: typeof navigator.clipboard?.read, readText: typeof navigator.clipboard?.readText, ClipboardItem: typeof ClipboardItem}));
    await page.close();
  }
  for (const kind of ['file', 'text']) {
    clip[kind]();
    const run = {};
    run.pasteEvent = await step('paste', async () => {
      const page = await fresh();
      await page.locator('#focus').click({timeout: 5000});
      await page.keyboard.press('Control+V');
      await page.waitForTimeout(700);
      const result = await page.evaluate(() => window.results.paste ?? 'no paste event fired');
      await page.close(); return result;
    });
    for (const [key, id] of [['clipboardRead', 'read'], ['clipboardReadText', 'readText'], ['execCommand', 'exec']]) {
      run[key] = await step(id, async () => {
        const page = await fresh();
        await page.locator('#' + id).click({timeout: 5000, noWaitAfter: true});
        try { await page.waitForFunction(k => window.results[k] !== undefined && window.results[k] !== 'pending', id, {timeout: 5000}); } catch {}
        const result = await page.evaluate(k => window.results[k] ?? 'click did not run handler', id);
        await page.close(); return result;
      });
    }
    out.runs[kind] = run;
    console.error(JSON.stringify({kind, ...run}));
  }
  // Can a Playwright test stub the async clipboard, and remove it, in this engine?
  out.stubs = await step('stubs', async () => {
    const page = await fresh();
    const result = await page.evaluate(async () => {
      const result = {};
      try { Clipboard.prototype.read = async () => [new ClipboardItem({'text/plain': new Blob(['stubbed'], {type: 'text/plain'})})];
        const items = await navigator.clipboard.read(); result.stubRead = [...items[0].types]; }
      catch (e) { result.stubRead = e.name + ': ' + e.message; }
      try { Clipboard.prototype.read = () => Promise.reject(new DOMException('Read permission denied.', 'NotAllowedError'));
        await navigator.clipboard.read(); result.stubDenied = 'resolved?!'; } catch (e) { result.stubDenied = e.name; }
      try { Object.defineProperty(Navigator.prototype, 'clipboard', {get: () => undefined, configurable: true});
        result.removed = typeof navigator.clipboard; } catch (e) { result.removed = e.name + ': ' + e.message; }
      return result;
    });
    await page.close(); return result;
  });
  console.error(JSON.stringify({stubs: out.stubs}));
  report.results[name] = out;
  await browser.close();
}
server.close();
console.log(JSON.stringify(report, null, 2));
