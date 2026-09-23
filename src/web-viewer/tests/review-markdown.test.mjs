// Plain-Markdown review export, docs/plans/2026-09-23-review-as-plain-markdown.md.
// Every fixture is a real review document: the builders run validateComments, so
// a case can never assert against a shape the authoring path cannot produce.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Parser, HtmlRenderer} from 'commonmark';
import {reviewMarkdown} from '../src/review/markdown.js';
import {encodeLocator} from '../src/address/reference.js';
import {makeSelector} from '../src/review/selector.js';
import {newReview, validateComments} from '../src/review/comments.js';

const NOW = new Date('2026-09-23T12:00:00Z');
const digest = seed => seed.toString(16).padStart(64, '0');
const render = (threads, options) => reviewMarkdown(document(threads), {now: NOW, ...options});
function document(threads, version = 2) {
  return validateComments({...newReview(), version, threads}, {reading: version === 1});
}
function comment(author, kind, body, inReplyTo, at = '2026-09-23T00:05:50.320Z') {
  return {id: crypto.randomUUID(), at, author, ...(kind === undefined ? {} : {kind}), body,
    ...(inReplyTo ? {inReplyTo} : {})};
}
function thread({kind = 'section', path = 'guide.md', trail = [['## Prerequisites', 0]],
  source, start = 0, end = source.length, state = 'open', comments}) {
  return {id: crypto.randomUUID(), root: digest(1), expect: digest(2),
    loc: encodeLocator([kind, path, trail]), state, select: makeSelector(source, start, end), comments};
}
const parse = markdown => new Parser({smart: false}).parse(markdown);
const html = markdown => new HtmlRenderer().render(parse(markdown));
// Read the structure a recipient's CommonMark actually receives, not the text.
function inventory(markdown) {
  const walker = parse(markdown).walker();
  const headings = [], headingDepths = [], code = [];
  let depth = 0, maxQuoteDepth = 0;
  for (let event = walker.next(); event; event = walker.next()) {
    const node = event.node;
    if (node.type === 'block_quote') { depth += event.entering ? 1 : -1; maxQuoteDepth = Math.max(maxQuoteDepth, depth); }
    if (!event.entering) continue;
    if (node.type === 'heading') { headings.push('#'.repeat(node.level) + ' ' + (node.firstChild?.literal ?? '')); headingDepths.push(depth); }
    if (node.type === 'code_block') code.push({literal: node.literal, depth});
  }
  return {headings, headingDepths, code, maxQuoteDepth};
}

test('M1 the recommended shape groups by document then section and prints the state inline', () => {
  const first = comment('Priya', 'change-request', 'Promoting to all stages in one step is too coarse.');
  const out = render([
    thread({source: '## Prerequisites\n\nYou need the deploy key.\n', state: 'resolved',
      comments: [comment('Priya', 'comment', 'The key moved to `ops/deploy-v2`.')]}),
    thread({trail: [['# Deployment guide', 0], ['## Rolling out', 0]], source: 'deploy --stage all',
      comments: [first, comment('Sam', 'comment', 'Agreed. Gate on the 5xx rate.', first.id)]}),
  ], {packageName: 'ingest-runbook.mdpkg'});
  assert.equal(out, [
    '# Review of ingest-runbook.mdpkg',
    '',
    '2 threads (1 open, 1 resolved), 3 comments by Priya, Sam. Exported 2026-09-23.',
    '',
    '## guide.md',
    '',
    '### Prerequisites',
    '',
    '```',
    '## Prerequisites',
    '',
    'You need the deploy key.',
    '',
    '```',
    '',
    '**Comment** — Priya, 2026-09-23T00:05:50.320Z · _resolved_',
    '',
    '> The key moved to `ops/deploy-v2`.',
    '',
    '### Deployment guide › Rolling out',
    '',
    '```',
    'deploy --stage all',
    '```',
    '',
    '**Change request** — Priya, 2026-09-23T00:05:50.320Z · _open_',
    '',
    '> Promoting to all stages in one step is too coarse.',
    '',
    '>> **Comment** — Sam, 2026-09-23T00:05:50.320Z',
    '>>',
    '>> Agreed. Gate on the 5xx rate.',
    '',
  ].join('\n'));
});

test('M2 an embedded fence, Setext rule and raw HTML in the quote stay inert source', () => {
  const source = 'before\n```\nnested\n````\ndeeper\n`````\n---\n<script>alert(1)</script>\nTitle\n=====\nafter';
  const out = render([thread({source, comments: [comment('Priya', 'comment', 'Look at this.')]})]);
  const {code, headings} = inventory(out);
  assert.equal(out.includes('\n``````\n'), true, 'fence outruns the longest embedded backtick run');
  assert.equal(code.length, 1);
  assert.equal(code[0].literal, source + '\n');
  // Nothing inside the quote became structure: only the export's own headings.
  assert.deepEqual(headings, ['# Review', '## guide.md', '### Prerequisites']);
  assert.equal(html(out).includes('<script>'), false);
});

