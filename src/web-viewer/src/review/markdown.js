// Plain-Markdown review export (docs/plans/2026-09-23-review-as-plain-markdown.md).
// Pure: no DOM, no package, no manifest. The renderer sees only the review
// document, which carries no namespace and no snapshot id
// (review/comments.js:16-20), so it cannot make an identity or obtainability
// claim and CARD-0062's LOOSE_EXPORT_CAVEAT does not apply to its output.
// Keep it that way: never import formatReference or read pkg.manifest here.
import {decodeLocator} from '../address/reference.js';

const STATES = ['open', 'resolved', 'obsolete'];
// Backslash-escape only what can open emphasis, a link, raw HTML or an entity
// mid-line. Leaving `-` and `.` alone keeps ordinary names and paths readable.
const escape = value => String(value).replace(/[\\`*_[\]<>&]/g, '\\$&');
const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
// An embedded fence must not terminate the block: outrun the longest run inside.
const fence = text => '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(run => run[0].length + 1)));
// Blockquote depth, never indentation: four spaces is an indented code block and
// silently turns the third comment of a reply chain into source (plan §2.2).
const quoted = (text, depth) => text.split('\n')
  .map(line => line ? '>'.repeat(depth) + ' ' + line : '>'.repeat(depth));

// Trail titles are raw heading source, Setext underline included
// (address/outline.js:20). Fold one to a single display line.
function headingText(title) {
  const lines = title.split('\n');
  const text = lines.length > 1 ? lines.slice(0, -1).join(' ')
    : lines[0].replace(/^ {0,3}#{1,6}(?:[ \t]+|$)/, '').replace(/[ \t]+#+[ \t]*$/, '');
  return text.trim().replace(/\s+/g, ' ') || '(untitled)';
}

function scopeTitle([kind, , trail]) {
  if (kind === 'preamble') return 'Preamble';
  if (!trail.length) return 'Whole document';
  return trail.map(([title, occurrence]) =>
    escape(headingText(title)) + (occurrence ? ` (${occurrence + 1})` : '')).join(' › ');
}

// Depth-first over inReplyTo, iteratively: a reply chain has no format depth cap.
function replyOrder(comments) {
  const ids = new Set(comments.map(comment => comment.id)), children = new Map(), roots = [];
  for (const comment of comments) {
    if (!ids.has(comment.inReplyTo)) { roots.push(comment); continue; }
    if (!children.has(comment.inReplyTo)) children.set(comment.inReplyTo, []);
    children.get(comment.inReplyTo).push(comment);
  }
  const out = [], stack = roots.map(comment => ({comment, depth: 0})).reverse();
  while (stack.length) {
    const entry = stack.pop();
    out.push(entry);
    const kids = children.get(entry.comment.id) ?? [];
    for (let i = kids.length - 1; i >= 0; i--) stack.push({comment: kids[i], depth: entry.depth + 1});
  }
  return out;
}

// Verbatim excerpts are what make the export standalone, but a section scope
// runs to the next sibling heading, so "Review selected section" can quote a
// whole 146 KB document (plan §4, D-1). Cap the display copy only; the review
// document and the .mdpkg export keep the full quote, which validateAnchors
// re-derives byte for byte.
function capped(quote, limit) {
  if (!(limit > 0) || quote.length <= limit) return quote;
  const split = /[\uD800-\uDBFF]/.test(quote[limit - 1]) && /[\uDC00-\uDFFF]/.test(quote[limit]);
  return quote.slice(0, split ? limit - 1 : limit);
}

// `order` maps a thread to a numeric sort key; D-2 passes commentInterval's
// absolute source offset. Threads it does not rank keep their authoring index.
export function reviewMarkdown(review, {packageName, now = new Date(), quoteLimit = 600, base = 1, order} = {}) {
  const level = depth => '#'.repeat(Math.min(6, base + depth));
  const entries = (review?.threads ?? []).map((thread, index) =>
    ({thread, locator: decodeLocator(thread.loc), index, key: order?.(thread) ?? index}));
  const rank = list => Math.min(...list.map(entry => entry.key));
  const byKey = (a, b) => a.key - b.key || a.index - b.index;

  const grouped = new Map();
  for (const entry of entries) {
    const path = entry.locator[1], scope = JSON.stringify([entry.locator[0], entry.locator[2]]);
    if (!grouped.has(path)) grouped.set(path, new Map());
    if (!grouped.get(path).has(scope)) grouped.get(path).set(scope, {locator: entry.locator, entries: []});
    grouped.get(path).get(scope).entries.push(entry);
  }
  // A section and its subsections interleave by offset, so rank each group by
  // its earliest thread rather than grouping runs of an already-sorted list.
  const documents = [...grouped].map(([path, scopes]) => {
    const sections = [...scopes.values()];
    for (const section of sections) section.entries.sort(byKey);
    sections.sort((a, b) => rank(a.entries) - rank(b.entries));
    return {path, sections};
  }).sort((a, b) => rank(a.sections[0].entries) - rank(b.sections[0].entries));

  const threads = entries.map(entry => entry.thread);
  const comments = threads.flatMap(thread => thread.comments ?? []);
  const authors = [...new Set(comments.map(comment => comment.author))];
  const states = STATES.map(state => [state, threads.filter(thread => thread.state === state).length])
    .filter(([, count]) => count);
  const exported = `Exported ${now.toISOString().slice(0, 10)}.`;
  const lines = [`${level(0)} Review${packageName ? ' of ' + escape(packageName) : ''}`, '',
    threads.length
      ? `${plural(threads.length, 'thread')} (${states.map(([state, count]) => `${count} ${state}`).join(', ')}), ` +
        `${plural(comments.length, 'comment')}${authors.length ? ' by ' + authors.map(escape).join(', ') : ''}. ${exported}`
      : `No comments. ${exported}`, ''];

  for (const document of documents) {
    lines.push(`${level(1)} ${escape(document.path)}`, '');
    for (const section of document.sections) {
      lines.push(`${level(2)} ${scopeTitle(section.locator)}`, '');
      for (const {thread} of section.entries) {
        const quote = thread.select?.quote ?? '', shown = capped(quote, quoteLimit), bar = fence(shown);
        lines.push(bar, ...shown.split('\n'), bar, '');
        if (shown.length < quote.length) lines.push(`_…quote truncated (${quote.length} characters total)._`, '');
        // D-4: every thread is exported whatever the inline filter shows, so the
        // state has to be on the page. It belongs to the thread, not a comment.
        let first = true;
        for (const {comment, depth} of replyOrder(thread.comments ?? [])) {
          const label = comment.kind === 'change-request' ? 'Change request' : 'Comment';
          const meta = `**${label}** — ${escape(comment.author)}, ${comment.at}` +
            (first ? ` · _${thread.state}_` : '');
          first = false;
          // Depth 0 keeps the metadata above the blockquote so the body stays a
          // clean quotable block; a reply carries both at its own depth.
          lines.push(...(depth ? quoted(meta + '\n\n' + comment.body, depth + 1)
            : [meta, '', ...quoted(comment.body, 1)]), '');
        }
      }
    }
  }
  return lines.join('\n').replace(/\n+$/, '\n');
}
