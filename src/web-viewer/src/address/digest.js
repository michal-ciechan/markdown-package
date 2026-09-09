import {DIGEST, utf8} from '../format.js';

export function canonicalScope(source) {
  const lines = source.split('\n');
  while (lines.length && /^[ \t]*$/.test(lines[lines.length - 1])) lines.pop();
  return lines.length ? lines.join('\n') + '\n' : '';
}

export async function sha256(value) {
  if (!globalThis.crypto?.subtle) throw new Error('Addressing requires Web Crypto; serve the app over HTTPS or localhost');
  const bytes = typeof value === 'string' ? utf8.encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}

export const scopedDigest = (kind, source) => sha256(['mdpkg', DIGEST, kind, canonicalScope(source)].join('\0'));
