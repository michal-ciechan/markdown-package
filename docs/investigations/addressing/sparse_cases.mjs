import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {makeState,hash,resolve,reference,PROFILE,canonicalJson,rangeSummary,touched} from './model.mjs';
import {initial,advance,review,resolveSparse,metadata,inventory,sparseURI,parseSparseURI} from './sparse_model.mjs';
const work='.antiphon/addressing-work',out='docs/investigations/addressing';
const states=JSON.parse(await fs.readFile(`${work}/states.json`,'utf8'));
const old=JSON.parse(await fs.readFile(`${out}/case-results.json`,'utf8'));
const base=states.base,ns=base.namespace,ids=old.ids,copy=x=>structuredClone(x);
const id=label=>{const x=hash(label).slice(0,32);return `${x.slice(0,8)}-${x.slice(8,12)}-${x.slice(12,16)}-${x.slice(16,20)}-${x.slice(20)}`;};
function added(name,documents,tombstones=[]){states[name]=makeState(ns,documents,tombstones);}
let d=copy(base.documents);d[0].source=d[0].source.replace('# Section 1\nAlpha.\n\n## Child\nChild text.','# Completely different\nAll old prose was replaced with a new subject.\n\n## Child\nEntirely new child material.');added('rename-and-total-rewrite',d);
d=copy(base.documents);d[1].path='other/location.md';d[1].source='Completely unrelated replacement prose, but the editor confirms this is the same document.\n';added('file-move-and-rewrite',d);
// Same bytes but declared delete + new entity at the same slot: a digest cannot distinguish intent.
d=copy(base.documents);const newO=id('slot reuse');d[0].sectionIds[d[0].sectionIds.indexOf(ids.O)]=newO;
added('delete-and-recreate-same-slot',d,[{id:ids.O,kind:'section',reason:'deleted',successors:[]}]);
// A one-to-one rename proposal must not collapse a split into continuity.
d=copy(base.documents);const splitA=id('similar splitA'),splitB=id('similar splitB');
d[0].source=d[0].source.replace('# Other\nOther text.','# Other copy\nOther text.\n\n# New fragment\nAdded fragment.');
d[0].sectionIds.splice(d[0].sectionIds.indexOf(ids.O),1,splitA,splitB);
added('similar-split',d,[{id:ids.O,kind:'section',reason:'split',successors:[splitA,splitB]}]);
// Identical-body deletion/addition is semantically different from a move.
d=copy(base.documents);const replacement=id('unrelated same body');
d[0].source=d[0].source.replace('# Other\nOther text.','# Different purpose\nOther text.');d[0].sectionIds[d[0].sectionIds.indexOf(ids.O)]=replacement;
added('delete-and-add-similar',d,[{id:ids.O,kind:'section',reason:'deleted',successors:[]}]);
// Long same-body pair makes -M80 pass despite producer-declared unrelated identity.
d=copy(base.documents);const l0=id('long-old'),l1=id('long-new'),longBody=Array.from({length:20},(_,i)=>`Shared boilerplate paragraph ${i}: documentation details remain identical.`).join('\n');
const longBase=makeState(ns,[{id:id('longdoc'),preambleId:id('longpre'),path:'long.md',source:'# Old\n'+longBody+'\n',sectionIds:[l0]}]);
const longAfter=makeState(ns,[{id:id('longdoc'),preambleId:id('longpre'),path:'long.md',source:'# New\n'+longBody+'\n',sectionIds:[l1]}],[{id:l0,kind:'section',reason:'deleted',successors:[]}]);
const start=initial(base),rows=[],nativeCases=[],counts={comparisons:0,confirmedRegressions:0,naiveWrongIdentity:0,naiveNotFound:0,guardedUnconfirmed:0};
for(const [name,state] of Object.entries(states)){
  const next=advance(start,state,{checkpoint:name});
  for(const entity of Object.keys(base.views)){
    const kind=base.records[entity].k==='document'?'document':'section';
    const expected=resolve(reference(ns,kind,entity,base.views[entity].digest),state).status;
    const ref=review(start,entity),strong=resolveSparse(ref,next.view,next.overrides),naive=resolveSparse(ref,next.view,{}, {naive:true});
    const guarded=resolveSparse(ref,next.view,{}, {guardDuplicates:true});
    assert.equal(strong.status,expected,`${name}:${entity}`);
    if(strong.matchedEntity)assert.equal(strong.matchedEntity,entity,`${name}:identity`);
    counts.comparisons++;
    if(naive.matchedEntity && naive.matchedEntity!==entity)counts.naiveWrongIdentity++;
    if(naive.status==='not-found')counts.naiveNotFound++;
    if(guarded.status==='unconfirmed')counts.guardedUnconfirmed++;
    rows.push({case:name,entity,expected,confirmed:strong.status,naive:naive.status,wrongNaiveIdentity:!!naive.matchedEntity&&naive.matchedEntity!==entity,guarded:guarded.status});
  }
  // Native detector sees source + computed slots, never the hidden producer correspondence.
  nativeCases.push({name,before:base,after:state,beforeInventory:start.view,afterInventory:next.view,
    overrides:Object.keys(next.overrides).length,metadata:metadata(next)});
}
nativeCases.push({name:'long-similar-delete-add',before:longBase,after:longAfter,beforeInventory:inventory(ns,longBase.documents),afterInventory:inventory(ns,longAfter.documents)});
const extra=[];
const check=(name,fn)=>{fn();extra.push(name);};
check('no stored per-section records in default base',()=>assert.deepEqual(metadata(start),{}));
const renamed=advance(start,states['heading-rename'],{checkpoint:'rename'});
check('new review after rename uses same root',()=>assert.equal(review(renamed,ids.S).root,review(start,ids.S).root));
const reverted=advance(renamed,base,{checkpoint:'revert'});
check('revert retains alias for reviews issued at intermediate locator',()=>assert.equal(resolveSparse(review(renamed,ids.S),reverted.view,reverted.overrides).status,'flagged-changed'));
check('old origin-hint review survives revert',()=>assert.equal(resolveSparse(review(start,ids.S),reverted.view,reverted.overrides).status,'survives'));
check('retirement prevents same-slot false review transfer',()=>{
  const next=advance(start,states['delete-and-recreate-same-slot'],{checkpoint:'reuse'});
  assert.notEqual(next.roots[newO],start.roots[ids.O]);assert.equal(resolveSparse(review(start,ids.O),next.view,next.overrides).reason,'deleted');
});
check('missing total-rewrite match is unconfirmed not silently reviewed',()=>assert.equal(resolveSparse(review(start,ids.S),inventory(ns,states['rename-and-total-rewrite'].documents)).status,'unconfirmed'));
const asSummaryState=s=>({namespace:ns,views:Object.fromEntries(Object.entries(s.roots).map(([entity,root])=>[root,s.view.byEntity[entity]])),
  records:Object.fromEntries(Object.entries(s.roots).map(([entity,root])=>[root,{k:s.view.byEntity[entity].kind}]))});
