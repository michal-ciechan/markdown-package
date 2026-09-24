import assert from 'node:assert/strict';
import test from 'node:test';
import {detect, launchFiles, onOpenFile, readFile} from '../src/host/index.js';
import {normalizeSource} from '../src/inbound/source.js';

test('browser host has no launch files or open events', async () => {
  assert.equal(detect({}), 'browser');
  assert.equal(detect({__TAURI_INTERNALS__: {}}), 'tauri');
  assert.deepEqual(await launchFiles(), []);
  const stop = await onOpenFile(() => assert.fail('browser delivered a native file'));
  assert.equal(typeof stop, 'function');
  stop();
  await assert.rejects(readFile('C:\\example.mdpkg'), /unavailable in this browser/);
});

test('host source retains its path and name while giving receive a named Blob', async () => {
  const path = 'C:\\Documents\\guide.md';
  const source = normalizeSource({blob: new Blob(['# Guide']), sourceKind: 'host', path, name: 'guide.md'});
  assert.equal(source.path, path);
  assert.equal(source.sourceKind, 'host');
  assert.equal(source.name, 'guide.md');
  assert.equal(source.blob.name, 'guide.md');
  assert.equal(await source.blob.text(), '# Guide');
  assert.throws(() => normalizeSource({blob: new Blob(['x']), sourceKind: 'host', path}), /needs bytes/);
});

test('browser File input retains its existing source kind', () => {
  const file = new File(['PK'], 'guide.mdpkg');
  assert.deepEqual(normalizeSource(file), {blob: file, sourceKind: 'file'});
});
