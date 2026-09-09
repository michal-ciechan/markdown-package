import {Parser} from 'commonmark';
import {decode, canonicalJson} from '../format.js';
import {canonicalScope, scopedDigest} from './digest.js';

export function outline(bytes, path) {
  const text = decode(bytes).replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const ast = new Parser({smart: false}).parse(text);
  const document = {kind: 'document', start: 0, end: lines.length, trail: [], title: path};
  const preamble = {kind: 'preamble', start: 0, end: lines.length, trail: [], title: 'Preamble'};
  const scopes = [document, preamble], stack = [], counts = new Map();
  let first = true;
  for (let node = ast.firstChild; node; node = node.next) {
    if (node.type !== 'heading') continue;
    const start = node.sourcepos[0][0] - 1;
    if (first) { preamble.end = start; first = false; }
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop().end = start;
    const parent = stack.length ? stack[stack.length - 1].trail : [];
    // Setext headings include all heading source lines, including the underline.
    const title = lines.slice(start, node.sourcepos[1][0]).join('\n');
    const family = canonicalJson([parent, title]);
    const occurrence = counts.get(family) ?? 0;
    counts.set(family, occurrence + 1);
    const scope = {kind: 'section', start, end: lines.length, level: node.level,
      title, trail: [...parent, [title, occurrence]], node};
    scopes.push(scope);
    stack.push(scope);
  }
  const byLocator = new Map();
  for (const scope of scopes) {
    scope.locator = [scope.kind, path, scope.trail];
    byLocator.set(canonicalJson(scope.locator), scope);
  }
  const digests = new Map();
  return {
    path, bytes, text, lines, ast, scopes,
    find(locator) { return byLocator.get(canonicalJson(locator)); },
    source(scope) { return canonicalScope(lines.slice(scope.start, scope.end).join('\n')); },
    digest(scope) {
      if (!digests.has(scope)) digests.set(scope, scopedDigest(scope.kind, lines.slice(scope.start, scope.end).join('\n')));
      return digests.get(scope);
    },
  };
}
