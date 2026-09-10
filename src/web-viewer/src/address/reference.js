import {ANCHOR, DIGEST, DIFF, UUID, HASH, OID, canonicalJson, parseCanonicalJson, utf8, hasOwn} from '../format.js';
import {validatePath, isReserved} from '../container/conformance.js';

export function validateLocator(locator, kind) {
  if (!Array.isArray(locator) || locator.length !== 3 ||
      !['document', 'preamble', 'section'].includes(locator[0]) || typeof locator[1] !== 'string' ||
      !Array.isArray(locator[2])) throw new Error('Invalid locator');
  validatePath(locator[1]);
  if (isReserved(locator[1])) throw new Error('Locator points into a reserved region');
  if (kind && (locator[0] === 'document') !== (kind === 'document')) throw new Error('Reference and locator kinds disagree');
  if ((locator[0] === 'section') !== (locator[2].length > 0) || locator[2].length > 6) throw new Error('Invalid heading trail');
  for (const item of locator[2]) {
    if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string' ||
        !item[0] || item[0].includes('\r') || !Number.isSafeInteger(item[1]) || item[1] < 0) {
      throw new Error('Invalid heading occurrence');
    }
  }
  return locator;
}

export function encodeLocator(locator) {
  const bytes = utf8.encode(canonicalJson(locator));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeLocator(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new Error('Invalid base64url locator');
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const locator = parseCanonicalJson(Uint8Array.from(binary, char => char.charCodeAt(0)));
  if (encodeLocator(locator) !== value) throw new Error('Noncanonical base64url locator');
  return locator;
}

export function parseReference(value) {
  if (typeof value !== 'string' || value.length > 128 * 1024 || /[\s\u0000-\u001f\u007f]/.test(value) ||
      /%(?![a-fA-F0-9]{2})/.test(value)) throw new Error('Malformed reference');
  // Parse the literal path, rather than letting URL erase dot segments, tabs,
  // credentials or other syntax before validation.
  const match = /^mdpkg:\/\/([^/?#]+)\/v2\/(document|section|commit|diff|hunk)\/([^/?#]+)(?:\?([^#]+))?$/.exec(value);
  if (!match || !UUID.test(match[1])) throw new Error('Invalid namespace, version or reference kind');
  const [, namespace, kind, id, query = ''] = match;
  const params = Object.create(null);
  for (const [key, val] of new URLSearchParams(query)) {
    if (hasOwn(params, key)) throw new Error('Duplicate reference parameter: ' + key);
    params[key] = val;
  }
  const current = kind === 'document' || kind === 'section';
  const allowed = current ? ['anchor', 'profile', 'expect', 'loc', 'at'] : kind === 'commit' ? [] :
    ['document', 'profile', ...(kind === 'hunk' ? ['patch', 'ordinal'] : [])];
  for (const key of Object.keys(params)) if (!allowed.includes(key)) throw new Error('Unknown reference parameter: ' + key);
  if (current) {
    if (!HASH.test(id) || (hasOwn(params, 'expect') && !HASH.test(params.expect))) throw new Error('Invalid root or expected digest');
    if (params.anchor !== ANCHOR || params.profile !== DIGEST) throw new Error('Unsupported anchor or source digest profile');
    if (params.at !== undefined && !OID.test(params.at)) throw new Error('Invalid snapshot ID');
    const locator = validateLocator(decodeLocator(params.loc ?? ''), kind);
    return {namespace, kind, root: id, locator, ...params};
  }
  if (kind === 'commit') {
    if (!OID.test(id)) throw new Error('Invalid commit ID');
    return {namespace, kind, commit: id};
  }
  const endpoints = id.split('..');
  if (endpoints.length !== 2 || endpoints.some(endpoint => !OID.test(endpoint)) || !HASH.test(params.document)) throw new Error('Invalid diff endpoints or document root');
  if (params.profile !== DIFF) throw new Error('Unsupported diff profile');
  if (kind === 'hunk' && (!HASH.test(params.patch) || !/^(?:0|[1-9][0-9]*)$/.test(params.ordinal) ||
      !Number.isSafeInteger(Number(params.ordinal)))) throw new Error('Invalid hunk selector');
  return {namespace, kind, from: endpoints[0], to: endpoints[1], ...params};
}

export function formatReference(namespace, root, locator, expect) {
  const kind = locator[0] === 'document' ? 'document' : 'section';
  const params = new URLSearchParams({anchor: ANCHOR, profile: DIGEST, expect, loc: encodeLocator(locator)});
  return `mdpkg://${namespace}/v2/${kind}/${root}?${params}`;
}