const summary=rangeSummary([start,renamed,reverted].map(asSummaryState),[0,1,2].map(n=>'sha1-'+String(n).repeat(40)));
check('sparse origins preserve edit/revert touched events',()=>assert.deepEqual(summary.changedAt[start.roots[ids.S]],[1,2]));
check('sparse current source survives edit/revert',()=>assert.equal(resolveSparse(review(start,ids.S),reverted.view,reverted.overrides).status,'survives'));
check('sparse summary confirms untouched sibling',()=>assert.equal(touched(summary,start.roots[ids.O]),'no'));
check('sparse URI round trip resolves intermediate review after revert',()=>assert.equal(resolveSparse(parseSparseURI(sparseURI(review(renamed,ids.S))),reverted.view,reverted.overrides).status,'flagged-changed'));
check('duplicate URI selector rejected',()=>assert.throws(()=>parseSparseURI(sparseURI(review(start,ids.S))+'&loc=x'),/invalid-parameter/));
check('locator cannot select a parent directory',()=>assert.throws(()=>parseSparseURI(sparseURI({...review(start,ids.S),locator:['section','../spec.md',[['# Section 1',0]]]})),/invalid-path/));
check('incomplete correspondence cannot bless an equal current locator and digest',()=>assert.equal(resolveSparse(review(start,ids.O),inventory(ns,states['delete-and-recreate-same-slot'].documents),{}, {correspondence:'partial'}).status,'unconfirmed'));
const result={originalModelChecks:old.checks,states:Object.keys(states).length,counts,extraChecks:extra,exampleURI:sparseURI(review(start,ids.S)),
  exceptions:nativeCases.filter(c=>c.metadata).map(c=>({case:c.name,records:c.overrides,rawBytes:Object.values(c.metadata).reduce((n,t)=>n+Buffer.byteLength(t),0)})),rows,failures:0};
await fs.writeFile(`${out}/sparse-case-results.json`,JSON.stringify(result,null,2)+'\n');
await fs.writeFile(`${work}/sparse-native-input.json`,JSON.stringify(nativeCases));
console.log(JSON.stringify({states:result.states,...counts,extraChecks:extra.length,failures:0},null,2));
