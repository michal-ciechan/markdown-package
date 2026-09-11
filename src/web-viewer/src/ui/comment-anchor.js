import {decodeLocator} from '../address/reference.js';
import {canonicalJson} from '../format.js';
import {makeSelector, scopeOffset} from '../review/selector.js';
import {selectionAnchor} from '../review/selection.js';

export function commentInterval(model, locator, select) {
  const scope = model.find(decodeLocator(locator));
  if (!scope || canonicalJson(makeSelector(model.source(scope), select.start, select.end)) !== canonicalJson(select))
    throw new Error('The original quote is unavailable in this document.');
  const offset = scopeOffset(model, scope);
  return {start: offset + select.start, end: offset + select.end};
}

// Invert only literal, unambiguous source positions, then ask the existing
// authoring verifier to prove the result. Never relocate by quote search alone.
export function commentAnchor(model, article, interval, sourceMode) {
  const blocks = [...article.querySelectorAll('[data-sourcepos]')];
  const lineOffsets = [0];
  for (const line of model.lines) lineOffsets.push(lineOffsets.at(-1) + line.length + 1);
  let first, last;
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode, block = node.parentElement.closest('[data-sourcepos]');
    let base = 0, source = model.text;
    if (!sourceMode) {
      if (!block) continue;
      const [a, b, c, d] = block.dataset.sourcepos.match(/\d+/g).map(Number);
      const cell = block.matches('th,td'), column = cell ? b - 1 : 0;
      base = lineOffsets[a - 1] + column;
      source = cell ? model.lines[a - 1].slice(column, d - 1) : model.lines.slice(a - 1, c).join('\n');
    }
    const at = source.indexOf(node.data);
    if (!node.data || at < 0 || source.indexOf(node.data, at + 1) >= 0) continue;
    const start = base + at, end = start + node.length;
    if (interval.start >= start && interval.start < end) first = [node, interval.start - start];
    if (interval.end > start && interval.end <= end) last = [node, interval.end - start];
  }
  let range;
  if (first && last) try {
    range = document.createRange(); range.setStart(...first); range.setEnd(...last);
    const anchor = selectionAnchor(model, article, range, sourceMode), offset = scopeOffset(model, anchor.scope);
    if (offset + anchor.select.start !== interval.start || offset + anchor.select.end !== interval.end) range = undefined;
  } catch { range = undefined; }
  let block = range?.endContainer.parentElement.closest('p,pre,li,h1,h2,h3,h4,h5,h6,th,td');
  if (!block) block = blocks.filter(b => {
    const [a, , c] = b.dataset.sourcepos.match(/\d+/g).map(Number);
    return lineOffsets[a - 1] <= interval.start && lineOffsets[c] > interval.start;
  }).at(-1) ?? blocks.find(b => lineOffsets[Number(b.dataset.sourcepos.split(':')[0]) - 1] >= interval.start) ?? article.lastElementChild;
  block = block?.closest('.table-container') ?? block;
  if (sourceMode) block = article.querySelector('pre');
  return {block, range};
}
