// Exact source snapshots plus explicitly synthetic, confirmed rename/move overlays.
// Natural upstream correspondence is NOT asserted: unmatched slots are unconfirmed.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {hash,canonicalJson,gitBlob,PROFILE} from './model.mjs';
import {inventory,initial,advance,metadata,parsedSource,ANCHOR,slot,review,resolveSparse} from './sparse_model.mjs';
const work='.antiphon/addressing-work',out='docs/investigations/addressing';
const input=JSON.parse(await fs.readFile(`${work}/sparse-history-input.json`,'utf8'));
const baseCorpora=JSON.parse(await fs.readFile(`${work}/corpora.json`,'utf8'));
const oldCosts=JSON.parse(await fs.readFile(`${out}/corpus-results.json`,'utf8'));
const uuid=x=>{const h=hash(x).slice(0,32);return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
const objects={};const addObject=text=>{const oid=gitBlob(Buffer.from(text));objects[oid]=text;return oid;};
function fullMetadata(state,tombstones){
  const view=inventory(state.namespace,state.documents),records={};
  for(const doc of state.documents){
    records[doc.id]={k:'document',path:doc.path,blob:'sha1-'+gitBlob(Buffer.from(doc.source))};
    records[doc.preambleId]={k:'preamble',document:doc.id};
    const p=parsedSource(doc.source);
    doc.sectionIds.forEach((id,i)=>records[id]={k:'section',document:doc.id,line:p.sections[i+1].start+1});
  }
  for(const [id,r] of Object.entries(tombstones))if(!records[id])records[id]=r;
  const digits=Object.keys(records).length<=4096?1:2,shards={};
  for(const [id,r] of Object.entries(records).sort())(shards[id.slice(0,digits)]??={})[id]=r;
  return {'.mdpkg/address/config.json':canonicalJson({version:1,namespace:state.namespace,profile:PROFILE,shardHex:digits}),
    ...Object.fromEntries(Object.entries(shards).map(([key,rs])=>[`.mdpkg/address/ids/${key}.json`,canonicalJson(rs)]))};
}
const results=[],plans=[];let injectedChecks=0;
for(const corpus of input){
  const name=corpus.corpus,namespace=uuid('sparse corpus '+name),original=[];
  let prevSlots={},counter=0;
  for(let i=0;i<corpus.snapshots.length;i++){
    const docs=Object.entries(corpus.snapshots[i]).sort().map(([p,oid])=>{
      const source=corpus.blobs[oid],n=parsedSource(source).sections.length-1;
      return {path:p,source,id:`temp-${p}`,preambleId:`pre-${p}`,sectionIds:Array.from({length:n},(_,j)=>`${p}-${j}`)};
    });
    const view=inventory(namespace,docs),nextSlots={};
    for(const v of Object.values(view.byEntity))nextSlots[v.slot]=prevSlots[v.slot]??uuid(`corpus birth ${name} ${counter++}`);
    for(const d of docs){d.id=nextSlots[view.byEntity[d.id].slot];d.preambleId=nextSlots[view.byEntity[d.preambleId].slot];d.sectionIds=d.sectionIds.map(id=>nextSlots[view.byEntity[id].slot]);}
    original.push({namespace,documents:docs,records:{}});prevSlots=nextSlots;
  }
  const base=original[0],baseView=inventory(namespace,base.documents);
  const untouched=base.documents.filter(d=>corpus.snapshots.every(s=>s[d.path]===corpus.snapshots[0][d.path]));
  const candidates=[];
  for(const d of untouched){const p=parsedSource(d.source);
    p.sections.slice(1).forEach((s,i)=>{const next=p.sections[i+2];if(!next||next.start>=s.end)candidates.push({entity:d.sectionIds[i],doc:d.path,scope:s,rank:s.level});});
  }
  candidates.sort((a,b)=>hash('selection '+a.entity).localeCompare(hash('selection '+b.entity)));
  const headings=base.documents.reduce((n,d)=>n+d.sectionIds.length,0),row={corpus:name,baseHeadings:headings,untouchedLeafCandidates:candidates.length,
    sourceSnapshots:original.length,scenarios:[],snapshotOnly:[]};
  // Exact base-snapshot comparison: alternate confirmed predecessor labels, current bytes untouched.
  // No projection or altered Markdown in this table. One independent alias per selected section.
  const exact=baseCorpora.find(c=>c.corpus===name),exactDocFiles=Object.fromEntries(exact.documents.map(d=>[d.path,addObject(d.source)]));
  const prior=oldCosts.corpora.find(c=>c.corpus===name);
  const fullExact=JSON.parse(await fs.readFile(`${work}/${prior.metadataFixtures.identity}`,'utf8'));
  const currentSections=Object.values(baseView.byEntity).filter(v=>v.kind==='section').sort((a,b)=>hash(a.slot).localeCompare(hash(b.slot)));
  for(const rate of [0,5,20]){
    const count=Math.round(headings*rate/100),entries={};
    for(const v of currentSections.slice(0,count)){
      const oldLocator=structuredClone(v.locator);oldLocator[2].at(-1)[0]+=' (previous title)';
      entries[slot(namespace,oldLocator)]={to:v.locator};
    }
    const sparse=count?{'.mdpkg/address/overrides.json':canonicalJson({version:1,anchor:ANCHOR,entries})}:{};
    const variants={none:{},sparse,identity:fullExact};
    plans.push({corpus:name,scenario:'exact-base',rate,count,sourceBase:corpus.revisions[0],snapshots:[{documents:exactDocFiles,
      metadata:Object.fromEntries(Object.entries(variants).map(([v,files])=>[v,Object.fromEntries(Object.entries(files).map(([p,t])=>[p,addObject(t)]))]))}],
      records:[{author:'Addressing Probe <probe@example.invalid> 1700000000 +0000',committer:'Addressing Probe <probe@example.invalid> 1700000000 +0000',message:'Base snapshot',source:corpus.revisions[0]}]});
    row.snapshotOnly.push({rate,count,rawSparseBytes:Object.values(sparse).reduce((n,t)=>n+Buffer.byteLength(t),0)});
  }
  for(const rate of [0,5,20]){
    const count=Math.round(headings*rate/100);assert(count<=candidates.length,`${name}: insufficient unchanged leaves`);
    const events=candidates.slice(0,count).map((x,i)=>({...x,kind:i%2?'move':'rename',at:1+Math.floor(i*32/Math.max(1,count))}));
    const snapshots=[],tombstones={};let sparseState=null,priorEntities={};
    const rootRefs={};let summaryRecords=0,activeExceptions=0;
    for(let step=0;step<original.length;step++){
      const current=original[step],documents=[],moved=[];
      for(const doc of current.documents){
        const active=events.filter(e=>e.doc===doc.path&&e.at<=step),p=parsedSource(doc.source);
        if(!active.length){documents.push(doc);continue;}
        const lines=p.text.split('\n'),remove=new Set(),renames=new Map();
        for(const e of active){
          if(e.kind==='move'){for(let line=e.scope.start;line<e.scope.end;line++)remove.add(line);moved.push(e);}
          else renames.set(e.scope.start,e);
        }
        const rewritten=[],positions=new Map();
        for(let i=0;i<lines.length;i++)if(!remove.has(i)){
          positions.set(i,rewritten.length);
          let line=lines[i];if(renames.has(i))line=line.replace(/\s+#+\s*$/,'')+' (updated)';
          rewritten.push(line);
        }
        const source=rewritten.join('\n'),newParsed=parsedSource(source),byStart={};
        p.sections.slice(1).forEach((s,i)=>{if(positions.has(s.start))byStart[positions.get(s.start)]=doc.sectionIds[i];});
        const sectionIds=newParsed.sections.slice(1).map(s=>{assert(byStart[s.start]);return byStart[s.start];});
        documents.push({...doc,source,sectionIds});
      }
      if(moved.length){
        moved.sort((a,b)=>b.rank-a.rank||a.entity.localeCompare(b.entity));
        let source='';const lineIds={};
        for(const e of moved){const line=source.split('\n').length-1;lineIds[line]=e.entity;source+=e.scope.source.replace(/\n*$/,'')+'\n\n';}
        const p=parsedSource(source),sectionIds=p.sections.slice(1).map(s=>{assert(lineIds[s.start]);return lineIds[s.start];});
        documents.push({path:'addressing-relocated.md',source,id:uuid(name+' relocation doc'),preambleId:uuid(name+' relocation pre'),sectionIds});
      }
      const state={namespace,documents,records:{}},view=inventory(namespace,documents);
      for(const [id,v] of Object.entries(priorEntities))if(!view.byEntity[id])tombstones[id]={k:'retired',kind:v.kind,reason:'unconfirmed-upstream-removal',successors:[]};
      sparseState=sparseState?advance(sparseState,state,{checkpoint:`${name}-${rate}-${step}`}):initial(state);
      if(!step)for(const e of events)rootRefs[e.entity]=review(sparseState,e.entity);
      for(const e of events)if(e.at<=step){
        const resolved=resolveSparse(rootRefs[e.entity],sparseState.view,sparseState.overrides);
        assert.equal(resolved.matchedEntity,e.entity);assert(['survives','flagged-changed'].includes(resolved.status));injectedChecks++;
      }
      const identity=fullMetadata(state,tombstones),sparse=metadata(sparseState);
      const files=Object.fromEntries(documents.map(d=>[d.path,addObject(d.source)]));
      const metas={none:{},sparse,identity};
      snapshots.push({documents:files,metadata:Object.fromEntries(Object.entries(metas).map(([mode,m])=>[mode,Object.fromEntries(Object.entries(m).map(([p,t])=>[p,addObject(t)]))]))});
      priorEntities=view.byEntity;
      if(step===32){activeExceptions=Object.keys(sparseState.overrides).length;summaryRecords=Object.values(sparseState.overrides).filter(r=>r.unknown).length;}
    }
    plans.push({corpus:name,scenario:'history32',rate,count,sourceBase:corpus.revisions[0],snapshots,records:corpus.records});
    row.scenarios.push({rate,count,renames:events.filter(e=>e.kind==='rename').length,moves:events.filter(e=>e.kind==='move').length,
      finalExceptions:activeExceptions,unconfirmedUpstreamRecords:summaryRecords,events:events.map(e=>({entity:e.entity,path:e.doc,at:e.at,kind:e.kind}))});
  }
  results.push(row);
  console.log(JSON.stringify({corpus:name,baseHeadings:headings,untouchedLeafCandidates:candidates.length,scenarios:row.scenarios.map(({events,...r})=>r)}));
}
await fs.writeFile(`${work}/sparse-storage-plan.json`,JSON.stringify({objects,plans}));
await fs.writeFile(`${out}/sparse-corpus-results.json`,JSON.stringify({corpora:results,injectedResolutionChecks:injectedChecks,failures:0},null,2)+'\n');
