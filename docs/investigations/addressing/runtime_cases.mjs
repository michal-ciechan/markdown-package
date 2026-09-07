import fs from 'node:fs';
import assert from 'node:assert/strict';
import {Reader,decodeSource} from './runtime_model.mjs';
import {slot} from './sparse_model.mjs';
const work='.antiphon/addressing-work',out='docs/investigations/addressing';
const input=JSON.parse(fs.readFileSync(`${work}/runtime-input.json`,'utf8'));
const rows=[],rangeRows=[],checks=[];
const check=(name,fn)=>{fn();checks.push(name);};
check('native source adapter rejects invalid UTF-8',()=>assert.throws(()=>decodeSource(Buffer.from([0xff]))));
for(const threshold of [50,80]){
  const reader=new Reader(input.sourceRepo,{threshold});
  for(const c of input.cases)for(const old of Object.values(c.before.byEntity)){
    const ref={namespace:c.namespace,locator:old.locator,expect:old.digest};
    const result=reader.trace(ref,c.a,c.b);
    const actual=result.computedSlot?c.after.bySlot[result.computedSlot]?.entity:null;
    const retained=c.after.byEntity[old.entity];
    const expected=retained?(retained.digest===old.digest?'same-source':'source-changed'):'retired';
    rows.push({case:c.name,threshold,entity:old.entity,kind:old.kind,expected,...result,wrongIdentity:actual!==null&&actual!==old.entity,
      missedContinuity:!!retained&&result.status==='unmatched'});
  }
}
const ns=input.cases[0].namespace,C=input.chains;
function sectionRef(reader,commit){reader.load([commit],ns);const v=Object.values(reader.snapshots.get(commit).bySlot).find(v=>v.kind==='section');return {namespace:ns,locator:v.locator,expect:v.digest};}
for(const threshold of [50,80]){
  const reader=new Reader(C.long.repo,{threshold});
  for(const [from,to] of [[0,32],[0,128],[16,128],[128,256],[256,512]]){
    const a=C.long.commits[from],b=C.long.commits[to],ref=sectionRef(reader,a);
    for(const method of ['endpoint','walk']){
      const r=reader.trace(ref,a,b,{method});rangeRows.push({case:'gradual-renames-and-rewrite',threshold,from,to,method,...r});
      check(`range ${threshold} ${from}-${to} ${method}`,()=>assert.equal(r.status,method==='walk'?'source-changed':'unmatched'));
    }
  }
}
const special=[];
function evaluate(name,chain,from,to,method='walk',sourceChain=chain){
  const reader=new Reader(C[chain].repo),originReader=new Reader(C[sourceChain].repo),a=C[sourceChain].commits[from],b=C[chain].commits[to];
  const ref=sectionRef(originReader,a),r=reader.trace(ref,a,b,{method});special.push({case:name,chain,method,...r});return r;
}
check('endpoint can still match retained boilerplate across many edits',()=>assert.equal(evaluate('shared-tail endpoint','shared-tail',0,32,'endpoint').status,'source-changed'));
check('endpoint hides rename-revert events',()=>assert.equal(evaluate('rename-revert endpoint','rename-revert',0,3,'endpoint').touched,0));
check('walk recovers rename-revert events',()=>assert.equal(evaluate('rename-revert walk','rename-revert',0,3).touched,2));
check('walking deletion prevents later false resurrection',()=>assert.equal(evaluate('delete-recreate walk','delete-recreate',0,3).status,'unmatched'));
check('endpoint conflates deletion and recreation',()=>assert.equal(evaluate('delete-recreate endpoint','delete-recreate',0,3,'endpoint').status,'same-source'));
check('squash has no trace of deleted identity or reverted heading',()=>assert.equal(evaluate('collapsed delete-recreate or rename-revert','net-squash',0,1).touched,0));
check('net squash cannot distinguish two original histories',()=>assert(C['net-squash'].indistinguishable_delete_recreate));
check('squashed gradual changes defeat endpoint similarity',()=>assert.equal(evaluate('gradual sequence squashed','long-squash',0,1).status,'unmatched'));
check('review inside squashed range becomes unavailable',()=>assert.equal(evaluate('interior review lost to squash','long-squash',256,1,'walk','long').reason,'review-commit-unavailable'));
check('review before shallow boundary unavailable',()=>assert.equal(evaluate('old review versus shallow','shallow',0,1,'walk','long').reason,'review-commit-unavailable'));
check('retained shallow range still resolves',()=>assert.equal(evaluate('retained shallow range','shallow',0,1).status,'source-changed'));
check('synthetic-root removes review endpoint',()=>assert.equal(evaluate('old review versus synthetic root','synthetic-root',0,0,'walk','long').reason,'review-commit-unavailable'));
{
  const reader=new Reader(input.sourceRepo),a=C['other-branch'].commits[1],b=C.long.commits[128],ref=sectionRef(reader,a),r=reader.trace(ref,a,b);special.push({case:'non-ancestor review',...r});
  check('arbitrary OIDs are not always a first-parent review path',()=>assert.equal(r.reason,'not-on-retained-first-parent-path'));
}
const totals=[50,80].map(threshold=>{const rs=rows.filter(r=>r.threshold===threshold);return {threshold,queries:rs.length,wrongIdentity:rs.filter(r=>r.wrongIdentity).length,
  missedContinuity:rs.filter(r=>r.missedContinuity).length,unmatched:rs.filter(r=>r.status==='unmatched').length};});
fs.writeFileSync(`${out}/runtime-case-results.json`,JSON.stringify({totals,rows,rangeRows,special,checks:checks.length,checkNames:checks,failures:0},null,2)+'\n');
console.log(JSON.stringify({totals,rangeChecks:checks.length,failures:0},null,2));
