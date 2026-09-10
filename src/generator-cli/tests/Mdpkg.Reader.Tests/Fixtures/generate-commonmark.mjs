// Regenerate from https://spec.commonmark.org/0.31.2/spec.json.
// Requires npm ci in src/web-viewer. The fixture has no runtime Node dependency.
import {readFile, writeFile} from 'node:fs/promises';
import {outline} from '../../../../web-viewer/src/address/outline.js';
import {defaultRoot} from '../../../../web-viewer/src/address/root.js';
const cases = JSON.parse(await readFile(process.argv[2], 'utf8'));
const namespace = 'c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8';
const rows = [];
for (const c of cases) {
  const doc = outline(new TextEncoder().encode(c.markdown), 'spec.md');
  const entities = [];
  for (const scope of doc.scopes) entities.push({locator: scope.locator,
    root: await defaultRoot(namespace, scope.locator), digest: await doc.digest(scope)});
  rows.push({example: c.example, markdown: c.markdown, entities});
}
await writeFile(new URL('./commonmark-0.31.2.json', import.meta.url), '[\n' + rows.map(r => JSON.stringify(r)).join(',\n') + '\n]\n');
console.log(`${rows.length} independent CommonMark inventory cases written`);
