// After installing the debug NSIS build:
// node tests/association-smoke.mjs C:/path/to/evidence-directory
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(desktop, '../web-viewer/package.json'));
const {chromium, expect} = require('@playwright/test');
const exe = path.join(process.env.LOCALAPPDATA, 'Markdown Package Viewer/mdpkg-viewer.exe');
const fixture = path.join(desktop, '../../docs/spec/review-fixtures/guide-snapshot.mdpkg');
const evidenceDir = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Pass an evidence directory');
const endpoint = 'http://127.0.0.1:9230';
const result = {exe, fixture};
let work, pid, browser;
const psPath = value => "'" + value.replaceAll("'", "''") + "'";
const powershell = command => execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {encoding: 'utf8'}).trim();

try {
  await mkdir(evidenceDir, {recursive: true});
  work = await mkdtemp(path.join(os.tmpdir(), 'mdpkg w2 association '));
  const profile = path.join(work, 'profile');
  const md = path.join(work, 'open with.md');
  await writeFile(md, '# Open with candidate\n');
  const association = powershell("(Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Classes\\.mdpkg').'(default)'");
  const candidate = powershell("(Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Classes\\.md\\OpenWithProgids').PSObject.Properties.Name -contains 'MdpkgViewer.md'");
  assert.equal(association, 'MdpkgPackage');
  assert.equal(candidate, 'True');
  result.registry = {association, openWithCandidate: candidate};

  // ShellExecute on the associated document is the double-click route.
  pid = Number(powershell(`$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9230'; ` +
    `$env:WEBVIEW2_USER_DATA_FOLDER=${psPath(profile)}; ` +
    `(Start-Process -FilePath ${psPath(fixture)} -PassThru -WindowStyle Hidden).Id`));
  assert.ok(Number.isInteger(pid) && pid > 0);
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(endpoint + '/json/version')).ok) break; } catch {}
    if (attempt === 59) throw new Error('Associated app did not start WebView2');
    await delay(500);
  }
  browser = await chromium.connectOverCDP(endpoint);
  const page = browser.contexts().flatMap(context => context.pages())
    .find(candidate => candidate.url().startsWith('http://tauri.localhost/'));
  assert.ok(page, 'associated app opened a viewer page');
  await expect(page.locator('.document-title')).toHaveText('guide.md', {timeout: 20000});
  result.doubleClick = {opened: true, pid};

  // The installed OpenWithProgids command targets this executable and quotes %1.
  const command = powershell("(Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Classes\\MdpkgViewer.md\\shell\\open\\command').'(default)'");
  assert.match(command, /"%1"/);
  const second = spawn(exe, [md], {cwd: work, stdio: 'ignore'});
  const [code] = await Promise.race([once(second, 'exit'), delay(15000).then(() => { second.kill(); throw new Error('Open-with launch did not exit'); })]);
  assert.equal(code, 0);
  await expect(page.locator('#reader article')).toContainText('Open with candidate', {timeout: 20000});
  result.openWith = {candidateCommand: command, opened: true};
} catch (error) {
  result.error = String(error?.stack ?? error);
  throw error;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (pid) { try { execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {stdio: 'ignore'}); } catch {} }
  await writeFile(path.join(evidenceDir, 'card-0072-associations.json'), JSON.stringify(result, null, 2));
  if (work) await rm(work, {recursive: true, force: true, maxRetries: 50, retryDelay: 100});
}
console.log(JSON.stringify(result));
