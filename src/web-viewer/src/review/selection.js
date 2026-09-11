import {anchorRange} from './selector.js';
import {markdownParser} from '../ui/markdown-parser.js';
import {markdownRenderer} from '../ui/markdown-renderer.js';

function verifyEndpoint(model, host, node, offset, sourceOffset) {
  // A unique literal alone is insufficient: normalized code text might also
  // occur in a link destination or a different rendered node. Perturb source
  // and prove that the marker appears at this exact DOM text position.
  const marker = 'mdpkgSelection' + crypto.randomUUID().replaceAll('-', '');
  const template = document.createElement('template');
  template.innerHTML = markdownRenderer().render(markdownParser().parse(
    model.text.slice(0, sourceOffset) + marker + model.text.slice(sourceOffset)));
  const prefix = document.createRange(); prefix.selectNodeContents(host); prefix.setEnd(node, offset);
  const at = prefix.toString().length, visible = host.textContent;
  if (template.content.textContent !== visible.slice(0, at) + marker + visible.slice(at)) {
    throw new Error('Rendering transforms this selection. Use View source to select its exact source text.');
  }
}

// CommonMark exposes block positions, not inline positions. Accept an inline
// endpoint only when its complete DOM text node occurs exactly once in that
// block's source. Transformed/ambiguous text is an explicit source-view fallback.
function endpoint(model, host, node, offset) {
  if (node.nodeType !== 3) throw new Error('Select within text, or use View source for this selection.');
  const block = node.parentElement.closest('[data-sourcepos]');
  if (!block || !host.contains(block)) throw new Error('Use View source for this selection.');
  const match = /^(\d+):(\d+)-(\d+):(\d+)$/.exec(block.dataset.sourcepos);
  if (!match) throw new Error('Missing source positions.');
  // Include full lines: CommonMark columns in tabbed blocks need not be UTF-16 indices.
  const startLine = Number(match[1]) - 1, endLine = Number(match[3]);
  const base = model.lines.slice(0, startLine).reduce((n, line) => n + line.length + 1, 0);
  const isCell = block.matches('th, td');
  const column = isCell ? Number(match[2]) - 1 : 0;
  const source = isCell ? model.lines[startLine].slice(column, Number(match[4]) - 1) :
    model.lines.slice(startLine, endLine).join('\n');
  const literal = node.data;
  const at = source.indexOf(literal);
  if (!literal || at < 0 || source.indexOf(literal, at + 1) >= 0) {
    throw new Error('This rendered text has no unambiguous source position. Use View source and select the exact text.');
  }
  return base + column + at + offset;
}

export function selectionAnchor(model, host, range, sourceMode) {
  if (!range || range.collapsed || !host.contains(range.startContainer) || !host.contains(range.endContainer)) {
    throw new Error('Select text in the document first.');
  }
  let start, end;
  if (sourceMode) {
    const code = host.querySelector('pre > code');
    if (!code?.contains(range.startContainer) || !code.contains(range.endContainer)) throw new Error('Select source text only.');
    const prefix = range.cloneRange();
    prefix.selectNodeContents(code);
    prefix.setEnd(range.startContainer, range.startOffset);
    start = prefix.toString().length;
    end = start + range.toString().length;
  } else {
    start = endpoint(model, host, range.startContainer, range.startOffset);
    end = endpoint(model, host, range.endContainer, range.endOffset);
    verifyEndpoint(model, host, range.startContainer, range.startOffset, start);
    verifyEndpoint(model, host, range.endContainer, range.endOffset, end);
  }
  return anchorRange(model, start, end);
}
