import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {readFile as readBytes} from '@tauri-apps/plugin-fs';

export const launchFiles = () => invoke('take_launch_files');

export const onOpenFile = callback => listen('host-open-file', async () => {
  for (const path of await launchFiles()) callback(path);
});

export async function readFile(path) {
  return new Blob([await readBytes(path)], {type: 'application/octet-stream'});
}
