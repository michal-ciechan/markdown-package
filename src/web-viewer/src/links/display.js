import {markdownParser} from '../ui/markdown-parser.js';

const models = new WeakMap();
function headingText(node) {
  let text = '';
  for (let child = node.firstChild; child; child = child.next) {
    if (child.type === 'text' || child.type === 'code') text += child.literal;
    else if (child.type === 'softbreak' || child.type === 'linebreak') text += '\n';
    else if (child.type === 'image') text += '[Image: ' + headingText(child) + ']';
    else text += headingText(child);
  }
  return text;
}

// Display fragments are an application convenience, never an identity map.
// Only exact direct-child source positions may map to canonical sections.
export function displayFor(model) {
  if (models.has(model)) return models.get(model);
  const ast = markdownParser().parse(model.text), fragments = new Map(), headings = [], counts = new Map();
  const scopes = new Map(model.scopes.filter(s => s.kind === 'section').map(s => [s.start, s]));
  const indices = new Map(model.scopes.map((s, index) => [s, index]));
  const add = (key, value) => {
    const candidates = fragments.get(key) ?? [];
    if (!candidates.includes(value)) candidates.push(value);
    fragments.set(key, candidates);
  };
  const walker = ast.walker(); let event;
  while ((event = walker.next())) {
    const node = event.node;
    if (!event.entering || node.type !== 'heading') continue;
    const title = headingText(node);
    const base = title.toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s+/g, '-');
    const occurrence = counts.get(base) ?? 0; counts.set(base, occurrence + 1);
    const slug = base + (occurrence ? '-' + occurrence : '');
    const candidate = node.parent === ast ? scopes.get(node.sourcepos[0][0] - 1) : undefined;
    const scope = candidate?.node.sourcepos[1][0] === node.sourcepos[1][0] ? candidate : undefined;
    const heading = {node, title, slug, scope, index: indices.get(scope), eligible: !!base && !!scope};
    headings.push(heading); add(slug, heading);
    if (scope) add(`mdpkg-section-${heading.index}`, heading);
  }
  const result = {ast, headings, fragments}; models.set(model, result); return result;
}

export function fragmentScope(model, fragment) {
  const candidates = displayFor(model).fragments.get(fragment) ?? [];
  if (!candidates.length) return {reason: 'target-not-found'};
  if (candidates.length !== 1 || !candidates[0].eligible) return {reason: 'choose-section'};
  return {scope: candidates[0].scope};
}
