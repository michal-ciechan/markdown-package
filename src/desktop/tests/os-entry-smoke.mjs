// Run after `cargo tauri build --debug` to exercise the real WebView2 window:
// node tests/os-entry-smoke.mjs C:/path/to/evidence-directory
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
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
let work, first, browser, page, clipboardBackup;

function clipboard(command) {
  return execFileSync('powershell.exe', ['-NoProfile', '-STA', '-Command',
    `Add-Type -AssemblyName System.Windows.Forms; ${command}`], {encoding: 'utf8'}).trim();
}
const psPath = value => "'" + value.replaceAll("'", "''") + "'";

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
  await page.context().grantPermissions(['clipboard-read']);
  await page.locator('#paste-package').click();
  await expect(page.locator('#activity')).toContainText(/clipboard|Pasting from a button|Could not read/i, {timeout: 10000});
  result.entryPoints.pasteButton = {status: await page.locator('#activity').textContent()};

  if (clipboard('[Windows.Forms.Clipboard]::ContainsText()') === 'True') {
    clipboardBackup = path.join(work, 'prior-clipboard.txt');
    const encoded = clipboard('[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([Windows.Forms.Clipboard]::GetText()))');
    await writeFile(clipboardBackup, Buffer.from(encoded, 'base64'));
  }
  clipboard(`$files = [Collections.Specialized.StringCollection]::new(); $null = $files.Add(${psPath(launchPath)}); [Windows.Forms.Clipboard]::SetFileDropList($files)`);
  await page.evaluate(() => document.addEventListener('paste', event => {
    window.__osPaste = {types: [...event.clipboardData.types], files: [...event.clipboardData.files].map(file => file.name)};
  }, {capture: true, once: true}));
  await page.locator('body').click();
  await page.keyboard.press('Control+V');
  await page.waitForFunction(() => window.__osPaste, undefined, {timeout: 5000});
  result.entryPoints.copiedFilePaste = await page.evaluate(() => window.__osPaste);
  assert.deepEqual(result.entryPoints.copiedFilePaste.files, ['launch package.mdpkg']);
  await expect(page.locator('.document-title')).toHaveText('guide.md', {timeout: 20000});

  // Force a real failed save so receive() must ask before replacing this draft.
  // The shell has no dialog plugin yet; WebView2's native confirm is expected.
  await page.evaluate(() => { IDBObjectStore.prototype.put = () => { throw new Error('W2 smoke: save blocked'); }; });
  await page.getByRole('button', {name: 'Review selected section', exact: true}).click();
  await page.getByLabel('Your name').fill('W2 Smoke');
  await page.getByLabel('Feedback', {exact: true}).fill('Keep this unsaved draft');
  await expect(page.locator('.local-save-status')).toContainText('Could not save', {timeout: 10000});
  const dialogSeen = new Promise(resolve => page.once('dialog', async dialog => {
    const detail = {type: dialog.type(), message: dialog.message()};
    await dialog.dismiss();
    resolve(detail);
  }));
  const third = spawn(exe, ['forwarded.md'], {cwd: work, stdio: 'ignore'});
  const [thirdCode] = await Promise.race([once(third, 'exit'), delay(15000).then(() => { third.kill(); throw new Error('Confirm launch did not exit'); })]);
  assert.equal(thirdCode, 0);
  result.entryPoints.unsavedConfirm = await Promise.race([dialogSeen, delay(10000).then(() => { throw new Error('Unsaved-work confirm was not shown'); })]);
  assert.equal(result.entryPoints.unsavedConfirm.type, 'confirm');
  await expect(page.locator('.document-title')).toHaveText('guide.md');
  await expect(page.getByLabel('Feedback', {exact: true})).toHaveValue('Keep this unsaved draft');
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
  try {
    if (clipboardBackup) clipboard(`[Windows.Forms.Clipboard]::SetText([IO.File]::ReadAllText(${psPath(clipboardBackup)}))`);
  } finally {
    if (work) await rm(work, {recursive: true, force: true, maxRetries: 50, retryDelay: 100});
  }
}
console.log(JSON.stringify(result));
