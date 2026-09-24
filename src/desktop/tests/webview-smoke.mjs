// Run after `cargo tauri build --debug` with a packaged example and evidence dir:
// node tests/webview-smoke.mjs C:/path/to/guide.mdpkg C:/path/to/evidence
// This drives the actual WebView2 through its local CDP endpoint, then closes
// and relaunches the Tauri process to check IndexedDB reattachment.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(desktop, '../web-viewer/package.json'));
const {chromium, expect} = require('@playwright/test');
const packagePath = path.resolve(process.argv[2] ?? '');
const evidenceDir = path.resolve(process.argv[3] ?? '');
if (!process.argv[2] || !process.argv[3]) throw new Error('Pass package path and evidence directory');
const exe = path.join(desktop, 'src-tauri/target/debug/mdpkg-viewer.exe');
const endpoint = 'http://127.0.0.1:9228';
const result = {exe, packagePath, route: null, first: null, reopened: null};
let child, browser;
let profileDir;

async function launch() {
  child = spawn(exe, [], {cwd: desktop, stdio: 'ignore', env: {
    ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9228',
    WEBVIEW2_USER_DATA_FOLDER: profileDir,
  }});
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`Tauri exited early: ${child.exitCode}`);
    try {
      const response = await fetch(endpoint + '/json/version');
      if (response.ok) break;
    } catch {}
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
  throw new Error('Viewer page did not load in WebView2');
}

async function stop() {
  if (browser) { await browser.close().catch(() => {}); browser = undefined; }
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await Promise.race([exited, delay(5000).then(() => { throw new Error('Tauri did not exit'); })]);
  }
  child = undefined;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await fetch(endpoint + '/json/version'); }
    catch { return; }
    if (attempt === 59) throw new Error('WebView2 CDP endpoint did not stop');
    await delay(100);
  }
}

async function openStandard(page) {
  // CDP cannot hand a file to WebView2's showOpenFilePicker dialog. The
  // viewer's existing input route still exercises the real embedded page.
  await page.locator('#package-file').setInputFiles(packagePath);
}

try {
  await mkdir(evidenceDir, {recursive: true});
  profileDir = await mkdtemp(path.join(os.tmpdir(), 'mdpkg-w1-smoke-'));
  let page = await launch();
  result.first = await page.evaluate(() => ({
    title: document.title, origin: location.origin, secure: isSecureContext,
    picker: typeof showOpenFilePicker, indexedDB: typeof indexedDB,
  }));
  assert.equal(result.first.origin, 'http://tauri.localhost');
  assert.equal(result.first.secure, true);
  assert.equal(result.first.picker, 'function');
  assert.equal(result.first.indexedDB, 'object');
  assert.equal(await page.locator('#enhanced-open').isVisible(), true);
  await openStandard(page);
  result.route = 'input[type=file]';
  await expect(page.locator('.document-title')).toHaveText('guide.md', {timeout: 15000});
  await page.getByRole('button', {name: 'Review selected section', exact: true}).click();
  await page.getByLabel('Your name').fill('W1 Smoke');
  await page.getByLabel('Feedback', {exact: true}).fill('W1 restart draft');
  await expect(page.locator('.local-save-status')).toHaveText('Saved in this browser', {timeout: 20000});
  await page.screenshot({path: path.join(evidenceDir, 'card-0071-open.png')});
  await stop();

  page = await launch();
  result.reopened = {origin: await page.evaluate(() => location.origin)};
  await expect(page.locator('.recent-list'))
    .toContainText(path.basename(packagePath), {timeout: 15000});
  if (!(await page.getByLabel('Feedback', {exact: true}).isVisible())) {
    await page.locator('#package-file').setInputFiles(packagePath);
  }
  await expect(page.locator('.document-title')).toHaveText('guide.md', {timeout: 15000});
  await expect(page.getByLabel('Feedback', {exact: true})).toHaveValue('W1 restart draft', {timeout: 15000});
  await page.screenshot({path: path.join(evidenceDir, 'card-0071-reopened.png')});
  result.reopened = {origin: result.reopened.origin, recent: true, draft: true};
} catch (error) {
  result.error = String(error?.stack ?? error);
  throw error;
} finally {
  await stop();
  await writeFile(path.join(evidenceDir, 'card-0071-native-smoke.json'), JSON.stringify(result, null, 2));
  if (profileDir) await rm(profileDir, {recursive: true, force: true, maxRetries: 50, retryDelay: 100});
}
console.log(JSON.stringify(result));
