// Best-effort clipboard inspection behind the Paste package button (CARD-0057).
// A button cannot raise a paste event, and no measured engine hands an OS-copied
// file to navigator.clipboard.read() (Chromium resolves one item with no types,
// Firefox blocks on its paste prompt, WebKit rejects NotAllowedError). The button
// therefore classifies what read() returns and otherwise points at Ctrl+V / Cmd+V,
// which reaches the document paste listener in main.js. Nothing here loads text.
export const hasClipboardRead = (scope = globalThis) =>
  Boolean(scope.isSecureContext) && typeof scope.navigator?.clipboard?.read === 'function';

const textual = type => type.startsWith('text/');
const image = type => type.startsWith('image/');

// Pure. Maps ClipboardItem-shaped values ({types, getType}) to what the button can do:
// 'no-types' (Chromium for an OS file or an empty clipboard), 'file' (a non-text,
// non-image representation worth handing to openPackage), 'text', or 'other' (images).
export function classifyClipboard(items) {
  const entries = [...items ?? []].flatMap(item => [...item?.types ?? []].map(type => ({item, type: String(type)})));
  if (!entries.length) return {kind: 'no-types'};
  const file = entries.find(({type}) => !textual(type) && !image(type));
  if (file) return {kind: 'file', type: file.type, item: file.item};
  return {kind: entries.some(({type}) => textual(type)) ? 'text' : 'other'};
}

// Resolves to {status: 'unsupported'} | {status: 'denied' | 'failed', error} |
// {status: 'ok', kind, blob?}. Like choosePackage, the native call precedes any
// await because read() needs the click's transient activation.
export async function readClipboard(scope = globalThis) {
  if (!hasClipboardRead(scope)) return {status: 'unsupported'};
  let items;
  try { items = await scope.navigator.clipboard.read(); }
  catch (error) { return {status: error?.name === 'NotAllowedError' ? 'denied' : 'failed', error}; }
  const classified = classifyClipboard(items);
  if (classified.kind !== 'file') return {status: 'ok', kind: classified.kind};
  try { return {status: 'ok', kind: 'file', type: classified.type, blob: await classified.item.getType(classified.type)}; }
  catch (error) { return {status: 'failed', error}; }
}
