import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {outline} from '../src/address/outline.js';
import {utf8, ANCHOR, DIGEST} from '../src/format.js';
import {resolveDestination} from '../src/links/resolve.js';
import {destination, markdownLink} from '../src/links/destination.js';
import {displayFor, fragmentScope} from '../src/links/display.js';
import {previewMarkup, boundedSource} from '../src/ui/markdown-surface.js';
import {parseReference} from '../src/address/reference.js';
import {markdownParser} from '../src/ui/markdown-parser.js';
import {referenceFor} from '../src/address/resolve.js';
import {openPackage} from '../src/inbound/open.js';
import {writePackage} from '../src/container/writer.js';

const fixture = JSON.parse(await fs.readFile(new URL('../../../docs/spec/link-fixtures.json', import.meta.url)));
for (const c of fixture.cases) test('shared loose URI: ' + c.name, async () => {
  const pkg = {manifest: {namespace: fixture.namespace, current: fixture.current,
    addressing: {anchor: ANCHOR, digest: DIGEST, coverage: c.coverage}},
    documents: Object.keys(c.documents).map(name => ({name})),
    ledger: async () => new Map(Object.entries(c.ledger)),
    document: async name => outline(utf8.encode(c.documents[name]), name)};
  const result = await resolveDestination(pkg, 'guide.md', c.uri);
  assert.equal(result.category, c.category); assert.equal(result.status ?? null, c.status);
  assert.equal(result.reason ?? (result.scope ? 'current-location' : 'target-not-found'), c.reason);
  assert.deepEqual(result.scope?.locator ?? null, c.live);
  if (c.name === 'reserved-birth') assert.equal((await referenceFor(pkg, result.document, result.scope)), c.uri);
});
for (const c of fixture.destinations) test('destination: ' + c.href, () => {
  if (c.invalid) assert.throws(() => destination(c.source, c.href));
  else assert.deepEqual(destination(c.source, c.href), {kind: 'location', path: c.path, fragment: c.fragment});
});
const model = text => outline(utf8.encode(text), 'a.md');
test('fragment multimap keeps collisions, empty bases and nested headings ineligible', () => {
  const doc = model('# Foo\n# Foo\n# Foo-1\n# 😀\n> # Nested\n\nMulti\nline *Été*\n---\n');
  assert.equal(fragmentScope(doc, 'foo-1').reason, 'choose-section');
  assert.equal(fragmentScope(doc, 'nested').reason, 'choose-section');
  assert.equal(fragmentScope(doc, '').reason, 'choose-section');
  assert.equal(fragmentScope(doc, 'Foo').reason, 'target-not-found');
  assert.equal(fragmentScope(doc, 'multi-line-été').scope.title, 'Multi\nline *Été*\n---');
  assert.equal(fragmentScope(doc, 'mdpkg-section-2').scope.title, '# Foo');
});
test('rich preview keeps full-document definitions and canonical descendant boundaries', () => {
  const doc = model('# Parent\n\n[reference][outside]\n\n## Child\n\n| Link |\n| --- |\n| [outside][] |\n\n# Next\n\n[outside]: other.md#target "Title"\n');
  const result = previewMarkup(doc, doc.scopes[2]);
  assert.match(result.html, /href="other.md#target"/); assert.match(result.html, /<table/);
  assert.match(result.html, /Child/); assert.doesNotMatch(result.html, /Next/);
});
test('source fallback covers GFM boundary disagreement and bounded Unicode excerpts', () => {
  const disagreement = model('| A | B |\n| - | - |\nx | y\n---\n');
  assert.equal(previewMarkup(disagreement, disagreement.scopes[2]).fallback, true);
  const doc = model('lead\nA | B\n-- | --\nx | y\n');
  // The display table divides a CommonMark paragraph; an arbitrary canonical
  // boundary through it must never leak adjacent content.
  assert.equal(previewMarkup(doc, {...doc.scopes[0], start: 2}).fallback, true);
  const huge = model('x'.repeat(15999) + '😀' + 'z'.repeat(200));
  const preview = previewMarkup(huge, huge.scopes[0]);
  assert.equal(preview.excerpt, true); assert.equal(preview.source.length, 15999);
  assert.equal(boundedSource('a😀b', 2), 'a');
});
test('copied labels round trip without adding Markdown nodes or URI parameters', () => {
  const label = 'A [link](x) ![image] <script> *bold* `code` \\ &amp; 😀';
  const text = markdownLink(label, fixture.cases[0].uri), ast = markdownParser().parse(text);
  const link = ast.firstChild.firstChild; assert.equal(link.type, 'link');
  let literal = ''; for (let node = link.firstChild; node; node = node.next) { assert.equal(node.type, 'text'); literal += node.literal; }
  assert.equal(literal, label); assert.equal(link.next, null);
  assert.deepEqual(parseReference(link.destination), parseReference(fixture.cases[0].uri));
});
test('navigation does not consult ledger or compute identity and resource errors stay separate', async () => {
  const doc = model('# Target\n');
  const pkg = {documents: [{name: 'a.md'}], document: async () => doc,
    ledger() { throw Error('must not read'); }};
  const result = await resolveDestination(pkg, 'a.md', '#target');
  assert.equal(result.category, 'navigation'); assert.equal(result.status, undefined); assert.equal(result.root, undefined);
  const failed = await resolveDestination(pkg, 'a.md', '#target', async () => { throw Error('read failed'); });
  assert.equal(failed.category, 'resource'); assert.equal(failed.status, undefined);
});

