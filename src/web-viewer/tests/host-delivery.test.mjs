import assert from 'node:assert/strict';
import test from 'node:test';
import {onOpenFile} from '../src/host/tauri.js';

function transport() {
  let listener, nextId = 0;
  const pending = [];
  const faults = {drain: false, ack: false, listen: false};
  let ackAttempts = 0;
  globalThis.window = {
    __TAURI_INTERNALS__: {
      transformCallback(callback) { listener = callback; return 1; },
      async invoke(command, args) {
        if (command === 'plugin:event|listen') {
          if (faults.listen) { faults.listen = false; throw new Error('listener registration failed'); }
          return 1;
        }
        if (command === 'plugin:event|unlisten') return;
        if (command === 'take_launch_files') {
          const files = pending.splice(0).map(file => file.path);
          if (faults.drain) { faults.drain = false; throw new Error('lost drain response'); }
          return files;
        }
        if (command === 'pending_launch_files') {
          if (faults.drain) { faults.drain = false; throw new Error('failed drain'); }
          return pending.map(file => ({...file}));
        }
        if (command === 'ack_launch_file') {
          ackAttempts++;
          if (faults.ack) { faults.ack = false; throw new Error('failed acknowledgement'); }
          const index = pending.findIndex(file => file.id === args.id);
          if (index >= 0) pending.splice(index, 1);
          return index >= 0;
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    },
    __TAURI_EVENT_PLUGIN_INTERNALS__: {unregisterListener() {}},
  };
  return {
    pending, faults,
    enqueue(path, error = null) { pending.push({id: ++nextId, path, error}); },
    emit() { return listener?.({payload: null}); },
    get ackAttempts() { return ackAttempts; },
  };
}

async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('The launch did not reach the visible recipient');
}

test('enqueue survives a failed notification and reaches the recipient by reconciliation', async () => {
  const ipc = transport(), seen = [];
  const stop = await onOpenFile(path => { seen.push(path); }, {pollMs: 5});
  try {
    ipc.enqueue('C:\\docs\\notified.mdpkg'); // Rust's emit fails: no event is delivered.
    await until(() => seen.length === 1);
    assert.deepEqual(seen, ['C:\\docs\\notified.mdpkg']);
    await until(() => ipc.pending.length === 0);
  } finally { await stop(); delete globalThis.window; }
});

test('a failed drain response leaves the launch available to the recipient', async () => {
  const ipc = transport(), seen = [];
  const stop = await onOpenFile(path => { seen.push(path); }, {pollMs: 5});
  try {
    ipc.enqueue('C:\\docs\\drained.mdpkg');
    ipc.faults.drain = true;
    await Promise.resolve(ipc.emit()).catch(() => {});
    await until(() => seen.length === 1);
    assert.deepEqual(seen, ['C:\\docs\\drained.mdpkg']);
    await until(() => ipc.pending.length === 0);
  } finally { await stop(); delete globalThis.window; }
});

test('recipient failure is retried before the launch is acknowledged', async () => {
  const ipc = transport(), seen = [];
  let attempts = 0;
  const stop = await onOpenFile(path => {
    if (++attempts === 1) throw new Error('recipient unavailable');
    seen.push(path);
  }, {pollMs: 5});
  try {
    ipc.enqueue('C:\\docs\\recipient.mdpkg');
    await Promise.resolve(ipc.emit()).catch(() => {});
    await until(() => seen.length === 1);
    assert.equal(attempts, 2);
    await until(() => ipc.pending.length === 0);
  } finally { await stop(); delete globalThis.window; }
});

test('failed acknowledgement retries without reopening the visible document', async () => {
  const ipc = transport(), seen = [];
  const stop = await onOpenFile(path => { seen.push(path); }, {pollMs: 5});
  try {
    ipc.enqueue('C:\\docs\\ack.mdpkg');
    ipc.faults.ack = true;
    await Promise.resolve(ipc.emit()).catch(() => {});
    await until(() => ipc.ackAttempts >= 2 && ipc.pending.length === 0);
    assert.deepEqual(seen, ['C:\\docs\\ack.mdpkg']);
  } finally { await stop(); delete globalThis.window; }
});

test('a deferred recipient outcome retains the launch until a later event reoffers it', async () => {
  const ipc = transport(), seen = [];
  const stop = await onOpenFile(path => {
    seen.push(path);
    return seen.length === 1 ? 'deferred' : 'opened';
  }, {pollMs: 5});
  try {
    ipc.enqueue('C:\\docs\\cancelled.mdpkg');
    await until(() => seen.length === 1);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(ipc.pending.length, 1);
    assert.equal(ipc.ackAttempts, 0);
    assert.equal(seen.length, 1);
    await Promise.resolve(ipc.emit());
    await until(() => ipc.pending.length === 0);
    assert.deepEqual(seen, ['C:\\docs\\cancelled.mdpkg', 'C:\\docs\\cancelled.mdpkg']);
  } finally { await stop(); delete globalThis.window; }
});

test('a failed listener registration still polls and later installs the listener', async () => {
  const ipc = transport(), seen = [];
  ipc.faults.listen = true;
  const stop = await onOpenFile(path => { seen.push(path); return 'opened'; }, {pollMs: 5});
  try {
    ipc.enqueue('C:\\docs\\polled.mdpkg');
    await until(() => ipc.pending.length === 0);
    assert.deepEqual(seen, ['C:\\docs\\polled.mdpkg']);
    ipc.enqueue('C:\\docs\\listener.mdpkg');
    await until(() => ipc.emit() !== undefined);
    await until(() => ipc.pending.length === 0);
    assert.deepEqual(seen, ['C:\\docs\\polled.mdpkg', 'C:\\docs\\listener.mdpkg']);
  } finally { await stop(); delete globalThis.window; }
});

test('a file-scope rejection reaches the recipient and is acknowledged after display', async () => {
  const ipc = transport(), seen = [];
  const stop = await onOpenFile((path, error) => {
    seen.push({path, error});
    return 'rejected';
  }, {pollMs: 5});
  try {
    ipc.enqueue('C:\\docs\\denied.mdpkg', 'Could not grant file access');
    await until(() => ipc.pending.length === 0);
    assert.deepEqual(seen, [{path: 'C:\\docs\\denied.mdpkg', error: 'Could not grant file access'}]);
  } finally { await stop(); delete globalThis.window; }
});
