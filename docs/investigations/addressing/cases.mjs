import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PROFILE,hash,canonicalJson,makeState,reference,resolve,sections,rangeSummary,touched,parseReference} from './model.mjs';
const ROOT=path.resolve('.'),WORK=path.join(ROOT,'.antiphon/addressing-work');
await fs.mkdir(WORK,{recursive:true});
// Deterministic test UUIDs, deliberately independent of document text or path.
// Production IDs are allocated once, never recomputed from these fixture labels.
const id=name=>{const b=createHash('sha256').update('CARD-0004 fixture '+name).digest();b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const x=b.toString('hex').slice(0,32);return `${x.slice(0,8)}-${x.slice(8,12)}-${x.slice(12,16)}-${x.slice(16,20)}-${x.slice(20)}`;};
const ns=id('lineage'),D=id('spec-doc'),N=id('notes-doc'),P=id('spec-preamble'),NP=id('notes-preamble');
const S=id('section-one'),C=id('child'),O=id('other'),R1=id('repeat-one'),R2=id('repeat-two');
const node=(sid,level,title,body,children=[])=>({id:sid,level,title,body,children});
const section=node(S,1,'Section 1','Alpha.',[node(C,2,'Child','Child text.')]);
const other=node(O,1,'Other','Other text.');
const repeated=[node(R1,1,'Repeat','Same.'),node(R2,1,'Repeat','Same.')];
const baseModel=[{id:D,path:'spec.md',preambleId:P,preamble:'Intro.',nodes:[section,other,...repeated]},
                 {id:N,path:'notes.md',preambleId:NP,preamble:'Headingless notes.',nodes:[]}];
