import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Parser} from 'commonmark';
import {markdownParser} from '../src/ui/markdown-parser.js';
import {markdownRenderer} from '../src/ui/markdown-renderer.js';
import {outline} from '../src/address/outline.js';

const render = source => markdownRenderer().render(markdownParser().parse(source));
const tags = html => html.replace(/ data-sourcepos="[^"]*"/g, '');

test('table extension supplies semantic headers, all alignments and inline content', () => {
  const html = tags(render('| Left | Middle | Right | Default |\n| :-- | :-: | --: | -- |\n' +
    '| **Bold** | `code` | [link](guide.md) | *italic* |\n'));
  assert.match(html, /<thead><tr><th align="left" scope="col">Left<\/th><th align="center" scope="col">Middle/);
  assert.match(html, /<th align="right" scope="col">Right<\/th><th scope="col">Default/);
  assert.match(html, /<td align="left"><strong>Bold<\/strong>/);
  assert.match(html, /<td align="center"><code>code<\/code>/);
  assert.match(html, /<td align="right"><a href="guide.md">link<\/a>/);
  assert.match(html, /<td><em>italic<\/em>/);
});

test('GFM optional outer pipes, single hyphens, escaped pipes and uneven rows', () => {
  const html = tags(render('First | Second\n:- | -:\nonly\nextra | kept | discarded\n' +
    'a\\|b | `c\\|d`\n'));
  assert.match(html, /<td align="left">only<\/td><td align="right"><\/td>/);
  assert.match(html, /<td align="left">extra<\/td><td align="right">kept<\/td>/);
  assert.doesNotMatch(html, /discarded/);
  assert.match(html, /a\|b/); assert.match(html, /<code>c\|d<\/code>/);
  assert.match(render('| One |\n| - |\n'), /<thead>/);
  assert.doesNotMatch(render('| One |\n| - |\n'), /<tbody>/);
});

test('invalid delimiters and mismatched header counts remain CommonMark prose', () => {
  for (const source of ['a | b\n---\nx | y\n', 'a | b\n--- | :\n', 'a | b\n--- | x\n',
    'a | b\n--- | --- | ---\n', 'plain\n---\n', '|\n| - |\n']) {
    assert.equal(render(source), markdownRenderer().render(new Parser().parse(source)));
  }
});

test('tables stop at blank lines and new blocks and never parse inside code or HTML', () => {
  for (const block of ['# Next', '> Quote', '- Item', '---', '```\ncode\n```']) {
    const html = render('A | B\n- | -\nx | y\n' + block + '\n');
    assert.equal((html.match(/<td /g) ?? []).length, 2);
    assert.ok(html.indexOf('</table>') < html.indexOf(block === '---' ? '<hr' : block.startsWith('#') ? '<h1' :
      block.startsWith('>') ? '<blockquote' : block.startsWith('-') ? '<ul' : '<pre'));
  }
  assert.match(render('A | B\n- | -\nx | y\n\nafter\n'), /<p[^>]*>after<\/p>/);
  for (const source of ['```\nA | B\n- | -\n```', '    A | B\n    - | -\n', '<div>\nA | B\n- | -\n</div>']) {
    assert.doesNotMatch(render(source), /<table/);
  }
});

test('nested tables respect quote/list containers, source columns, and non-lazy termination', () => {
  for (const source of ['> A | B\n> - | -\n> x | y\noutside\n', '- A | B\n  - | -\n  x | y\noutside\n']) {
    const html = render(source);
    assert.match(html, /<td data-sourcepos="3:3-3:5">x/);
    assert.match(html, /<p data-sourcepos="4:1-4:7">outside/);
  }
});

test('table interrupts prose and resolves reference links defined before and after it', () => {
  const html = render('[before]: /first\nIntro\nA | B\n- | -\n[before] | [after]\n\n[after]: /last\n');
  assert.match(html, /<p[^>]*>Intro<\/p>/);
  assert.match(html, /href="\/first"/); assert.match(html, /href="\/last"/);
  assert.match(html, /<th data-sourcepos="3:1-3:3"/);
});

test('table cells preserve the safe HTML/image/link rendering policy', () => {
  const html = render('| Content |\n| - |\n| <script>alert(1)</script> |\n' +
    '| [bad](javascript:alert%281%29) |\n| ![alt](https://example.com/image.png) |\n' +
    '| &lt;img src=x onerror=alert(1)&gt; |\n');
  assert.doesNotMatch(html, /<script|<img|href="javascript:/);
  assert.match(html, /\[Image: alt\]/);
  assert.match(html, /&lt;img/);
});

test('display extension leaves the mandated CommonMark inventory and source digests intact', async () => {
  const source = '# Outer\n\nA | B\n- | -\ncell | **bold**\n\n## Child\n\nMore\n';
  const model = outline(new TextEncoder().encode(source), 'table.md');
  const inventory = model.scopes.map(scope => ({locator: scope.locator, source: model.source(scope)}));
  const digests = await Promise.all(model.scopes.map(scope => model.digest(scope)));
  render(source);
  assert.deepEqual(model.scopes.map(scope => ({locator: scope.locator, source: model.source(scope)})), inventory);
  assert.deepEqual(await Promise.all(model.scopes.map(scope => model.digest(scope))), digests);
  assert.match(model.source(model.scopes[2]), /cell \| \*\*bold\*\*/);
  assert.doesNotMatch(markdownRenderer().render(model.ast), /<table/);
  // A Setext-looking sequence after a table remains in the CommonMark inventory,
  // even when the display extension renders it as a table followed by a rule.
  const ambiguous = '| A | B |\n| - | - |\nx | y\n---\n';
  assert.equal(outline(new TextEncoder().encode(ambiguous), 'table.md').scopes[2].kind, 'section');
});
