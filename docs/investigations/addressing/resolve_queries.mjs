import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {resolve,rangeSummary,touched,canonicalJson,hash,parseReference} from './model.mjs';
const work='.antiphon/addressing-work',out='docs/investigations/addressing';
const queries=JSON.parse(await fs.readFile(`${work}/queries.json`,'utf8'));
const rows=[];
for(const q of queries){const r=resolve(q.uri,q.state);assert.equal(r.status,q.expected,q.name);assert.equal(q.git.log_walks,0);rows.push({case:q.name,...r,git:q.git});}
const input=JSON.parse(await fs.readFile(`${work}/range-input.json`,'utf8'));
const summary=rangeSummary(input.states,input.commits);
const bytes=canonicalJson(summary),summaryId=hash(bytes);
const bindings={version:1,ranges:[{summary:'sha256-'+summaryId,emitted:input.emitted}]};
await fs.writeFile(`${work}/range-summary.json`,bytes);
await fs.writeFile(`${work}/range-bindings.json`,canonicalJson(bindings));
const cases=JSON.parse(await fs.readFile(`${out}/case-results.json`,'utf8'));
assert.equal(touched(summary,cases.ids.S),'yes');
assert.equal(summary.endpoints[cases.ids.S].before,summary.endpoints[cases.ids.S].after);
const native=JSON.parse(await fs.readFile(`${out}/native-results.json`,'utf8'));
for(const kind of ['commit','diff','hunk'])assert.equal(parseReference(native.refs[kind]).kind,kind);
await fs.writeFile(`${out}/resolution-results.json`,JSON.stringify({rows,checks:rows.length+5,failures:0,
  summary:{id:summaryId,bytes:Buffer.byteLength(bytes),bindingsBytes:Buffer.byteLength(canonicalJson(bindings)),body:summary}},null,2)+'\n');
console.log(JSON.stringify({nativeResolutions:rows.length,checks:rows.length+5,failures:0,summaryBytes:Buffer.byteLength(bytes),summaryId},null,2));
