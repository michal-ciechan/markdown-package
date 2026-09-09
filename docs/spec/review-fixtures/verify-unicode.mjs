import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const vector = read('vectors.json');
const canonical = x => JSON.stringify(x) + '\n';
const hash = s => createHash('sha256').update(s, 'utf8').digest('hex');
assert.equal(vector.source.length, vector.utf16SourceLength);
assert.notEqual([...vector.source].length, vector.utf16SourceLength);
assert.equal(vector.source.slice(vector.selector.start, vector.selector.end), vector.selector.quote);
assert.equal(vector.root, hash('mdpkg-default\0cm0312-trail-source-v1\0c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8\0' + canonical(vector.locator)));
assert.equal(vector.expect, hash('mdpkg\0cm0312-source-lf-v1\0section\0' + vector.source));
for (const version of [1, 2]) {
  const thread = read(`comments-v${version}.json`).threads[0];
  assert.equal(thread.loc, Buffer.from(canonical(vector.locator), 'utf8').toString('base64url'));
  assert.deepEqual(thread.select, vector.selector);
  assert.equal(thread.comments[0].kind, version === 1 ? undefined : 'change-request');
}
console.log('JavaScript/Python UTF-16, root, digest, locator and v1/v2 vectors: passed.');
