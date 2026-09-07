import fs from 'node:fs';
import assert from 'node:assert/strict';
import {Reader,clearParseCache} from './runtime_model.mjs';
import {parsedSource} from './sparse_model.mjs';
const work='.antiphon/addressing-work',out='docs/investigations/addressing';
const input=JSON.parse(fs.readFileSync(`${work}/runtime-input.json`,'utf8')),ns=input.cases[0].namespace;
const rows=[];
for(const n of [1,32,128,512]){
  const c=input.chains[`length-${n}`],a=c.commits[0],b=c.commits[n];
  // Reference's locator and expected digest are external review state, not package metadata.
  const seed=new Reader(c.repo);seed.load([a],ns);const v=Object.values(seed.snapshots.get(a).bySlot).find(v=>v.kind==='section');
  const ref={namespace:ns,locator:v.locator,expect:v.digest};
  for(const method of ['endpoint','walk','bounded64'])for(let repeat=0;repeat<3;repeat++){
    clearParseCache();const reader=new Reader(c.repo),options={method:method==='endpoint'?'endpoint':'walk',maxEdges:method==='bounded64'?64:Infinity};
    const cold=reader.trace(ref,a,b,options),warm=reader.trace(ref,a,b,options);
    assert.equal(cold.status,warm.status);assert.equal(cold.reason,warm.reason);
    if(method==='walk')assert.equal(cold.status,'source-changed');
    if(method==='bounded64'&&n>64)assert.equal(cold.reason,'history-budget-exceeded');
    rows.push({transitions:n,method,repeat,cold,warm});
  }
  console.log(JSON.stringify({transitions:n,completedSamples:rows.length}));
}
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const summary=[];
for(const n of [1,32,128,512])for(const method of ['endpoint','walk','bounded64']){
  const rs=rows.filter(r=>r.transitions===n&&r.method===method);
  summary.push({transitions:n,method,coldMedianMs:median(rs.map(r=>r.cold.ms)),coldRangeMs:[Math.min(...rs.map(r=>r.cold.ms)),Math.max(...rs.map(r=>r.cold.ms))],
    warmMedianMs:median(rs.map(r=>r.warm.ms)),status:rs[0].cold.status,reason:rs[0].cold.reason??null,cost:rs[0].cold.cost,warmCost:rs[0].warm.cost});
}
fs.writeFileSync(`${out}/runtime-timing-results.json`,JSON.stringify({node:process.version,git:input.git,rows,summary,samples:rows.length,checks:rows.length*2,failures:0},null,2)+'\n');
console.log(JSON.stringify({samples:rows.length,checks:rows.length*2,summary,failures:0},null,2));
