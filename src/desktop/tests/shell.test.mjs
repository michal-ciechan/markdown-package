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
  assert.equal(Object.hasOwn(config.app, 'useHttpsScheme'), false);
  assert.equal(Object.hasOwn(config.app.windows[0], 'useHttpsScheme'), false);
  assert.equal(Object.hasOwn(config.app.security, 'useHttpsScheme'), false);
  assert.match(config.app.security.csp, /blob:/);
  const props = await read('../generator-cli/Mdpkg.Pack.props');
  assert.equal(config.version, props.match(/<Version>([^<]+)<\/Version>/)?.[1]);
});

test('W2 bundles per-user associations with file-scoped read permission', async () => {
  assert.equal(config.productName, 'Markdown Package Viewer');
  assert.equal(config.mainBinaryName, 'mdpkg-viewer');
  assert.equal(config.identifier, 'net.codeperf.mdpkg');
  assert.deepEqual(config.bundle.targets, ['nsis']);
  assert.equal(config.bundle.windows.nsis.installMode, 'currentUser');
  assert.equal(config.bundle.windows.nsis.installerHooks, 'installer-hooks.nsh');
  assert.deepEqual(config.bundle.fileAssociations.map(a => a.ext), [['mdpkg']]);
  const capability = JSON.parse(await read('src-tauri/capabilities/default.json'));
  assert.deepEqual(capability.permissions, ['core:default', 'fs:allow-read-file']);
  const cargo = await read('src-tauri/Cargo.toml');
  const lib = await read('src-tauri/src/lib.rs');
  assert.match(cargo, /tauri-plugin-fs/);
  assert.match(cargo, /tauri-plugin-single-instance/);
  assert.match(lib, /fs_scope\(\)\.allow_file/);
  assert.match(lib, /pending_launch_files/);
  assert.match(lib, /ack_launch_file/);
  assert.doesNotMatch(lib, /take_launch_files/);
  assert.doesNotMatch(cargo, /tauri-plugin-dialog/);
  assert.doesNotMatch(lib, /tauri_plugin_dialog/);
});
