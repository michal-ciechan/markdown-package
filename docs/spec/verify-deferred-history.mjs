// Independent S1 encoding/hash oracle. No product snapshot writer is imported.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const data=JSON.parse(readFileSync(new URL('../investigations/deferred-history/breaking-revision-vectors.json',import.meta.url)));
let checks=0;
function eq(a,b){assert.deepEqual(a,b);checks++;}
const order=(a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b));
function encode(v){
  if(v===null||typeof v!=='object')return JSON.stringify(v);
  if(Array.isArray(v))return '['+v.map(encode).join(',')+']';
  return '{'+Object.keys(v).sort(order).map(k=>JSON.stringify(k)+':'+encode(v[k])).join(',')+'}';
}
const canonical=v=>encode(v)+'\n';
const hash=(alg,b)=>createHash(alg).update(b).digest('hex');
const oid=(kind,b)=>hash('sha1',Buffer.concat([Buffer.from(`${kind} ${b.length}\0`),b]));
function tree(files){
  const groups=new Map();
  for(const [path,text] of Object.entries(files)){
    const slash=path.indexOf('/'),name=slash<0?path:path.slice(0,slash);
    if(slash<0)groups.set(name,{blob:Buffer.from(text)});
    else {if(!groups.has(name))groups.set(name,{files:{}});groups.get(name).files[path.slice(slash+1)]=text;}
  }
  const rows=[...groups].map(([name,item])=>({name,dir:!!item.files,id:item.files?tree(item.files):oid('blob',item.blob)}));
  rows.sort((a,b)=>order(a.name+(a.dir?'/':''),b.name+(b.dir?'/':'')));
  return oid('tree',Buffer.concat(rows.map(r=>Buffer.concat([Buffer.from(`${r.dir?'40000':'100644'} ${r.name}\0`),Buffer.from(r.id,'hex')]))));
}
for(const v of data.vectors){
  const m=JSON.parse(v.snapshotManifestCanonical), g=JSON.parse(v.materializedManifestCanonical), h=JSON.parse(v.materializedHistoryCanonical);
  const records=Object.entries(v.sources).sort(([a],[b])=>order(a,b)).map(([path,text])=>({bytes:Buffer.byteLength(text),digest:'sha256-'+hash('sha256',text),mode:'100644',path}));
  const review=m.review?{detail:m.review.detail,of:{current:m.review.of.current,namespace:m.review.of.namespace},shape:m.review.shape}:null;
  const preimage={entries:records,header:{addressing:m.addressing,namespace:m.namespace,review},profile:'mdpkg-snapshot-v1'};
  eq(preimage,v.preimage);eq(canonical(preimage),v.preimageCanonical);
  eq('sha256-'+hash('sha256',canonical(preimage)),v.snapshotId);
  eq(m.current,{id:v.snapshotId,kind:'snapshot'});eq(m.history,{mode:'none'});
  eq('sha1-'+tree(v.sources),v.treeId);
  const payload=`tree ${v.treeId.slice(5)}\nauthor mdpkg bootstrap <bootstrap@mdpkg.invalid> 946684800 +0000\ncommitter mdpkg bootstrap <bootstrap@mdpkg.invalid> 946684800 +0000\n\nmdpkg-bootstrap-v1\nnamespace ${v.namespace}\nsnapshot ${v.snapshotId}\n`;
  eq(payload,v.bootstrapCommitBytes);eq('sha1-'+oid('commit',Buffer.from(payload)),v.bootstrapCommitId);
  eq(g.current,{kind:'commit',id:v.bootstrapCommitId});eq(g.history.mode,'git');
  eq(h.origin,v.origin);eq(h.origin.header,preimage.header);eq(h.root,'materialized');
  eq(h.sourceBase,v.bootstrapCommitId);eq(h.sourceTip,v.bootstrapCommitId);eq(h.retainedCommits,1);
}
for(const t of data.transitions){
  eq('sha1-'+tree(t.sources),t.treeId);eq('sha1-'+oid('commit',Buffer.from(t.commitBytes)),t.manifest.current.id);
  eq(t.commitBytes.split('\n')[1],'parent '+t.expected.parent.slice(5));
  eq(t.history.origin.snapshot,t.expected.originSnapshot);
  eq(t.history.origin,data.vectors[0].origin);eq(t.history.retainedCommits,2);
}
for(const c of data.hashCases){
  if(c.expected==='reject-before-hashing')continue;
  const v=data.vectors.find(v=>v.name===c.base),files={...v.sources},header=structuredClone(v.preimage.header);
  if(c.target.startsWith('sources/'))files[c.target.slice(8)]=c.value;
  else if(c.target.startsWith('rename/')){files[c.value]=files[c.target.slice(7)];delete files[c.target.slice(7)];}
  else if(c.target.startsWith('header/')){const keys=c.target.slice(7).split('/');let obj=header;for(const k of keys.slice(0,-1))obj=obj[k];obj[keys.at(-1)]=c.value;}
  const entries=Object.entries(files).sort(([a],[b])=>order(a,b)).map(([path,text])=>({bytes:Buffer.byteLength(text),digest:'sha256-'+hash('sha256',text),mode:'100644',path}));
  const id='sha256-'+hash('sha256',canonical({entries,header,profile:'mdpkg-snapshot-v1'}));
  eq(id,c.expectedId);eq(id===v.snapshotId,c.expected==='same');
}
console.log(`${checks} independent JavaScript preimage/tree/commit/origin assertions passed; 0 failures`);
