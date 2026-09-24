import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFile(path.join(desktop, file), 'utf8');
const config = JSON.parse(await read('src-tauri/tauri.conf.json'));

test('W1 builds the viewer and serves its dist from the stable default origin', async () => {
  assert.equal(config.build.frontendDist, '../../web-viewer/dist');
  assert.match(config.build.beforeBuildCommand, /npm .*web-viewer run build/);
  assert.equal(config.app.windows[0].dragDropEnabled, false);
  assert.equal(Object.hasOwn(config.app.windows[0], 'useHttpsScheme'), false);
  assert.equal(Object.hasOwn(config.app.security, 'useHttpsScheme'), false);
  assert.match(config.app.security.csp, /blob:/);
});

test('W1 bundles a per-user NSIS shell with only core permissions', async () => {
  assert.equal(config.productName, 'Markdown Package Viewer');
  assert.equal(config.mainBinaryName, 'mdpkg-viewer');
  assert.equal(config.identifier, 'net.codeperf.mdpkg');
  assert.deepEqual(config.bundle.targets, ['nsis']);
  assert.equal(config.bundle.windows.nsis.installMode, 'currentUser');
  const capability = JSON.parse(await read('src-tauri/capabilities/default.json'));
  assert.deepEqual(capability.permissions, ['core:default']);
  const cargo = await read('src-tauri/Cargo.toml');
  const lib = await read('src-tauri/src/lib.rs');
  assert.doesNotMatch(cargo, /tauri-plugin-/);
  assert.doesNotMatch(lib, /\.plugin\(/);
  assert.doesNotMatch(lib, /\.invoke_handler\(/);
});
