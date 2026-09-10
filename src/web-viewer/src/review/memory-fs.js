// Private ephemeral filesystem for isomorphic-git's review-only repository.
// It never mounts paths from the opened package or writes to the device.
import {utf8, decode} from '../format.js';
export function memoryFs() {
  const files = new Map(), dirs = new Set(['']);
  const normalize = path => {
    if (path.includes('..') || path.includes('\\')) throw new Error('Invalid memory filesystem path');
    return path.replace(/^\/+|\/+$/g, '');
  };
  const missing = path => { throw Object.assign(new Error('ENOENT ' + path), {code: 'ENOENT'}); };
  const stat = async raw => {
    const path = normalize(raw), file = files.get(path);
    if (!file && !dirs.has(path)) missing(path);
    return {isFile: () => !!file, isDirectory: () => !file, isSymbolicLink: () => false,
      mode: file ? 0o100644 : 0o40755, size: file?.length ?? 0, mtimeMs: 0, ctimeMs: 0, ino: 1, dev: 1};
  };
  const promises = {
    async readFile(raw, options) {
      const data = files.get(normalize(raw));
      if (!data) missing(raw);
      return typeof options === 'string' || options?.encoding ? decode(data) : data.slice();
    },
    async writeFile(raw, data) {
      const path = normalize(raw), parts = path.split('/'); parts.pop();
      while (parts.length) { dirs.add(parts.join('/')); parts.pop(); }
      files.set(path, typeof data === 'string' ? utf8.encode(data) : Uint8Array.from(data));
    },
    async mkdir(raw) { dirs.add(normalize(raw)); },
    async readdir(raw) {
      const path = normalize(raw), prefix = path ? path + '/' : '';
      if (!dirs.has(path)) missing(raw);
      return [...new Set([...files.keys(), ...dirs].filter(p => p.startsWith(prefix) && p !== path)
        .map(p => p.slice(prefix.length).split('/')[0]))].sort();
    },
    async unlink(raw) { if (!files.delete(normalize(raw))) missing(raw); },
    async rmdir(raw) { dirs.delete(normalize(raw)); },
    stat, lstat: stat,
    async readlink(raw) { missing(raw); },
    async symlink() { throw new Error('Symlinks are unsupported'); },
  };
  return {promises};
}