test('M3 a body keeps its Markdown but every heading it makes is inside the blockquote', () => {
  const body = '## Not a heading in the host document\n\n---\n\n<b>raw</b>\n\nUnderline\n=====\n\n- one\n- two';
  const out = render([thread({source: 'deploy --stage all', comments: [comment('Priya', 'comment', body)]})]);
  const {headings, headingDepths} = inventory(out);
  assert.deepEqual(headings.slice(0, 3), ['# Review', '## guide.md', '### Prerequisites']);
  assert.deepEqual(headingDepths.slice(0, 3), [0, 0, 0]);
  // A body's own headings survive as headings, but nested, never as siblings.
  assert.deepEqual(headings.slice(3), ['## Not a heading in the host document', '# Underline']);
  assert.deepEqual(headingDepths.slice(3), [1, 1]);
  assert.equal(html(out).includes('<li>one</li>'), true);
});

test('M4 a three-deep reply chain nests by blockquote depth and never becomes a code block', () => {
  const root = comment('Priya', 'change-request', 'Split this into 25% / 100%.');
  const one = comment('Sam', 'comment', 'Agreed.', root.id);
  const two = comment('Ada', 'comment', 'Gate on the 5xx rate.', one.id);
  const three = comment('Kit', 'change-request', 'Name the metric in the runbook.', two.id);
  const out = render([thread({source: 'deploy --stage all', comments: [root, one, two, three]})]);
  assert.equal(out.includes('\n>> **Comment** — Sam,'), true);
  assert.equal(out.includes('\n>>> **Comment** — Ada,'), true);
  assert.equal(out.includes('\n>>>> **Change request** — Kit,'), true);
  const {code, maxQuoteDepth} = inventory(out);
  assert.equal(maxQuoteDepth, 4);
  // The indentation trap (plan section 2.2): no reply may land in a code block.
  assert.deepEqual(code.map(block => block.literal), ['deploy --stage all\n']);
  for (const author of ['Sam', 'Ada', 'Kit']) assert.equal(html(out).includes(author), true);
});

test('M5 replies fan out depth-first and only the first comment carries the thread state', () => {
  const root = comment('Priya', 'change-request', 'Root.');
  const a = comment('Sam', 'comment', 'Branch A.', root.id);
  const b = comment('Ada', 'comment', 'Branch B.', root.id);
  const a1 = comment('Kit', 'comment', 'Under A.', a.id);
  const out = render([thread({source: 'deploy --stage all', state: 'obsolete', comments: [root, a, b, a1]})]);
  assert.deepEqual(out.split('\n').filter(line => line.includes('**')), [
    '**Change request** — Priya, 2026-09-23T00:05:50.320Z · _obsolete_',
    '>> **Comment** — Sam, 2026-09-23T00:05:50.320Z',
    '>>> **Comment** — Kit, 2026-09-23T00:05:50.320Z',
    '>> **Comment** — Ada, 2026-09-23T00:05:50.320Z',
  ]);
});

test('M6 heading trails fold Setext underlines, strip ATX markers and disambiguate occurrences', () => {
  const trail = [['Deployment guide\n================', 0], ['###   Setup   ###', 1], ['#####', 0]];
  const out = render([thread({trail, source: 'x', comments: [comment('Priya', 'comment', 'Here.')]})]);
  assert.equal(out.includes('### Deployment guide › Setup (2) › (untitled)'), true);
});

test('M7 document and preamble locators name their scope without inventing a heading', () => {
  const out = render([
    thread({kind: 'document', trail: [], source: 'whole', comments: [comment('Priya', 'comment', 'All of it.')]}),
    thread({kind: 'preamble', trail: [], path: 'notes.md', source: 'intro', comments: [comment('Sam', 'comment', 'Front matter.')]}),
  ]);
  assert.equal(out.includes('## guide.md\n\n### Whole document\n'), true);
  assert.equal(out.includes('## notes.md\n\n### Preamble\n'), true);
});

test('M8 a version-1 comment with no kind renders as an unlabelled comment', () => {
  const out = reviewMarkdown(document([thread({source: 'x', comments: [comment('Priya', undefined, 'From v1.')]})], 1), {now: NOW});
  assert.equal(out.includes('**Comment** — Priya, 2026-09-23T00:05:50.320Z · _open_'), true);
});

