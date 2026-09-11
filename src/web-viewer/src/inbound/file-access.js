export const hasFilePicker = (scope = globalThis) => scope.isSecureContext && typeof scope.showOpenFilePicker === 'function';
export async function choosePackage(scope = globalThis) {
  // Invoke the native picker before awaiting anything: this call needs activation.
  const [handle] = await scope.showOpenFilePicker({multiple: false});
  return {blob: await handle.getFile(), handle, sourceKind: 'picker'};
}
export async function permission(handle) {
  if (handle?.kind !== 'file' || typeof handle.queryPermission !== 'function' || typeof handle.getFile !== 'function') return 'unavailable';
  try { return await handle.queryPermission({mode: 'read'}); } catch { return 'unavailable'; }
}
export async function allow(handle) {
  // The caller has already loaded the handle; never read IndexedDB before this.
  if (typeof handle?.requestPermission !== 'function') return 'unavailable';
  try { return await handle.requestPermission({mode: 'read'}); } catch { return 'denied'; }
}
export async function fromHandle(handle) { return {blob: await handle.getFile(), handle, sourceKind: 'remembered'}; }
