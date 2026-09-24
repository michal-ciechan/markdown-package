// Keep Tauri imports out of the browser's eager graph.
export const detect = (scope = globalThis) =>
  scope.__TAURI_INTERNALS__ ? 'tauri' : 'browser';

const native = () => import('./tauri.js');

export async function launchFiles() {
  return detect() === 'tauri' ? (await native()).launchFiles() : [];
}

export async function onOpenFile(callback) {
  return detect() === 'tauri' ? (await native()).onOpenFile(callback) : () => {};
}

export async function readFile(path) {
  if (detect() !== 'tauri') throw new Error('Host file reading is unavailable in this browser.');
  return (await native()).readFile(path);
}
