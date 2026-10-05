// Run after `cargo tauri build --debug`, in an unlocked interactive desktop
// (not a minimized RDP window): node tests/forward-focus-smoke.mjs <evidence-dir> [launches]
// No debugger is attached: CDP keeps the page awake and hides the stall where a
// forwarded file sat unopened until the user clicked the window.
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {once} from 'node:events';
import {copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = path.join(desktop, 'src-tauri/target/debug/mdpkg-viewer.exe');
const fixture = path.join(desktop, '../../docs/spec/review-fixtures/guide-snapshot.mdpkg');
if (!process.argv[2]) throw new Error('Pass an evidence directory');
const evidenceDir = path.resolve(process.argv[2]);
const launches = Number(process.argv[3] ?? 20);
const openWithin = 5000;

const win32 = String.raw`
param([string]$Op, [string]$A, [string]$B)
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool repaint);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, UIntPtr e);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  public static IntPtr AppWindow(int pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => { int p; GetWindowThreadProcessId(h, out p);
      if (p == pid && IsWindowVisible(h)) { found = h; return false; } return true; }, IntPtr.Zero);
    return found;
  }
  // Raise without injecting input: share the foreground thread's input state briefly.
  public static bool Raise(IntPtr h) {
    int pid; uint fg = GetWindowThreadProcessId(GetForegroundWindow(), out pid), me = GetCurrentThreadId();
    bool attached = fg != 0 && fg != me && AttachThreadInput(me, fg, true);
    BringWindowToTop(h); bool ok = SetForegroundWindow(h);
    if (attached) AttachThreadInput(me, fg, false);
    return ok;
  }
}
"@
switch ($Op) {
  'foreground' { $h = [W]::GetForegroundWindow(); $p = 0; [void][W]::GetWindowThreadProcessId($h, [ref]$p); @{hwnd = [long]$h; pid = $p} | ConvertTo-Json -Compress }
  'cover' { $app = [W]::AppWindow([int]$A); $cover = [W]::AppWindow([int]$B); $r = New-Object W+RECT; [void][W]::GetWindowRect($app, [ref]$r)
    [void][W]::MoveWindow($cover, $r.L - 20, $r.T - 20, $r.R - $r.L + 40, $r.B - $r.T + 40, $true)
    @{app = [long]$app; cover = [long]$cover; raised = [W]::Raise($cover)} | ConvertTo-Json -Compress }
  'raise' { @{raised = [W]::Raise([W]::AppWindow([int]$A))} | ConvertTo-Json -Compress }
  'click' { $r = New-Object W+RECT; [void][W]::GetWindowRect([W]::AppWindow([int]$A), [ref]$r)
    [void][W]::SetCursorPos([int](($r.L + $r.R) / 2), $r.T + 80); [W]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); [W]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero); '{}' }
}
`;

let work, first, cover;
const result = {exe, launches: [], startedAt: new Date().toISOString()};
const ps = (...args) => JSON.parse(execFileSync('powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(work, 'win32.ps1'), ...args.map(String)],
  {encoding: 'utf8'}).trim());

async function acks(log) {
  try { return (await readFile(log, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(line => line.split(' ').map(Number)); }
  catch { return []; }
}
async function waitForAck(log, id, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const hit = (await acks(log)).find(([, ackId]) => ackId === id);
    if (hit) return hit[0];
    await delay(100);
  }
}

try {
  await mkdir(evidenceDir, {recursive: true});
  work = await mkdtemp(path.join(os.tmpdir(), 'mdpkg forward '));
  await writeFile(path.join(work, 'win32.ps1'), win32);
  if (ps('foreground').hwnd === 0) {
    result.skipped = 'No foreground window: the desktop is locked, disconnected or shown in a minimized RDP client';
    throw Object.assign(new Error(result.skipped), {skip: true});
  }
  for (let i = 0; i <= launches; i++) await copyFile(fixture, path.join(work, `package ${i}.mdpkg`));
  const log = path.join(work, 'acks.log');
  const env = {...process.env, MDPKG_ACK_LOG: log, WEBVIEW2_USER_DATA_FOLDER: path.join(work, 'profile')};
  delete env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS;
  first = spawn(exe, [path.join(work, 'package 0.mdpkg')], {cwd: desktop, stdio: 'ignore', env});
  assert.ok(await waitForAck(log, 1, 40000), 'startup package was not opened');
  await delay(1500);
  cover = spawn('notepad.exe', [], {stdio: 'ignore'});
  await delay(1500);
  result.cover = ps('cover', first.pid, cover.pid);

  for (let i = 1; i <= launches; i++) {
    const relative = i % 2 === 0;
    const raised = ps('raise', cover.pid).raised;
    await delay(500);
    const before = ps('foreground');
    const started = Date.now();
    // This process does not own the foreground, so Windows refuses the
    // forwarded SetForegroundWindow: the case where tao injected an Alt press.
    const second = relative
      ? spawn(exe, [`package ${i}.mdpkg`], {cwd: work, stdio: 'ignore', env})
      : spawn(exe, [path.join(work, `package ${i}.mdpkg`)], {cwd: desktop, stdio: 'ignore', env});
    const [code] = await Promise.race([once(second, 'exit'),
      delay(15000).then(() => { second.kill(); throw new Error('Second launch did not exit'); })]);
    const acked = await waitForAck(log, i + 1, openWithin);
    const row = {launch: i, path: relative ? 'relative+cwd' : 'absolute', coverRaised: raised,
      coverForeground: before.pid === cover.pid, exit: code, appForeground: ps('foreground').pid === first.pid};
    if (acked) row.openedMs = acked - started;
    else {
      row.stalled = true;
      const clicked = Date.now();
      ps('click', first.pid);
      const late = await waitForAck(log, i + 1, 10000);
      row.afterClickMs = late ? late - clicked : null;
    }
    result.launches.push(row);
    console.log(JSON.stringify(row));
  }
  result.opened = result.launches.filter(row => !row.stalled).length;
  result.stalled = result.launches.length - result.opened;
  assert.ok(result.launches.every(row => row.exit === 0), 'a second launch did not exit 0');
  assert.ok(result.launches.some(row => row.coverForeground), 'the cover window never held the foreground');
  assert.equal(result.stalled, 0, `${result.stalled} forwarded launches did not open within ${openWithin} ms`);
  result.passed = true;
} catch (error) {
  result.error = error.message;
  if (!error.skip) process.exitCode = 1;
  else { process.exitCode = 2; console.error('SKIPPED:', error.message); }
  if (!error.skip) throw error;
} finally {
  cover?.kill();
  first?.kill();
  await delay(1000);
  await writeFile(path.join(evidenceDir, 'forward-focus-smoke.json'), JSON.stringify(result, null, 2));
  if (work) await rm(work, {recursive: true, force: true}).catch(() => {});
}
console.log(`forwarded ${result.launches.length}: opened ${result.opened ?? 0}, stalled ${result.stalled ?? 0}`);
