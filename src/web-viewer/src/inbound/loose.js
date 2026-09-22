// A loose Markdown file is not a degraded package: it is the same class of
// artifact `mdpkg pack` emits without history. Wrap its bytes into an in-memory
// conforming snapshot so the one inbound boundary (open.js) opens it unchanged.
// Identity is a caller-supplied parameter, never derived here: the native shell
// has an absolute path and the browser has only a file name.
import {ANCHOR, DIGEST, MANIFEST, utf8, decode, canonicalJson} from '../format.js';
import {writePackage} from '../container/writer.js';
import {snapshotIdentity} from '../container/snapshot.js';
import {sha256} from '../address/digest.js';

// The container reader caps one entry at 64 MiB. Refuse the same size up front,
// before decoding, normalizing and deflating the whole file.
export const MAX_LOOSE_BYTES = 64 * 1024 * 1024;

const NAMESPACE_PREFIX = 'mdpkg-loose-namespace-v1';

// UUIDv8 over a fixed prefix, a NUL and the caller's identity string. Stable
// across reopening and across edits to the file, which browser resume and the
// native watcher's identity gate both require; content-derived is not.
export async function looseNamespace(identity) {
  if (typeof identity !== 'string' || !identity) throw new Error('A loose document requires an identity');
  const digits = (await sha256(NAMESPACE_PREFIX + '\0' + identity)).slice(0, 32).split('');
  digits[12] = '8';                                      // version 8: custom
  digits[16] = '89ab'[parseInt(digits[16], 16) & 3];     // RFC 4122 variant
  const value = digits.join('');
  return [value.slice(0, 8), value.slice(8, 12), value.slice(12, 16), value.slice(16, 20), value.slice(20, 32)].join('-');
}

// Returns package bytes. `identity` is required; `name` becomes the single
// document's package path and the opened package's displayed name.
export async function synthesizeLoose(bytes, name, {identity} = {}) {
  if (!(bytes instanceof Uint8Array)) throw new Error('A loose document must be supplied as bytes');
  if (bytes.length > MAX_LOOSE_BYTES) throw new Error('This file is too large to open as a loose document');
  const namespace = await looseNamespace(identity);
  let text;
  try { text = decode(bytes); }
  catch { throw new Error('This file is not UTF-8 text, so it cannot be opened as a loose document'); }
  // snapshotIdentity rejects any CR and the digest profile is source-LF, so
  // normalizing is mandatory. A leading BOM is stripped: CommonMark reads
  // U+FEFF as text, so keeping it would silently demote the first heading to a
  // paragraph and leave the file with no sections at all.
  const source = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const document = utf8.encode(source);
  const path = name || 'document.md';
  const manifest = {mdpkg: 'markdown-package/1', namespace, current: {kind: 'snapshot', id: ''},
    addressing: {anchor: ANCHOR, digest: DIGEST, coverage: 'complete', overrides: null},
    history: {mode: 'none'}};
  manifest.current.id = await snapshotIdentity(manifest, [path], async () => document);
  const manifestText = '{"mdpkg":"markdown-package/1",' +
    canonicalJson(Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'mdpkg'))).slice(1);
  return writePackage([{name: MANIFEST, bytes: utf8.encode(manifestText), stored: true}, {name: path, bytes: document}]);
}
