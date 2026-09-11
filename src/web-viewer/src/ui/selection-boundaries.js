// Offsets here describe visible prose only. Source anchoring stays in review/selection.js.
export function wordBounds(text, offset) {
  for (const match of text.matchAll(/[\p{L}\p{N}\p{M}_]+(?:['’\-][\p{L}\p{N}\p{M}_]+)*/gu)) {
    const end = match.index + match[0].length;
    if (match.index <= offset && offset < end) return {start: match.index, end};
  }
}

function trimmed(text, start, end) {
  const part = text.slice(start, end), leading = part.length - part.trimStart().length;
  return {start: start + leading, end: end - (part.length - part.trimEnd().length)};
}

export function sentenceBounds(text, start, end = start + 1) {
  const sentences = [];
  let from = 0;
  for (const match of text.matchAll(/[.!?。！？]+["'”’»\])}]*(?=\s|$)/gu)) {
    const to = match.index + match[0].length;
    const prefix = text.slice(0, match.index + 1);
    // Titles, initials and common abbreviations are usually internal to a sentence.
    if (match[0][0] === '.' && /(?:\b(?:e\.g|i\.e|Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc)|\b\p{Lu}|(?:\b\p{L}\.)+\p{L})\.$/iu.test(prefix)) continue;
    sentences.push(trimmed(text, from, to));
    from = to;
  }
  if (from < text.length) sentences.push(trimmed(text, from, text.length));
  const first = sentences.find(part => part.start <= start && start < part.end);
  const last = sentences.find(part => part.start < end && end <= part.end);
  if (first && last) return {start: first.start, end: last.end};
}
