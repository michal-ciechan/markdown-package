import {validatePath, isReserved} from '../container/conformance.js';

export function destination(source, href) {
  if (href.startsWith('mdpkg:')) return {kind: 'identity', href};
  if (/^(?:https?:|mailto:)/i.test(href)) return {kind: 'external', href};
  const hash = href.indexOf('#');
  const path = decodeURIComponent(hash < 0 ? href : href.slice(0, hash));
  const fragment = hash < 0 ? '' : decodeURIComponent(href.slice(hash + 1));
  if (path.startsWith('//') || /[?\\\u0000-\u001f\u007f]/.test(path) ||
      /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) || /[\u0000-\u001f\u007f]/.test(fragment)) throw new Error('Unsupported package link');
  const parts = path.startsWith('/') ? [] : source.split('/').slice(0, -1);
  if (path) for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new Error('Link leaves the package');
      parts.pop();
    } else parts.push(part);
  }
  const name = path ? parts.join('/') : source;
  validatePath(name);
  if (isReserved(name)) throw new Error('Link points into a reserved region');
  return {kind: /\.(md|markdown)$/i.test(name) ? 'location' : 'ordinary', path: name, fragment};
}

export function markdownLink(label, reference) {
  // All ASCII punctuation can be escaped in CommonMark labels, including
  // image/link delimiters, code and HTML. Flatten line breaks in the editable label.
  return `[${label.replace(/[\r\n]+/g, ' ').replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, '\\$&')}](${reference})`;
}
