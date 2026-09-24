import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {readFile as readBytes} from '@tauri-apps/plugin-fs';

export const launchFiles = () => invoke('pending_launch_files');

export async function onOpenFile(callback, {pollMs = 1000} = {}) {
  let active = true, draining = false;
  const delivered = new Set();
  async function drain() {
    if (!active || draining) return;
    draining = true;
    try {
      for (const {id, path} of await launchFiles()) {
        if (!active) break;
        if (!delivered.has(id)) {
          await callback(path);
          delivered.add(id);
        }
        await invoke('ack_launch_file', {id});
        delivered.delete(id);
      }
    } finally { draining = false; }
  }
  const wake = () => { void drain().catch(error => console.error('Could not deliver queued launch:', error)); };
  const unlisten = await listen('host-open-file', wake);
  const timer = setInterval(wake, pollMs);
  wake();
  return () => { active = false; clearInterval(timer); unlisten(); };
}

export async function readFile(path) {
  return new Blob([await readBytes(path)], {type: 'application/octet-stream'});
}