test('M9 quote capping fires one character over the limit and never splits a surrogate pair', () => {
  const at = size => render([thread({source: 'a'.repeat(size), comments: [comment('Priya', 'comment', 'x')]})]);
  assert.equal(at(600).includes('quote truncated'), false);
  assert.equal(at(600).includes('a'.repeat(600)), true);
  assert.equal(at(601).includes('_…quote truncated (601 characters total)._'), true);
  assert.equal(at(601).includes('a'.repeat(601)), false);
  assert.equal(at(601).includes('a'.repeat(600)), true);
  // The cap lands between the halves of an astral character: back off, never split.
  const astral = render([thread({source: 'a'.repeat(599) + '\u{1F600}b', comments: [comment('Priya', 'comment', 'x')]})]);
  assert.equal(astral.includes('\u{1F600}'), false);
  assert.equal(astral.includes('_…quote truncated (602 characters total)._'), true);
  assert.equal(inventory(astral).code[0].literal, 'a'.repeat(599) + '\n');
  // The limit is an option, and a whole-section quote survives when it is lifted.
  const full = render([thread({source: 'z'.repeat(5000), comments: [comment('Priya', 'comment', 'x')]})], {quoteLimit: Infinity});
  assert.equal(full.includes('z'.repeat(5000)), true);
  assert.equal(full.includes('quote truncated'), false);
});

test('M10 an empty review renders a header and says so', () => {
  assert.equal(reviewMarkdown(document([]), {now: NOW, packageName: 'ingest.mdpkg'}),
    '# Review of ingest.mdpkg\n\nNo comments. Exported 2026-09-23.\n');
  assert.equal(reviewMarkdown(document([]), {now: NOW}), '# Review\n\nNo comments. Exported 2026-09-23.\n');
});

