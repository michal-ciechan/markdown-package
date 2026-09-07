// Native Git backend for the zero-metadata reader experiment; no producer IDs used.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {deflateSync} from 'node:zlib';
import {createHash,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {inventory,slot,clearParseCache,parsedSource} from './sparse_model.mjs';
const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_NO_REPLACE_OBJECTS:'1'};
export const decodeSource=bytes=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
export class Reader{
  constructor(repo,{threshold=50,guard=false}={}){
    this.repo=path.resolve(repo);this.threshold=threshold;this.guard=guard;this.objects=new Map();this.snapshots=new Map();this.edges=new Map();this.paths=new Map();
    this.scratch=path.resolve('.antiphon/addressing-work/runtime-projections',randomUUID());this.projected=new Map();this.counters={gitCalls:0,gitStdoutBytes:0,objects:0,blobBytes:0,parsedDocumentBytes:0,edges:0};
  }
  git(args,input,repo=this.repo){this.counters.gitCalls++;const b=execFileSync('git',['-C',repo,'-c','core.autocrlf=false',...args],{env,input,maxBuffer:512*1024*1024,stdio:['pipe','pipe','pipe']});this.counters.gitStdoutBytes+=b.length;return b;}
  available(oid){try{this.git(['cat-file','-e',oid+'^{commit}']);return true;}catch{return false;}}
  batch(oids){
    oids=[...new Set(oids)].filter(o=>!this.objects.has(o));if(!oids.length)return;
    const data=this.git(['cat-file','--batch'],Buffer.from(oids.join('\n')+'\n'));let offset=0;
    for(const oid of oids){const e=data.indexOf(10,offset),[actual,kind,size]=data.subarray(offset,e).toString().split(' ');if(actual!==oid||!size)throw Error('missing-object');
      const bytes=data.subarray(e+1,e+1+Number(size));offset=e+2+Number(size);this.objects.set(oid,{kind,bytes});this.counters.objects++;if(kind==='blob')this.counters.blobBytes+=bytes.length;}
  }
  treeEntries(oid){const data=this.objects.get(oid).bytes,out=[];let i=0;
    while(i<data.length){const space=data.indexOf(32,i),nul=data.indexOf(0,space),mode=data.subarray(i,space).toString(),name=data.subarray(space+1,nul).toString(),id=data.subarray(nul+1,nul+21).toString('hex');out.push({mode,name,id});i=nul+21;}return out;
  }
  load(commits,namespace){
    const wanted=commits.filter(c=>!this.snapshots.has(c));if(!wanted.length)return;
    this.batch(wanted);const roots=new Map(wanted.map(c=>[c,/^tree ([a-f0-9]+)/m.exec(this.objects.get(c).bytes.toString())[1]]));
    let frontier=[...roots.values()],allTrees=new Set();
    while(frontier.length){this.batch(frontier);const next=[];for(const t of frontier){allTrees.add(t);for(const e of this.treeEntries(t))if(e.mode==='40000'&&!allTrees.has(e.id))next.push(e.id);}frontier=[...new Set(next)];}
    const files=new Map();const walk=(tree,prefix,out)=>{for(const e of this.treeEntries(tree)){const p=prefix+e.name;if(e.mode==='40000')walk(e.id,p+'/',out);else if(p.endsWith('.md'))out[p]=e.id;}};
    for(const [commit,tree] of roots){const out={};walk(tree,'',out);files.set(commit,out);}
    this.batch([...files.values()].flatMap(f=>Object.values(f)));
    const parsedBlobs=this.parsedBlobs??=new Set();
    for(const [commit,map] of files){const docs=Object.entries(map).sort().map(([p,oid])=>{
      const source=decodeSource(this.objects.get(oid).bytes);if(!parsedBlobs.has(oid)){this.counters.parsedDocumentBytes+=Buffer.byteLength(source);parsedBlobs.add(oid);}
      const n=parsedSource(source).sections.length-1;
      return {path:p,source,id:p+' document',preambleId:p+' preamble',sectionIds:Array.from({length:n},(_,i)=>p+' heading '+i)};
    });this.snapshots.set(commit,inventory(namespace,docs));}
  }
  project(commit){
    if(this.projected.has(commit))return this.projected.get(commit);
    if(!fs.existsSync(this.scratch)){fs.mkdirSync(this.scratch,{recursive:true});this.git(['init','--bare','--initial-branch=main','--template='],undefined,this.scratch);}
    const put=(kind,bytes)=>{const raw=Buffer.concat([Buffer.from(`${kind} ${bytes.length}\0`),bytes]),oid=createHash('sha1').update(raw).digest('hex'),file=path.join(this.scratch,'objects',oid.slice(0,2),oid.slice(2));
      if(!fs.existsSync(file)){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,deflateSync(raw));}return oid;};
    const chunks=[];for(const v of Object.values(this.snapshots.get(commit).bySlot).filter(v=>v.kind==='section').sort((a,b)=>a.slot.localeCompare(b.slot))){const oid=put('blob',Buffer.from(v.source));chunks.push(Buffer.from('100644 '+v.slot+'.md\0'),Buffer.from(oid,'hex'));}
    const tree=put('tree',Buffer.concat(chunks));this.projected.set(commit,tree);return tree;
  }
  renamePairs(a,b,repo=this.repo){const fields=this.git(['diff','--name-status','-z',`-M${this.threshold}%`,'-l0','--no-ext-diff','--no-textconv',a,b],undefined,repo).toString().split('\0'),pairs=[];
    for(let i=0;i<fields.length&&fields[i];){const status=fields[i++],old=fields[i++];if(status.startsWith('R')||status.startsWith('C'))pairs.push({old,to:fields[i++],score:Number(status.slice(1))});}return pairs;
  }
  edge(a,b){const key=a+'..'+b;if(this.edges.has(key))return this.edges.get(key);
    this.counters.edges++;const old=this.snapshots.get(a),current=this.snapshots.get(b),proposals=new Map();
    for(const pair of this.renamePairs(a,b))for(const v of old.byPath[pair.old]??[]){const target=slot(old.namespace,[v.kind,pair.to,v.locator[2]]);if(current.bySlot[target])proposals.set(v.slot,{to:target,via:'native',score:pair.score});}
    const used=new Set([...proposals.values()].map(v=>v.to));
    for(const p of this.renamePairs(this.project(a),this.project(b),this.scratch)){const from=p.old.slice(0,-3),to=p.to.slice(0,-3);if(!proposals.has(from)&&!used.has(to))proposals.set(from,{to,via:'projected',score:p.score});}
    this.edges.set(key,proposals);return proposals;
  }
  trace(ref,a,b,{method='walk',maxEdges=Infinity}={}){
    const started=performance.now(),before={...this.counters};let result;
    const finish=r=>({...r,ms:performance.now()-started,cost:Object.fromEntries(Object.keys(before).map(k=>[k,this.counters[k]-before[k]]))});
    if(!this.objects.has(a)&&!this.available(a))return finish({status:'unmatched',reason:'review-commit-unavailable'});
    if(!this.objects.has(b)&&!this.available(b))return finish({status:'unmatched',reason:'current-commit-unavailable'});
    let chain;
    if(method==='endpoint')chain=a===b?[a]:[a,b];
    else{if(!this.paths.has(b))this.paths.set(b,this.git(['rev-list','--first-parent',b]).toString().trim().split('\n'));
      const path=this.paths.get(b),at=path.indexOf(a);if(at<0)return finish({status:'unmatched',reason:'not-on-retained-first-parent-path'});chain=path.slice(0,at+1).reverse();}
    const total=chain.length-1,truncated=total>maxEdges;chain=chain.slice(0,maxEdges+1);this.load(chain,ref.namespace);
    let token=slot(ref.namespace,ref.locator),v=this.snapshots.get(a).bySlot[token],touched=0,matches=0;
    if(!v)return finish({status:'unmatched',reason:'review-locator-unavailable'});
    for(let i=1;i<chain.length;i++){
      const next=this.snapshots.get(chain[i]);let target=next.bySlot[token];
      if(this.guard&&(v.duplicate||target?.duplicate))return finish({status:'unmatched',reason:'ambiguous-duplicate'});
      if(!target){const proposal=this.edge(chain[i-1],chain[i]).get(token);if(!proposal)return finish({status:'unmatched',reason:'no-rename-candidate',at:i});target=next.bySlot[proposal.to];token=proposal.to;matches++;}
      if(v.digest!==target.digest)touched++;v=target;
    }
    if(truncated)return finish({status:'unmatched',reason:'history-budget-exceeded',processed:chain.length-1,total});
    return finish({status:v.digest===ref.expect?'same-source':'source-changed',locator:v.locator,computedSlot:token,touched,matches,transitions:total,identity:'inferred'});
  }
}
export {clearParseCache};
