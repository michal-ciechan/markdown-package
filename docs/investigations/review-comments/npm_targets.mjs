// Real section roots, digests and sub-section anchors over the npm corpus base snapshot,
// computed with the CARD-0004 CommonMark model (worked-example.py's outline is fixture-only).
import fs from 'node:fs/promises';
import {sections,canonicalScope,hash,canonicalJson} from '../addressing/model.mjs';
const NS='c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8',ANCHOR='cm0312-trail-source-v1';
const slot=loc=>hash(`mdpkg-default\0${ANCHOR}\0${NS}\0${canonicalJson(loc)}`);
const corpora=JSON.parse(await fs.readFile('.antiphon/addressing-work/corpora.json','utf8'));
const npm=corpora.find(c=>c.corpus==='npm');
const QUOTE=40,CTX=40,out=[];
for(const doc of npm.documents){
  const p=sections(Buffer.from(doc.source)),lines=p.text.split('\n');
  const trails=[],counts=new Map();
  for(let i=0;i<p.sections.length-1;i++){
    const s=p.sections[i+1],title=lines.slice(s.start,s.headingEnd).join('\n');
    const parent=s.parent===null?[]:trails[s.parent];
    const key=JSON.stringify([parent,title]),occ=counts.get(key)??0;counts.set(key,occ+1);
    const trail=[...parent,[title,occ]];trails.push(trail);
    const body=canonicalScope(s.source);
    if(body.length<QUOTE+8)continue;
    const start=Math.min(Math.floor(body.length/3),body.length-QUOTE),quote=body.slice(start,start+QUOTE);
    out.push({path:doc.path,locator:['section',doc.path,trail],root:slot(['section',doc.path,trail]),
      expect:s.digest,
      select:{start,end:start+QUOTE,quote,occurrence:body.slice(0,start).split(quote).length-1,
        prefix:body.slice(Math.max(0,start-CTX),start),suffix:body.slice(start+QUOTE,start+QUOTE+CTX)}});
  }
}
out.sort((a,b)=>hash('pick'+a.root).localeCompare(hash('pick'+b.root)));
await fs.writeFile('.antiphon/review-work/npm-targets.json',JSON.stringify(out));
console.error(`${out.length} anchorable sections over ${npm.documents.length} npm documents`);