test('preview reads enforce metadata and decoded caps, deduplicate and read zero Git bytes', async t => {
  const original = await openPackage(new Blob([await fs.readFile(new URL('../../../docs/spec/review-fixtures/original-git.mdpkg', import.meta.url))]));
  const entries = await Promise.all(original.entries.map(async e => ({name: e.name, bytes: await original.read(e.name), stored: e.method === 0})));
  entries.splice(1, 0, {name: 'target.md', bytes: utf8.encode('# Target\n\nContent.\n')},
    {name: 'other.bin', bytes: new Uint8Array([0, 1, 2])},
    {name: 'large.md', bytes: utf8.encode('x'.repeat(2 * 1024 * 1024 + 1))},
    {name: 'large-stored.md', bytes: utf8.encode('x'.repeat(2 * 1024 * 1024 + 1)), stored: true});
  const bytes = await writePackage(entries), reads = [];
  // Observe the native Blob captures rather than overriding the caller Blob's
  // methods (which verification must not trust). Skip the metadata-only capture.
  const slice = Blob.prototype.slice;
  Blob.prototype.slice = function(start, end) { if (start !== undefined) reads.push([start, end]); return slice.call(this, start, end); };
  t.after(() => { Blob.prototype.slice = slice; });
  const pkg = await openPackage(new Blob([bytes]));
  assert.ok(pkg.entries.some(e => e.name.startsWith('.git/')));
  await pkg.document('guide.md'); reads.length = 0;
  const first = pkg.previewDocument('target.md'); assert.equal(first, pkg.previewDocument('target.md'));
  const doc = await first; assert.equal(await pkg.previewDocument('target.md'), doc);
  const after = reads.length; assert.ok(after > 0);
  for (const name of ['large.md', 'large-stored.md']) {
    const result = await resolveDestination(pkg, 'guide.md', name, name => pkg.previewDocument(name));
    assert.equal(result.category, 'resource'); assert.equal(result.reason, 'document-too-large');
  }
  assert.equal(reads.length, after);
  const binary = outline(utf8.encode(''), 'other.bin');
  const binaryUri = await referenceFor(pkg, binary, binary.scopes[0]);
  const unsupported = await resolveDestination(pkg, 'guide.md', binaryUri, name => pkg.previewDocument(name));
  assert.equal(unsupported.category, 'capability'); assert.equal(unsupported.reason, 'unsupported-target');
  assert.equal(reads.length, after);
  for (const entry of pkg.entries.filter(e => e.name.startsWith('.git/'))) {
    assert.equal(reads.some(([start, end]) => start < entry.extentEnd && end > entry.localHeaderOffset), false);
  }
  // A malicious DEFLATE entry understates its decoded size: the inflater must
  // stop at the directory bound, rather than allocating its full expansion.
  const corrupt = bytes.slice(), view = new DataView(corrupt.buffer);
  for (let p = pkg.end.offset; p < pkg.end.offset + pkg.end.size;) {
    const length = view.getUint16(p + 28, true), name = new TextDecoder().decode(corrupt.subarray(p + 46, p + 46 + length));
    if (name === 'large.md') view.setUint32(p + 24, 1000, true);
    p += 46 + length + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  const forged = await openPackage(new Blob([corrupt]));
  const result = await resolveDestination(forged, 'guide.md', 'large.md', name => forged.previewDocument(name));
  assert.equal(result.category, 'resource'); assert.equal(result.reason, 'read-failed'); assert.equal(result.scope, undefined);
});
