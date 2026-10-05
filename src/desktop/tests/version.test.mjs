import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {main, readPropsVersion, syncVersion} from '../scripts/sync-version.mjs';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(desktop, 'scripts/sync-version.mjs');
const files = ['src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'];

// A copy of the coupled files laid out as in the repository, so the real ones are never
// rewritten by a test.
async function fixture(t, version) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mdpkg-desktop-version-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const copy = path.join(root, 'desktop');
  for (const file of files) await cp(path.join(desktop, file), path.join(copy, file));
  const props = await readFile(path.join(desktop, '../generator-cli/Mdpkg.Pack.props'), 'utf8');
  await cp(path.join(desktop, '../generator-cli/Mdpkg.Pack.props'), path.join(root, 'generator-cli/Mdpkg.Pack.props'));
  await writeFile(path.join(root, 'generator-cli/Mdpkg.Pack.props'),
    props.replace(/<Version>[^<]*<\/Version>/, `<Version>${version}</Version>`));
  return copy;
}

const readAll = dir => Promise.all(files.map(file => readFile(path.join(dir, file), 'utf8')));

function quiet(t) {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
}

test('the committed desktop files carry the props version', async () => {
  const {version, drift} = await syncVersion();
  assert.deepEqual(drift, []);
  const props = await readFile(path.join(desktop, '../generator-cli/Mdpkg.Pack.props'), 'utf8');
  assert.equal(version, readPropsVersion(props));
  const child = spawnSync(process.execPath, [script, '--check'], {encoding: 'utf8'});
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /matches Mdpkg\.Pack\.props/);
});

test('the check reports every drifted file, writes nothing and fails', async t => {
  quiet(t);
  const copy = await fixture(t, '1.2.3-preview.4');
  const before = await readAll(copy);
  const {drift} = await syncVersion({desktopDir: copy});
  assert.deepEqual(drift.map(entry => [entry.file, entry.to]), files.map(file => [file, '1.2.3-preview.4']));
  assert.equal(await main(['--check'], copy), 1);
  assert.deepEqual(await readAll(copy), before);
});

test('the sync rewrites only the app version, after which the check passes', async t => {
  quiet(t);
  const copy = await fixture(t, '2.0.0');
  const before = await readAll(copy);
  assert.equal(await main([], copy), 0);
  const after = await readAll(copy);
  const config = JSON.parse(after[0]);
  assert.equal(config.version, '2.0.0');
  assert.equal(config.bundle.windows.nsis.installMode, 'currentUser');
  assert.match(after[1], /^\[package\]\r?\nname = "mdpkg-viewer"\r?\nversion = "2\.0\.0"/m);
  assert.match(after[2], /name = "mdpkg-viewer"\r?\nversion = "2\.0\.0"/);
  // Exactly one line changes per file; dependency versions and line endings are untouched.
  for (const [index, file] of files.entries()) {
    const old = before[index].split('\n');
    const changed = after[index].split('\n').filter((line, n) => line !== old[n]);
    assert.equal(changed.length, 1, file);
    assert.equal(after[index].split('\r\n').length, before[index].split('\r\n').length, file);
  }
  assert.equal(await main(['--check'], copy), 0);
});

test('the build mode synchronizes, then fails once so the bundler never sees a stale version', async t => {
  quiet(t);
  const copy = await fixture(t, '1.0.1');
  assert.equal(await main(['--build'], copy), 1);
  assert.equal(JSON.parse((await readAll(copy))[0]).version, '1.0.1');
  assert.equal(await main(['--build'], copy), 0);
  assert.equal(await main(['--bogus'], copy), 2);
  assert.equal(await main(['--check', '--build'], copy), 2);
});

test('every Tauri build synchronizes the version before building the viewer', async () => {
  const config = JSON.parse(await readFile(path.join(desktop, 'src-tauri/tauri.conf.json'), 'utf8'));
  assert.match(config.build.beforeBuildCommand, /^node scripts\/sync-version\.mjs --build && npm /);
});

test('a version Tauri cannot accept is refused', () => {
  assert.throws(() => readPropsVersion('<Version>1.0.0.1</Version>'), /not a semantic version/);
  assert.throws(() => readPropsVersion('<Version>1.0.0</Version><Version>1.0.1</Version>'), /exactly one/);
  assert.equal(readPropsVersion('<Version> 1.0.0-rc.1 </Version>'), '1.0.0-rc.1');
});
