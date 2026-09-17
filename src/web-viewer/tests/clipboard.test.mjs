import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyClipboard, hasClipboardRead, readClipboard} from '../src/inbound/clipboard.js';

const item = (types, blob) => ({types, getType: async type => { if (!types.includes(type)) throw new Error('no ' + type); return blob; }});
const scope = (read, secure = true) => ({isSecureContext: secure, navigator: {clipboard: read && {read}}});
const denied = () => Object.assign(new Error('Read permission denied.'), {name: 'NotAllowedError'});

test('classifyClipboard: Chromium file-or-empty result has no types', () => {
  assert.deepEqual(classifyClipboard([]), {kind: 'no-types'});
  assert.deepEqual(classifyClipboard([item([])]), {kind: 'no-types'});
  assert.deepEqual(classifyClipboard(undefined), {kind: 'no-types'});
});

test('classifyClipboard: text and images never become a package', () => {
  assert.deepEqual(classifyClipboard([item(['text/plain'])]), {kind: 'text'});
  assert.deepEqual(classifyClipboard([item(['text/html', 'text/plain'])]), {kind: 'text'});
  assert.deepEqual(classifyClipboard([item(['text/uri-list'])]), {kind: 'text'});
  assert.deepEqual(classifyClipboard([item(['image/png'])]), {kind: 'other'});
  assert.deepEqual(classifyClipboard([item(['image/png']), item(['text/plain'])]), {kind: 'text'});
});

test('classifyClipboard: a non-text, non-image representation is a file candidate', () => {
  const zip = item(['text/plain', 'application/zip']);
  assert.deepEqual(classifyClipboard([item(['text/html']), zip]), {kind: 'file', type: 'application/zip', item: zip});
  const custom = item(['web application/x-mdpkg']);
  assert.deepEqual(classifyClipboard([custom]), {kind: 'file', type: 'web application/x-mdpkg', item: custom});
});

test('hasClipboardRead needs a secure context and a read function', () => {
  assert.equal(hasClipboardRead(scope(async () => [], false)), false);
  assert.equal(hasClipboardRead(scope(undefined)), false);
  assert.equal(hasClipboardRead({isSecureContext: true, navigator: {}}), false);
  assert.equal(hasClipboardRead({isSecureContext: true, navigator: {clipboard: {readText: async () => ''}}}), false);
  assert.equal(hasClipboardRead(scope(async () => [])), true);
});

test('readClipboard: unsupported without a secure context or read()', async () => {
  assert.deepEqual(await readClipboard(scope(async () => [], false)), {status: 'unsupported'});
  assert.deepEqual(await readClipboard(scope(undefined)), {status: 'unsupported'});
  assert.deepEqual(await readClipboard({isSecureContext: true}), {status: 'unsupported'});
});

test('readClipboard: NotAllowedError is denied, anything else failed, both keep the error', async () => {
  const refusal = denied();
  assert.deepEqual(await readClipboard(scope(async () => { throw refusal; })), {status: 'denied', error: refusal});
  const crash = new TypeError('boom');
  assert.deepEqual(await readClipboard(scope(async () => { throw crash; })), {status: 'failed', error: crash});
  assert.deepEqual(await readClipboard(scope(() => { throw crash; })), {status: 'failed', error: crash});
});

test('readClipboard: calls read() synchronously so the click activation still applies', async () => {
  let called = false;
  const pending = readClipboard(scope(() => { called = true; return Promise.resolve([]); }));
  assert.equal(called, true);
  assert.deepEqual(await pending, {status: 'ok', kind: 'no-types'});
});

test('readClipboard: reports what the clipboard holds', async () => {
  assert.deepEqual(await readClipboard(scope(async () => [item([])])), {status: 'ok', kind: 'no-types'});
  assert.deepEqual(await readClipboard(scope(async () => [item(['text/plain'])])), {status: 'ok', kind: 'text'});
  assert.deepEqual(await readClipboard(scope(async () => [item(['image/png'])])), {status: 'ok', kind: 'other'});
});

test('readClipboard: a file candidate resolves its blob, and a failing getType is failed', async () => {
  const blob = new Blob(['PK']);
  assert.deepEqual(await readClipboard(scope(async () => [item(['application/zip'], blob)])),
    {status: 'ok', kind: 'file', type: 'application/zip', blob});
  const broken = {types: ['application/octet-stream'], getType: async () => { throw new Error('gone'); }};
  const result = await readClipboard(scope(async () => [broken]));
  assert.equal(result.status, 'failed'); assert.equal(result.error.message, 'gone');
});
