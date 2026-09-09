export const MAGIC = '{"mdpkg":"markdown-package/1"';
export const MANIFEST = '.mdpkg/manifest.json';
export const ANCHOR = 'cm0312-trail-source-v1';
export const DIGEST = 'cm0312-source-lf-v1';
export const DIFF = 'git-myers-u3-v1';
export const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export const HASH = /^[a-f0-9]{64}$/;
export const OID = /^(?:sha1-[a-f0-9]{40}|sha256-[a-f0-9]{64})$/;
export const utf8 = new TextEncoder();
// ignoreBOM means do not consume the BOM: it is source, per §6.1.
export const decode = bytes => new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function byteOrder(a, b) {
  const x = utf8.encode(a), y = utf8.encode(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

// Write keys directly, since JSON.stringify reorders integer-like object keys.
function json(value) {
  if (Array.isArray(value)) return '[' + value.map(json).join(',') + ']';
  if (isObject(value)) return '{' + Object.keys(value).sort(byteOrder)
    .map(key => JSON.stringify(key) + ':' + json(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export const canonicalJson = value => json(value) + '\n';

export function parseCanonicalJson(bytes, manifest = false) {
  const source = decode(bytes);
  const value = JSON.parse(source);
  const canonical = manifest && isObject(value)
    ? '{"mdpkg":' + JSON.stringify(value.mdpkg) + ',' +
      canonicalJson(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'mdpkg'))).slice(1)
    : canonicalJson(value);
  // Also rejects duplicate keys, ambiguous encodings and noncanonical locators.
  if (source !== canonical) throw new Error('Control JSON is not canonical');
  return value;
}