test('M11 document order re-sorts documents, sections and threads; authoring order is the default', () => {
  const make = (path, trail, body) => thread({path, trail, source: body, comments: [comment('Priya', 'comment', body)]});
  const threads = [
    make('guide.md', [['## Rolling out', 0]], 'rolling'),
    make('guide.md', [['## Rolling out', 0], ['### Rollback', 0]], 'rollback'),
    make('guide.md', [['## Prerequisites', 0]], 'prereq'),
    make('notes.md', [['## On-call', 0]], 'oncall'),
  ];
  const sections = markdown => markdown.split('\n').filter(line => /^#{2,3} /.test(line));
  assert.deepEqual(sections(render(threads)), ['## guide.md', '### Rolling out',
    '### Rolling out › Rollback', '### Prerequisites', '## notes.md', '### On-call']);
  // Document order by absolute source offset, the shape commentInterval produces.
  const offsets = new Map([[threads[0].id, 200], [threads[1].id, 300], [threads[2].id, 100], [threads[3].id, 50]]);
  assert.deepEqual(sections(render(threads, {order: thread => offsets.get(thread.id)})),
    ['## notes.md', '### On-call', '## guide.md', '### Prerequisites', '### Rolling out',
      '### Rolling out › Rollback']);
});

test('M12 a parent section keeps its own threads together when a subsection interleaves', () => {
  const make = (trail, body) => thread({trail, source: body, comments: [comment('Priya', 'comment', body)]});
  const threads = [make([['## Rolling out', 0]], 'first'), make([['## Rolling out', 0], ['### Rollback', 0]], 'inner'),
    make([['## Rolling out', 0]], 'last')];
  const offsets = new Map([[threads[0].id, 100], [threads[1].id, 200], [threads[2].id, 300]]);
  const out = render(threads, {order: thread => offsets.get(thread.id)});
  assert.deepEqual(out.split('\n').filter(line => line.startsWith('### ')),
    ['### Rolling out', '### Rolling out › Rollback']);
  assert.equal(out.indexOf('first') < out.indexOf('last'), true);
  assert.equal(out.indexOf('last') < out.indexOf('inner'), true);
});

test('M13 the heading base level is an option and never runs past h6', () => {
  const threads = [thread({source: 'x', comments: [comment('Priya', 'comment', 'body')]})];
  assert.deepEqual(inventory(render(threads, {base: 3})).headings,
    ['### Review', '#### guide.md', '##### Prerequisites']);
  assert.deepEqual(inventory(render(threads, {base: 9})).headings.map(heading => heading.split(' ')[0]),
    ['######', '######', '######']);
});

test('M14 the rendered export carries no namespace, snapshot id, digest or mdpkg reference', () => {
  const out = render([
    thread({source: 'deploy --stage all', comments: [comment('Priya', 'change-request', 'Split it.')]}),
    thread({kind: 'document', trail: [], path: 'notes.md', source: 'all', comments: [comment('Sam', 'comment', 'Fine.')]}),
  ], {packageName: 'ingest-runbook.mdpkg'});
  // CARD-0062's caveat exists for the (namespace, snapshot id) pair an exported
  // .mdpkg claims. None of it may reach this renderer's output (plan section 3).
  assert.equal(/mdpkg:\/\//.test(out), false);
  assert.equal(/[a-f0-9]{64}/.test(out), false, 'no root or expect digest');
  assert.equal(/[a-f0-9]{8}-[a-f0-9]{4}-/.test(out), false, 'no thread, comment or namespace UUID');
  assert.equal(/sha256-/.test(out), false);
  assert.equal(out.includes('anchor='), false);
  assert.equal(out.includes('loc='), false);
});

test('M15 an author or package name cannot inject emphasis, a link or raw HTML', () => {
  const out = render([thread({source: 'x', comments: [comment('*Priya* <b>x</b> [a](b) `c`', 'comment', 'body')]})],
    {packageName: '__runbook__ <img src=x>'});
  const rendered = html(out);
  assert.equal(rendered.includes('<em>Priya</em>'), false);
  assert.equal(rendered.includes('<b>x</b>'), false);
  assert.equal(rendered.includes('<a href'), false);
  assert.equal(rendered.includes('<code>c</code>'), false);
  assert.equal(rendered.includes('<strong>runbook</strong>'), false);
  assert.equal(rendered.includes('<img src=x>'), false);
  // The escapes are invisible once rendered: the name still reads as itself.
  assert.equal(rendered.startsWith('<h1>Review of __runbook__ &lt;img src=x&gt;</h1>'), true);
  assert.equal(rendered.includes('*Priya* &lt;b&gt;x&lt;/b&gt; [a](b) `c`'), true);
});

// validateComments checks an author is well-formed UTF-8 and nothing more, so a
// received review file can carry a newline in one. Escaping inline constructs is
// not enough: a line break puts the rest of the value at the start of a line,
// where `#`, `>`, `-`, a fence or a Setext underline are block constructs no
// inline escape reaches (review dcdede68, defect 2).
test('M16 a newline in an author or package name cannot open a block construct', () => {
  const out = render([thread({source: 'x', state: 'resolved',
    comments: [comment('Priya\n# Injected H1\n\n```\nnot a fence\n```', 'comment', 'body')]})],
    {packageName: 'runbook.mdpkg\n## Injected H2\n\n- injected item'});
  // One heading per level the renderer itself emits: h1 header, h2 path, h3 scope.
  assert.deepEqual(inventory(out).headings.map(heading => heading.split(' ')[0]), ['#', '##', '###']);
  // Exactly the three the renderer wrote; nothing reached the start of a line.
  assert.equal(out.split('\n').filter(line => /^(#|-|\d+\.|={2,}$|-{2,}$)/.test(line)).length, 3);
  const rendered = html(out);
  assert.equal(rendered.includes('Injected H1</h'), false);
  assert.equal(rendered.includes('Injected H2</h'), false);
  assert.equal(rendered.includes('<li>'), false);
  // Folded to one line, not dropped: the value still reads as itself.
  assert.equal(rendered.startsWith('<h1>Review of runbook.mdpkg ## Injected H2 - injected item</h1>'), true);
  assert.equal(rendered.includes('Priya # Injected H1 ```'), true);
});

// A lone carriage return is a CommonMark line ending in its own right, and a
// review file received from a CRLF platform can carry one where the LF was
// stripped. Folding only `\n` leaves it in the output, where the recipient's
// parser still starts a new line and `#` still opens a heading — and every
// other case here stays green, so nothing else pins the `\r` in the fold.
test('M17 a lone carriage return in an author or package name cannot open a block construct', () => {
  const out = render([thread({source: 'x', state: 'resolved',
    comments: [comment('Priya\r# Injected H1', 'comment', 'body')]})],
    {packageName: 'runbook.mdpkg\r## Injected H2'});
  // The value is folded, not merely escaped: no line ending of any kind survives.
  assert.equal(out.includes('\r'), false);
  // One heading per level the renderer itself emits: h1 header, h2 path, h3 scope.
  assert.deepEqual(inventory(out).headings.map(heading => heading.split(' ')[0]), ['#', '##', '###']);
  // Split the way a CommonMark parser does, so a bare `\r` cannot hide a line start.
  assert.equal(out.split(/\r\n|\r|\n/).filter(line => /^(#|-|\d+\.|={2,}$|-{2,}$)/.test(line)).length, 3);
  const rendered = html(out);
  // Nothing the values carry starts a heading of its own; the `##` and `#` they
  // hold stay inline text inside the headings and metadata the renderer wrote.
  assert.equal(/<h[1-6]>Injected/.test(rendered), false);
  // Folded to one line, not dropped: the value still reads as itself.
  assert.equal(rendered.startsWith('<h1>Review of runbook.mdpkg ## Injected H2</h1>'), true);
  assert.equal(rendered.includes('Priya # Injected H1'), true);
});