const copy=x=>structuredClone(x);
function docs(model){return model.map(d=>{
  const ids=[];let text=d.preamble?d.preamble+'\n\n':'';
  function render(n){ids.push(n.id);text+='#'.repeat(n.level)+' '+n.title+'\n'+n.body+'\n\n';for(const c of n.children)render(c);}
  d.nodes.forEach(render);return {id:d.id,path:d.path,preambleId:d.preambleId,source:text,sectionIds:ids};
});}
const base=makeState(ns,docs(baseModel)),stateNames={},checks=[];
function check(name,fn){fn();checks.push(name);}
function state(name,model,tombstones=[]){const s=makeState(ns,docs(model),tombstones);stateNames[name]=s;return s;}
stateNames.base=base;
const ref=(sid,kind='section',s=base)=>reference(ns,kind,sid,s.views[sid].digest);
function expect(name,sid,s,status,kind='section'){
  const result=resolve(ref(sid,kind),s);check(name,()=>assert.equal(result.status,status));return result;
}
const outcomes=[];
function outcome(name,sid,s,status,kind='section'){
  const r=expect(name,sid,s,status,kind);outcomes.push({case:name,status:r.status,reason:r.reason,id:sid,
    beforeDigest:base.views[sid].digest,afterDigest:r.actualDigest??null,path:r.path??null,successors:r.successors??[]});
}
let m=copy(baseModel);m[0].nodes.unshift(node(id('inserted'),1,'Inserted','Earlier content.'));m[0].nodes[2].body='Unrelated changes after Section 1.';
const unrelated=state('unrelated',m);outcome('edits before and after Section 1',S,unrelated,'survives');expect('whole document detects unrelated edit',D,unrelated,'flagged-changed','document');
m=copy(baseModel);m[0].nodes[0].title='Renamed section';const renamed=state('heading-rename',m);outcome('heading rename retains ID and flags change',S,renamed,'flagged-changed');
check('heading trail fails rename',()=>assert(!renamed.documents[0].source.includes('# Section 1\n')));
m=copy(baseModel);m[0].nodes.splice(2,0,node(id('repeat-new'),1,'Repeat','Same.'));const dup=state('duplicate-insert',m);outcome('insert indistinguishable repeated heading',R2,dup,'survives');
check('ordinal selector silently chooses another duplicate',()=>{
  assert.equal(base.documents[0].sectionIds.filter(x=>[R1,R2].includes(x))[1],R2);
  assert.equal(dup.documents[0].sectionIds[4],R1);assert.notEqual(dup.documents[0].sectionIds[4],R2);
});
m=copy(baseModel);m[0].nodes.push(m[0].nodes.shift());const moved=state('move-within',m);outcome('move whole subtree within document',S,moved,'survives');
m=copy(baseModel);m[1].nodes.push(m[0].nodes.shift());const cross=state('move-across',m);outcome('move subtree to another document',S,cross,'survives');
expect('old document detects section removal',D,cross,'flagged-changed','document');
m=copy(baseModel);m[0].path='folder/renamed.md';const fileRename=state('file-rename',m);outcome('file rename preserves document review',D,fileRename,'survives','document');expect('file rename preserves section review',S,fileRename,'survives');
m=copy(baseModel);m[0].nodes[0].children[0].body='Edited child.';const child=state('child-edit',m);outcome('child edit invalidates parent review',S,child,'flagged-changed');expect('child itself changes',C,child,'flagged-changed');expect('sibling remains reviewed',O,child,'survives');
m=copy(baseModel);const promoted=m[0].nodes[0].children.pop();promoted.level=1;m[1].nodes.push(promoted);const promotion=state('promote-child',m);outcome('promotion changes heading markup',C,promotion,'flagged-changed');
m=copy(baseModel);const splitIds=[id('split-left'),id('split-right')];m[0].nodes.splice(1,1,node(splitIds[0],1,'Left','Part one.'),node(splitIds[1],1,'Right','Part two.'));
const split=state('split',m,[{id:O,kind:'section',reason:'split',successors:splitIds}]);outcome('split returns retired identity and two successors',O,split,'flagged-changed');
check('split successors receive no original review',()=>assert(splitIds.every(x=>x!==O)));
m=copy(baseModel);const mergeId=id('merged');m[0].nodes.splice(2,2,node(mergeId,1,'Combined','Same. Same.'));
const merged=state('merge',m,[R1,R2].map(x=>({id:x,kind:'section',reason:'merged',successors:[mergeId]})));outcome('merge retires both original identities',R1,merged,'flagged-changed');expect('second merged identity resolves tombstone',R2,merged,'flagged-changed');
m=copy(baseModel);m[0].nodes.splice(1,1);const deleted=state('delete',m,[{id:O,kind:'section',reason:'deleted'}]);outcome('deletion is explicit rather than missing ID',O,deleted,'flagged-changed');
m=copy(baseModel);m[1].nodes.push(node(id('notes-heading'),1,'New heading','New content.'));const firstHeading=state('first-heading',m);outcome('headingless preamble survives first appended heading',NP,firstHeading,'survives');expect('whole headingless document detects new heading',N,firstHeading,'flagged-changed','document');
m=copy(baseModel);m[0].preamble='Changed introduction.';const preamble=state('preamble-edit',m);outcome('content before first heading changes preamble digest',P,preamble,'flagged-changed');expect('preamble edit does not change Section 1',S,preamble,'survives');
let dd=docs(baseModel);dd[0].source=dd[0].source.replaceAll('\n','\r\n');const crlf=makeState(ns,dd);stateNames.crlf=crlf;outcome('CRLF repackaging leaves normalized content unchanged',S,crlf,'survives');
dd=docs(baseModel);dd[0].source=dd[0].source.replace('\n# Other','\n\n\n# Other');const blanks=makeState(ns,dd);stateNames['separator-blanks']=blanks;outcome('boundary separator blank lines are ignored',S,blanks,'survives');
// Parser boundaries: fences, Setext, nested block headings, and non-ASCII source.
const awkward='Preamble.\n\n```md\n# Fake\n```\n\nSetext title\n============\nContent.\n\n> # Quoted\n\n- # Listed\n\n# Real\nCaf\u00e9.\n';
const parsed=sections(Buffer.from(awkward));
check('CommonMark top-level headings exclude fence quote and list',()=>assert.deepEqual(parsed.sections.slice(1).map(s=>s.level),[1,1]));
check('Setext heading text and underline included',()=>assert(parsed.sections[1].source.startsWith('Setext title\n============\n')));
check('Unicode is not normalized invisibly',()=>assert.notEqual(sections(Buffer.from('# Caf\u00e9\n')).sections[1].digest,sections(Buffer.from('# Cafe\u0301\n')).sections[1].digest));
check('invalid UTF-8 rejected',()=>assert.throws(()=>sections(Buffer.from([0xff]))));
check('duplicate producer IDs rejected',()=>{const d=docs(baseModel);d[0].sectionIds[4]=d[0].sectionIds[3];assert.throws(()=>makeState(ns,d),/duplicate-id/);});
check('missing heading assignment rejected',()=>{const d=docs(baseModel);d[0].sectionIds.pop();assert.throws(()=>makeState(ns,d),/heading-id-count/);});
check('duplicate document paths rejected',()=>{const d=docs(baseModel);d[1].path=d[0].path;assert.throws(()=>makeState(ns,d),/duplicate-path/);});
check('namespace separation enforced',()=>assert.equal(resolve(reference(id('other-lineage'),'section',S,base.views[S].digest),base).reason,'wrong-lineage'));
check('missing object under truncation is unavailable',()=>assert.equal(resolve(ref(S),base,{available:false}).reason,'content-not-shipped'));
check('partial entity coverage is not a deletion',()=>{const s=copy(base);delete s.records[S];assert.equal(resolve(ref(S),s,{entityCoverage:'partial'}).reason,'outside-entity-coverage');});
check('bad line locator rejected',()=>{const s=copy(base);s.records[S].line+=1;assert.equal(resolve(ref(S),s).reason,'invalid-heading-locator');});
check('metadata bound to exact Git blob',()=>{const s=copy(base);s.documents[0].source+='extra';assert.equal(resolve(ref(S),s).reason,'blob-binding-mismatch');});
check('cached digest cannot bless changed content',()=>{const s=copy(renamed);s.records[S].digest=base.views[S].digest;const r=resolve(ref(S),s);assert.equal(r.status,'flagged-changed');assert.equal(r.cacheValid,false);});
check('reference round trip',()=>assert.equal(parseReference(ref(S)).id,S));
check('unknown URI parameter cannot overwrite identity',()=>assert.throws(()=>parseReference(ref(S)+'&id='+O),/unknown-parameter/));
check('duplicate URI parameters rejected',()=>assert.throws(()=>parseReference(ref(S)+'&expect=x'),/duplicate-parameter/));
check('profile upgrade requires new review interpretation',()=>assert.equal(resolve(ref(S).replace(PROFILE,'future-profile'),base).reason,'unsupported-profile'));
// Source-scope review intentionally excludes rendering dependencies elsewhere.
const dependencyBefore='# A\n[link][ref]\n\n# B\n[ref]: /old\n',dependencyAfter=dependencyBefore.replace('/old','/new');
check('source profile does not claim external link-definition review',()=>assert.equal(sections(Buffer.from(dependencyBefore)).sections[1].digest,sections(Buffer.from(dependencyAfter)).sections[1].digest));
// A reviewed section changes and reverts: endpoint match and touched evidence differ.
const c0='sha1-'+'0'.repeat(40),c1='sha1-'+'1'.repeat(40),c2='sha1-'+'2'.repeat(40);
const revertedSummary=rangeSummary([base,renamed,base],[c0,c1,c2]);
check('reverted content is reviewed by current-state policy',()=>assert.equal(resolve(ref(S),base).status,'survives'));
check('range summary preserves reverted heading edit',()=>assert.equal(touched(revertedSummary,S),'yes'));
check('range endpoint digests alone miss reverted edit',()=>assert.equal(revertedSummary.endpoints[S].before,revertedSummary.endpoints[S].after));
check('event ordinals answer inside a collapsed range',()=>assert.equal(touched(revertedSummary,S,{from:1,to:2}),'yes'));
check('complete untouched evidence answers a subrange',()=>assert.equal(touched(revertedSummary,O,{from:1,to:2}),'no'));
check('missing range coverage cannot mean unchanged',()=>assert.equal(touched({...revertedSummary,coverage:'partial'},O),'unknown'));
const aggregate='sha1-'+'a'.repeat(40),later='sha1-'+'3'.repeat(40);
const nested=rangeSummary([base,base,unrelated],[c0,aggregate,later],{nested:[{summary:revertedSummary,emitted:aggregate}]});
check('nested squash propagates reverted inner edit',()=>assert.equal(touched(nested,S),'yes'));
check('review after the revert is not invalidated by older touches',()=>assert.equal(touched(nested,S,{from:2,to:3}),'no'));
check('nested squashes flatten source ordinals correctly',()=>assert.deepEqual(nested.changedAt[S],[1,2]));
const partial=rangeSummary([base,base,unrelated],[c0,aggregate,later],{nested:[{summary:{...revertedSummary,coverage:'partial'},emitted:aggregate}]});
check('nested squash propagates incomplete coverage',()=>assert.equal(partial.coverage,'partial'));
check('nested summary with mismatched endpoint is rejected',()=>assert.throws(()=>rangeSummary([base,unrelated],[c0,aggregate],{nested:[{summary:revertedSummary,emitted:aggregate}]}),/nested-range-mismatch/));
const outputs={namespace:ns,ids:{D,N,P,NP,S,C,O,R1,R2},checks:checks.length,failures:0,checkNames:checks,outcomes,
  examples:{section:ref(S),document:ref(D,'document')},profile:PROFILE,revertedSummary,nestedSummary:nested};
await fs.writeFile(path.join(ROOT,'docs/investigations/addressing/case-results.json'),JSON.stringify(outputs,null,2)+'\n');
// Feed exact generated source and metadata to the separate native Git/ZIP probe.
await fs.writeFile(path.join(WORK,'states.json'),JSON.stringify(Object.fromEntries(Object.entries(stateNames).map(([name,s])=>[name,{namespace:s.namespace,documents:s.documents,records:s.records,views:s.views,metadata:s.metadata}]))));
console.log(JSON.stringify({checks:checks.length,failures:0,states:Object.keys(stateNames),examples:outputs.examples},null,2));
