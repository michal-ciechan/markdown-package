// Run after `cargo tauri build --debug` to exercise the real WebView2 window:
// node tests/os-entry-smoke.mjs C:/path/to/evidence-directory
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {copyFile, mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(desktop, '../web-viewer/package.json'));
const {chromium, expect} = require('@playwright/test');
const exe = path.join(desktop, 'src-tauri/target/debug/mdpkg-viewer.exe');
const fixture = path.join(desktop, '../../docs/spec/review-fixtures/guide-snapshot.mdpkg');
const evidenceDir = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Pass an evidence directory');
const endpoint = 'http://127.0.0.1:9229';
const result = {exe, entryPoints: {}};
let work, first, browser, page;

async function waitForPage() {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (first.exitCode !== null) throw new Error(`Tauri exited early: ${first.exitCode}`);
    try { if ((await fetch(endpoint + '/json/version')).ok) break; } catch {}
    if (attempt === 59) throw new Error('WebView2 CDP endpoint did not start');
    await delay(500);
  }
  browser = await chromium.connectOverCDP(endpoint);
  for (let attempt = 0; attempt < 60; attempt++) {
    const page = browser.contexts().flatMap(context => context.pages())
      .find(candidate => candidate.url().startsWith('http://tauri.localhost/'));
    if (page) { await page.waitForLoadState('domcontentloaded'); return page; }
    await delay(500);
  }
  throw new Error('Viewer page did not load');
}

async function deliverHtml5File(page, type, name, bytes) {
  await page.evaluate(({type, name, bytes}) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], name));
    const event = type === 'drop'
      ? new DragEvent('drop', {dataTransfer: transfer, bubbles: true, cancelable: true})
      : new ClipboardEvent('paste', {clipboardData: transfer, bubbles: true, cancelable: true});
    document.dispatchEvent(event);
  }, {type, name, bytes: [...bytes]});
}

try {
  await mkdir(evidenceDir, {recursive: true});
  work = await mkdtemp(path.join(os.tmpdir(), 'mdpkg w2 '));
  const launchPath = path.join(work, 'launch package.mdpkg');
  const loosePath = path.join(work, 'forwarded.md');
  await copyFile(fixture, launchPath);
  await writeFile(loosePath, '# Forwarded through the single instance\n');
  first = spawn(exe, [launchPath], {cwd: desktop, stdio: 'ignore', env: {
    ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9229',
    WEBVIEW2_USER_DATA_FOLDER: path.join(work, 'profile'),
  }});
  page = await waitForPage();
  await expect(page.locator('#reader article')).not.toBeEmpty({timeout: 20000});
  result.entryPoints.argv = {opened: true, document: await page.locator('.document-title').textContent()};

  const second = spawn(exe, ['forwarded.md'], {cwd: work, stdio: 'ignore'});
  const [code] = await Promise.race([once(second, 'exit'), delay(15000).then(() => { second.kill(); throw new Error('Second launch did not exit'); })]);
  assert.equal(code, 0);
  await expect(page.locator('#reader article')).toContainText('Forwarded through the single instance', {timeout: 20000});
  const windows = browser.contexts().flatMap(context => context.pages())
    .filter(candidate => candidate.url().startsWith('http://tauri.localhost/')).length;
  assert.equal(windows, 1);
  result.entryPoints.secondLaunch = {forwarded: true, windows};

  await deliverHtml5File(page, 'drop', 'dropped.md', Buffer.from('# Dropped through WebView2\n'));
  await expect(page.locator('#reader article')).toContainText('Dropped through WebView2', {timeout: 20000});
  result.entryPoints.drop = {opened: true};

  await deliverHtml5File(page, 'paste', 'pasted.md', Buffer.from('# Pasted through WebView2\n'));
  await expect(page.locator('#reader article')).toContainText('Pasted through WebView2', {timeout: 20000});
  result.entryPoints.pasteEvent = {opened: true};
  await page.locator('#paste-package').click();
  result.entryPoints.pasteButton = {status: await page.locator('#activity').textContent()};
  await page.screenshot({path: path.join(evidenceDir, 'card-0072-webview.png')});
} catch (error) {
  if (page) result.activity = await page.locator('#activity').textContent().catch(() => undefined);
  result.error = String(error?.stack ?? error);
  throw error;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (first && first.exitCode === null) {
    const exited = once(first, 'exit');
    first.kill();
    await Promise.race([exited, delay(5000)]);
  }
  await writeFile(path.join(evidenceDir, 'card-0072-os-entry.json'), JSON.stringify(result, null, 2));
  if (work) await rm(work, {recursive: true, force: true, maxRetries: 50, retryDelay: 100});
}
console.log(JSON.stringify(result));
