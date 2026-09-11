import {test} from 'node:test';
import assert from 'node:assert/strict';
import {outline} from '../src/address/outline.js';
import {makeSelector, scopeOffset} from '../src/review/selector.js';
import {commentInterval} from '../src/ui/comment-anchor.js';
import {encodeLocator} from '../src/address/reference.js';
const model = outline(new TextEncoder().encode('# First\n\nword\n\n## Second\n\n😀 same and same\n'), 'guide.md');
const scope = model.scopes.at(-1), source = model.source(scope);
const loc = encodeLocator(scope.locator);
test('inline intervals preserve exact repeated occurrence and UTF-16 scope offsets', () => {
  const start = source.lastIndexOf('same'), select = makeSelector(source, start, start + 4);
  assert.equal(select.occurrence, 1);
  assert.deepEqual(commentInterval(model, loc, select), {start: scopeOffset(model, scope) + start, end: scopeOffset(model, scope) + start + 4});
});
test('inline intervals refuse changed evidence and a different document', () => {
  const select = makeSelector(source, 0, source.length);
  for (const change of [{quote: 'wrong'}, {occurrence: 8}, {prefix: 'wrong'}, {end: source.length + 1}])
    assert.throws(() => commentInterval(model, loc, {...select, ...change}));
  const foreign = encodeLocator(['section', 'other.md', scope.trail]);
  assert.throws(() => commentInterval(model, foreign, select));
});
