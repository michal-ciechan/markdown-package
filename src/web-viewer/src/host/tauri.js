import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {readFile as readBytes} from '@tauri-apps/plugin-fs';

export const launchFiles = () => invoke('pending_launch_files');

export async function onOpenFile(callback, {pollMs = 1000} = {}) {
  let active = true, draining = false, unlisten, installing;
  const delivered = new Set(), deferred = new Set();
  async function drain() {
    if (!active || draining) return;
    draining = true;
    try {
      const pending = await launchFiles();
      const ids = new Set(pending.map(file => file.id));
      for (const id of deferred) if (!ids.has(id)) deferred.delete(id);
      for (const {id, path, error} of pending) {
        if (!active) break;
        if (deferred.has(id)) continue;
        if (!delivered.has(id)) {
          const outcome = await callback(path, error);
          if (outcome === 'deferred') { deferred.add(id); continue; }
          if (outcome === 'superseded') continue;
          if (outcome !== undefined && outcome !== 'opened' && outcome !== 'rejected')
            throw new Error(`Unexpected launch outcome: ${outcome}`);
          delivered.add(id);
        }
        await invoke('ack_launch_file', {id});
        delivered.delete(id);
      }
    } finally { draining = false; }
  }
  function installListener() {
    if (!active || unlisten || installing) return;
    installing = listen('host-open-file', () => { deferred.clear(); wake(); })
      .then(stop => { if (active) unlisten = stop; else stop(); })
      .catch(error => console.error('Could not listen for launch events:', error))
      .finally(() => { installing = undefined; });
  }
  const wake = () => {
    installListener();
    void drain().catch(error => console.error('Could not deliver queued launch:', error));
  };
  const timer = setInterval(wake, pollMs);
  wake();
  return () => { active = false; clearInterval(timer); unlisten?.(); };
}

export async function readFile(path) {
  return new Blob([await readBytes(path)], {type: 'application/octet-stream'});
}
