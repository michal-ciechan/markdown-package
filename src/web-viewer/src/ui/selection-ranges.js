import {wordBounds, sentenceBounds} from './selection-boundaries.js';

const blocks = 'p, li, pre, h1, h2, h3, h4, h5, h6';
const parent = node => node.nodeType === 1 ? node : node.parentElement;

export function sameRange(a, b) {
  return !!a && !!b && a.startContainer === b.startContainer && a.startOffset === b.startOffset &&
    a.endContainer === b.endContainer && a.endOffset === b.endOffset;
}

function textIndex(element, ownBlock = false) {
  const nodes = [], walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node, text = '';
  while ((node = walker.nextNode())) {
    // A tight list item's paragraph ends before its nested list, even without <p>.
    if (ownBlock && parent(node).closest(blocks) !== element) break;
    nodes.push({node, start: text.length}); text += node.data;
  }
  return {text, nodes};
}

function textRange(index, start, end) {
  const first = index.nodes.find(item => item.start + item.node.length > start);
  const last = index.nodes.find(item => item.start < end && item.start + item.node.length >= end);
  if (!first || !last || start >= end) return;
  const range = document.createRange();
  range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start);
  return range;
}

function contents(element, ownBlock = false) {
  const index = textIndex(element, ownBlock), text = index.text;
  return textRange(index, text.length - text.trimStart().length, text.trimEnd().length);
}

function offsets(element, range) {
  const prefix = document.createRange(); prefix.selectNodeContents(element);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  prefix.setEnd(range.endContainer, range.endOffset);
  return {start, end: prefix.toString().length};
}

export function wordAtPoint(host, x, y) {
  let node, offset;
  if (document.caretPositionFromPoint) {
    const caret = document.caretPositionFromPoint(x, y);
    node = caret?.offsetNode; offset = caret?.offset;
  } else {
    const caret = document.caretRangeFromPoint?.(x, y);
    node = caret?.startContainer; offset = caret?.startOffset;
  }
  if (node?.nodeType !== 3 || !host.contains(node)) return;
  const block = parent(node).closest(blocks);
  if (!block || !host.contains(block)) return;
  const index = textIndex(block, true), entry = index.nodes.find(item => item.node === node);
  if (!entry) return;
  const at = entry.start + offset;
  // Caret hit tests return the nearest insertion point, sometimes just after a word.
  // Verify the actual word rectangles so clicks in blank space never pick nearby prose.
  for (const point of [at, at - 1]) {
    const bounds = wordBounds(index.text, point);
    if (!bounds) continue;
    const range = textRange(index, bounds.start, bounds.end);
    if ([...range.getClientRects()].some(rect => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) return range;
  }
}

function sectionRange(host, range, model) {
  const startBlock = parent(range.startContainer).closest('[data-sourcepos]');
  const endBlock = parent(range.endContainer).closest('[data-sourcepos]');
  if (!startBlock || !endBlock) return;
  const start = Number(startBlock.dataset.sourcepos.split(':')[0]) - 1;
  const end = Number(endBlock.dataset.sourcepos.split('-')[1].split(':')[0]);
  const scope = model.scopes.filter(scope => scope.start <= start && scope.end >= end)
    .sort((a, b) => b.trail.length - a.trail.length || (a.kind === 'document') - (b.kind === 'document'))[0];
  if (!scope) return;
  // Use the same outline's scope extents; select visible text with text-node endpoints.
  // This is a DOM range, still subject to the existing ambiguity/source-view checks.
  const elements = [...host.children].filter(element => {
    const line = Number(element.dataset.sourcepos?.split(':')[0]) - 1;
    return line >= scope.start && line < scope.end;
  });
  const ranges = elements.map(element => contents(element)).filter(Boolean);
  if (!ranges.length) return;
  const result = ranges[0].cloneRange(), last = ranges.at(-1);
  result.setEnd(last.endContainer, last.endOffset);
  return result;
}

export function nextExpansion(host, range, model) {
  const candidates = [];
  const block = parent(range.startContainer).closest(blocks);
  if (block && host.contains(block) && block.contains(range.endContainer)) {
    const index = textIndex(block, true), {start, end} = offsets(block, range);
    const word = wordBounds(index.text, start);
    if (word && word.end >= end) candidates.push({level: 'word', range: textRange(index, word.start, word.end)});
    const sentence = sentenceBounds(index.text, start, end);
    if (sentence) candidates.push({level: 'sentence', range: textRange(index, sentence.start, sentence.end)});
    candidates.push({level: 'paragraph', range: contents(block, true)});
  }
  const grows = candidate => candidate.range &&
    candidate.range.compareBoundaryPoints(Range.START_TO_START, range) <= 0 &&
    candidate.range.compareBoundaryPoints(Range.END_TO_END, range) >= 0 &&
    !sameRange(candidate.range, range);
  const next = candidates.find(grows);
  if (next) return next;
  const section = {level: 'section', range: sectionRange(host, range, model)};
  if (grows(section)) return section;
}
