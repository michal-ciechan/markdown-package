import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wordBounds, sentenceBounds} from '../src/ui/selection-boundaries.js';

test('word bounds include Unicode, combining marks, contractions and hyphens', () => {
  const text = "😀 café don't re-enter naïve 𐐀word";
  for (const word of ['café', "don't", 're-enter', 'naïve', '𐐀word']) {
    const start = text.indexOf(word);
    for (let offset = start; offset < start + word.length; offset++) {
      assert.deepEqual(wordBounds(text, offset), {start, end: start + word.length});
    }
  }
  assert.equal(wordBounds(text, 0), undefined);
  assert.equal(wordBounds(text, 2), undefined);
  assert.equal(wordBounds('word, next', 4), undefined);
});

test('sentences retain punctuation and closing quotes and trim boundary whitespace', () => {
  const text = '  First sentence. “Second one!”\nThird?  Last without punctuation  ';
  for (const sentence of ['First sentence.', '“Second one!”', 'Third?', 'Last without punctuation']) {
    const start = text.indexOf(sentence);
    assert.deepEqual(sentenceBounds(text, start + 2), {start, end: start + sentence.length});
  }
});

test('common abbreviations, initials and decimal numbers stay in their sentence', () => {
  const sentence = 'Dr. A. Smith uses e.g. 3.14 and i.e. examples in the U.S. office.';
  const text = sentence + ' Another sentence.';
  for (const needle of ['Smith', '3.14', 'examples', 'office']) {
    assert.deepEqual(sentenceBounds(text, text.indexOf(needle)), {start: 0, end: sentence.length});
  }
  assert.deepEqual(sentenceBounds(text, text.indexOf('Another')), {start: sentence.length + 1, end: text.length});
});

test('a manual range spanning sentences expands outward to both boundaries', () => {
  const text = 'First sentence. Second sentence! Third sentence.';
  assert.deepEqual(sentenceBounds(text, 5, text.indexOf('!')), {start: 0, end: text.indexOf('!') + 1});
  assert.equal(sentenceBounds('', 0), undefined);
});
