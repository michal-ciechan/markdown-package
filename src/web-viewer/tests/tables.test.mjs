import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Parser} from 'commonmark';
import {markdownParser} from '../src/ui/markdown-parser.js';
import {markdownRenderer} from '../src/ui/markdown-renderer.js';
import {outline} from '../src/address/outline.js';

const render = source => markdownRenderer().render(markdownParser().parse(source));
const tags = html => html.replace(/ data-sourcepos="[^"]*"/g, '');

// Expected behavior checked against cmark-gfm (cmarkgfm 2025.10.22) and
// https://github.github.com/gfm/#tables-extension- (examples 198–205).
test('tables terminate before indented code, all list starts, HTML and invalid rows', () => {
  const table = '| A | B |\n| --- | --- |\n';
  for (const following of ['    x | y | lost\n', '\tx | y | lost\n', '2. item\n', '-\n',
    '+\n', '*\n', '2) item\n', '<custom>\n', '|\n']) {
    assert.equal(tags(render(table + following)), tags(render(table)) +
      tags(markdownRenderer().render(new Parser().parse(following))), following);
  }
  // An unpiped text row and a row with empty cells are valid continuations.
  assert.match(tags(render(table + 'text\n||\n')), /<td>text<\/td><td><\/td><\/tr><tr><td><\/td><td><\/td>/);
});

test('escaped pipes preserve columns regardless of backslash parity, including code spans', () => {
  for (const count of [1, 2, 3, 4]) {
    const escapes = '\\'.repeat(count);
    for (const code of [false, true]) {
      const raw = `a${escapes}|b`;
      const value = code ? '`' + raw + '`' : raw;
      const source = `| ${value} | c |\n| --- | --- |\n| ${value} | c |\n`;
      const expected = code ? `<code>a${'\\'.repeat(count - 1)}|b</code>` :
        `a${'\\'.repeat(Math.floor((count - 1) / 2))}|b`;
      const html = tags(render(source));
      assert.ok(html.includes(`<th scope="col">${expected}</th><th scope="col">c</th>`), source);
      assert.ok(html.includes(`<td>${expected}</td><td>c</td>`), source);
      // Source endpoints still describe the raw cell, before unescaping.
      assert.ok(render(source).includes(`data-sourcepos="3:2-3:${value.length + 4}"`));
    }
  }
  // Backticks alone do not protect pipes in GFM's block-level tokenizer.
  assert.match(tags(render('| A | B |\n| --- | --- |\n| `a|b` | c |\n')),
    /<td>`a<\/td><td>b`<\/td>/);
});

test('delimiter syntax establishes one-column tables with unpiped headers and bodies', () => {
  for (const delimiter of ['|---|', '---|', '|---', ':---', '---:', ':-:']) {
    const html = tags(render(`foo\n${delimiter}\nbar\n`));
    assert.match(html, /<th(?: align="[^"]*")? scope="col">foo<\/th>/);
    assert.match(html, /<td(?: align="[^"]*")?>bar<\/td>/);
  }
  for (const header of ['foo', '| foo |']) {
    const source = `${header}\n---\nbar\n`;
    assert.equal(render(source), markdownRenderer().render(new Parser().parse(source)));
  }
});

test('list syntax takes precedence over ambiguous table delimiters', () => {
  for (const delimiter of ['- | -', '- | ---', '-\t| -', '  - | -']) {
    const source = `A | B\n${delimiter}\nx | y\n`;
    assert.equal(render(source), markdownRenderer().render(new Parser().parse(source)));
    assert.match(render(source), /<ul/);
    assert.doesNotMatch(render(source), /<table/);
  }
  for (const delimiter of ['-- | -', '-| -', '| - | -', ':- | -']) {
    assert.match(render(`A | B\n${delimiter}\nx | y\n`), /<table/);
  }
});

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
    const html = render('A | B\n-- | --\nx | y\n' + block + '\n');
    assert.equal((html.match(/<td /g) ?? []).length, 2);
    assert.ok(html.indexOf('</table>') < html.indexOf(block === '---' ? '<hr' : block.startsWith('#') ? '<h1' :
      block.startsWith('>') ? '<blockquote' : block.startsWith('-') ? '<ul' : '<pre'));
  }
  assert.match(render('A | B\n-- | --\nx | y\n\nafter\n'), /<p[^>]*>after<\/p>/);
  for (const source of ['```\nA | B\n-- | --\n```', '    A | B\n    -- | --\n', '<div>\nA | B\n-- | --\n</div>']) {
    assert.doesNotMatch(render(source), /<table/);
  }
});

test('nested tables respect quote/list containers, source columns, and non-lazy termination', () => {
  for (const source of ['> A | B\n> -- | --\n> x | y\noutside\n', '- A | B\n  -- | --\n  x | y\noutside\n']) {
    const html = render(source);
    assert.match(html, /<td data-sourcepos="3:3-3:5">x/);
    assert.match(html, /<p data-sourcepos="4:1-4:7">outside/);
  }
});

test('table interrupts prose and resolves reference links defined before and after it', () => {
  const html = render('[before]: /first\nIntro\nA | B\n-- | --\n[before] | [after]\n\n[after]: /last\n');
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
  const source = '# Outer\n\nA | B\n-- | --\ncell | **bold**\n\n## Child\n\nMore\n';
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
