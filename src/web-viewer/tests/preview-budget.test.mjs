import test from 'node:test';
import assert from 'node:assert/strict';
import {outline} from '../src/address/outline.js';
import {displayFor, fragmentScope} from '../src/links/display.js';
import {previewMarkup, PREVIEW_UNITS} from '../src/ui/markdown-surface.js';
import {markdownRenderer} from '../src/ui/markdown-renderer.js';
import {renderPreviewBlock, PREVIEW_HTML_UNITS} from '../src/ui/preview-renderer.js';

const model = text => outline(new TextEncoder().encode(text), 'a.md');

test('reference definitions outside the scope cannot multiply preview HTML beyond its budget', () => {
  const text = '# Target\n\n' + '[x][r] '.repeat(100) +
    '\n\n# Outside\n\n[r]: https://example.com/' + 'a'.repeat(20000) + '\n';
  const doc = model(text), preview = previewMarkup(doc, doc.scopes[2]);
  assert.ok(text.length < 2 * 1024 * 1024);
  assert.equal(preview.excerpt, true);
  assert.ok(preview.html.length <= 64 * 1024);
  assert.match(preview.html, /Target/);
  assert.doesNotMatch(preview.html, /<a /); // Reject the overflowing paragraph as a whole.
});

test('a small first block with an oversized expanded attribute uses a labelled source excerpt', () => {
  const doc = model('[x][r]\n\n[r]: https://example.com/' + 'a'.repeat(70000) + '\n');
  const preview = previewMarkup(doc, doc.scopes[0]);
  assert.equal(preview.fallback, true);
  assert.equal(preview.excerpt, true);
  assert.ok(preview.source.length <= PREVIEW_UNITS);
});

test('HTML escaping of a reference title is bounded even below the source-content cap', () => {
  const doc = model('[x][r]\n\n[r]: other.md "' + '&'.repeat(15000) + '"\n');
  assert.ok(doc.text.length < PREVIEW_UNITS);
  const preview = previewMarkup(doc, doc.scopes[0]);
  assert.equal(preview.fallback, true);
  assert.equal(preview.excerpt, true);
  assert.ok(preview.source.length <= PREVIEW_UNITS);
});

test('rendering stops during expansion, before visiting the remaining reference links', () => {
  const doc = model('[x][r] '.repeat(100) + '\n\n[r]: https://example.com/' + 'a'.repeat(20000) + '\n');
  const paragraph = displayFor(doc).ast.firstChild;
  let destinationsRead = 0;
  for (let node = paragraph.firstChild; node; node = node.next) {
    if (node.type !== 'link') continue;
    const destination = node.destination;
    Object.defineProperty(node, 'destination', {get() {
      if (++destinationsRead > 8) throw new Error('Renderer continued after exhausting its HTML budget');
      return destination;
    }});
  }
  assert.equal(renderPreviewBlock(paragraph, PREVIEW_HTML_UNITS, PREVIEW_UNITS), undefined);
  assert.equal(destinationsRead, 8); // Three complete links; fourth rejected before tag output.
});

test('the HTML budget is shared across blocks, not reset for every paragraph', () => {
  const doc = model('[x][r]\n\n'.repeat(100) + '[r]: https://example.com/' + 'a'.repeat(20000) + '\n');
  const preview = previewMarkup(doc, doc.scopes[0]);
  assert.equal(preview.excerpt, true);
  assert.equal((preview.html.match(/<a /g) ?? []).length, 3);
  assert.ok(preview.html.length <= PREVIEW_HTML_UNITS);
});

test('image placeholders count toward visible content even when their source fits', () => {
  const doc = model('![](x)'.repeat(2000));
  assert.ok(doc.text.length < PREVIEW_UNITS);
  const preview = previewMarkup(doc, doc.scopes[0]);
  assert.equal(preview.fallback, true);
  assert.equal(preview.excerpt, true);
  assert.ok(preview.source.length <= PREVIEW_UNITS);
});

test('expanded visible content is budgeted across whole blocks', () => {
  const doc = model(('![](x)'.repeat(1000) + '\n\n').repeat(2));
  const preview = previewMarkup(doc, doc.scopes[0]);
  assert.equal(preview.excerpt, true);
  assert.equal((preview.html.match(/\[Image: \]/g) ?? []).length, 1000);
  assert.ok(preview.html.replace(/<[^>]*>/g, '').length <= PREVIEW_UNITS);
});

test('a heading matching its own legacy alias remains one candidate', () => {
  const doc = model('# mdpkg-section-2\n');
  assert.equal(displayFor(doc).fragments.get('mdpkg-section-2').length, 1);
  assert.equal(fragmentScope(doc, 'mdpkg-section-2').scope, doc.scopes[2]);
});

test('a slug matching a different heading legacy alias remains ambiguous', () => {
  const doc = model('# Other\n\n# mdpkg-section-2\n');
  assert.equal(displayFor(doc).fragments.get('mdpkg-section-2').length, 2);
  assert.equal(fragmentScope(doc, 'mdpkg-section-2').reason, 'choose-section');
});

test('within-budget rich output keeps the existing safe renderer bytes', () => {
  const doc = model('# Heading\n\n[A & B][r] ![alt](x) <b>literal</b>\n\n' +
    '> quote **bold**\n\n- list\n\n```js\nlet x = "<&>";\n```\n\n' +
    '| Heading |\n| --- |\n| [link][r] |\n\n[r]: other.md "A & B"\n');
  const preview = previewMarkup(doc, doc.scopes[0]);
  assert.equal(preview.excerpt, false);
  assert.equal(preview.html, markdownRenderer().render(displayFor(doc).ast));
});
