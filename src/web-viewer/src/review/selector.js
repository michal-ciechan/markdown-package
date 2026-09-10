// All indices are UTF-16 code units, over canonical scope source (§6.8).
export const boundary = (text, offset) => !(offset > 0 && offset < text.length &&
  /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]));

export function makeSelector(source, start, end) {
  if (![start, end].every(Number.isSafeInteger) || start < 0 || end <= start || end > source.length ||
      !boundary(source, start) || !boundary(source, end)) throw new Error('Select a nonempty range without splitting a Unicode character.');
  const quote = source.slice(start, end);
  let occurrence = 0;
  for (let i = source.indexOf(quote); i >= 0 && i < start; i = source.indexOf(quote, i + 1)) occurrence++;
  let before = Math.max(0, start - 40), after = Math.min(source.length, end + 40);
  if (!boundary(source, before)) before++;
  if (!boundary(source, after)) after--;
  return {start, end, quote, occurrence, prefix: source.slice(before, start), suffix: source.slice(end, after)};
}

export function scopeOffset(model, scope) {
  return model.lines.slice(0, scope.start).reduce((sum, line) => sum + line.length + 1, 0);
}

export function anchorRange(model, start, end) {
  // Use the deepest common scope when a range crosses child sections. Never clamp.
  const candidates = model.scopes.filter(scope => {
    const offset = scopeOffset(model, scope);
    return start >= offset && end <= offset + model.source(scope).length;
  }).sort((a, b) => b.trail.length - a.trail.length ||
    (a.kind === 'document' ? 1 : 0) - (b.kind === 'document' ? 1 : 0));
  if (!candidates.length) throw new Error('Selection includes trailing source outside a canonical scope. Select a smaller range.');
  const scope = candidates[0], offset = scopeOffset(model, scope);
  return {scope, select: makeSelector(model.source(scope), start - offset, end - offset)};
}
