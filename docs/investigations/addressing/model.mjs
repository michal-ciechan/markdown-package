// CARD-0004 executable proposal, not a production package reader.
import {createRequire} from 'node:module';
import path from 'node:path';
import {createHash} from 'node:crypto';
const require=createRequire(path.resolve('.antiphon/addressing-work/js/package.json'));
const {Parser}=require('commonmark');
export const PROFILE='cm0312-source-lf-v1';
export const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const OID='(?:sha1-[a-f0-9]{40}|sha256-[a-f0-9]{64})';
export const parser=new Parser({smart:false});
export const hash=b=>createHash('sha256').update(b).digest('hex');
export const gitBlob=b=>createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${b.length}\0`),b])).digest('hex');
export const canonicalJson=x=>JSON.stringify(sort(x))+'\n';
function sort(x){return Array.isArray(x)?x.map(sort):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;}
export const normalized=b=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b).replace(/\r\n?/g,'\n');
// Boundary blank lines are separators. Internal whitespace and Unicode are exact.
export function canonicalScope(text){
  const lines=text.split('\n');
  while(lines.length && /^[ \t]*$/.test(lines.at(-1)))lines.pop();
  return lines.length?lines.join('\n')+'\n':'';
}
export const digest=(kind,source)=>hash(`mdpkg\0${PROFILE}\0${kind}\0${canonicalScope(source)}`);
export function sections(bytes){
  const text=normalized(bytes),lines=text.split('\n'),ast=parser.parse(text),headings=[];
  // Top-level headings only: headings in code, HTML, lists or quotes do not open sections.
  for(let node=ast.firstChild;node;node=node.next)if(node.type==='heading'){
    headings.push({start:node.sourcepos[0][0]-1,headingEnd:node.sourcepos[1][0],level:node.level});
  }
  const result=[{type:'preamble',start:0,end:headings[0]?.start??lines.length,parent:null}];
  const stack=[];
  for(let i=0;i<headings.length;i++){
    const h=headings[i];while(stack.length && headings[stack.at(-1)].level>=h.level)stack.pop();
    const end=headings.slice(i+1).find(n=>n.level<=h.level)?.start??lines.length;
    result.push({type:'section',...h,end,parent:stack.at(-1)??null});stack.push(i);
  }
  for(const s of result){s.source=lines.slice(s.start,s.end).join('\n');s.digest=digest(s.type,s.source);}
  return {text,sections:result,documentDigest:digest('document',text)};
}
export const shardOf=(id,hex)=>id.slice(0,hex);
export function makeState(namespace,documents,tombstones=[],withDigest=false,shardHex=null){
  const records={},views={},paths=new Set(),assign=(id,record)=>{if(!UUID.test(id))throw Error('invalid-id');if(records[id])throw Error('duplicate-id');records[id]=record;};
  for(const doc of documents){
    if(paths.has(doc.path))throw Error('duplicate-path');paths.add(doc.path);
    if(doc.path.startsWith('/')||doc.path.includes('\\')||doc.path.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('invalid-path');
    const bytes=Buffer.from(doc.source),parsed=sections(bytes);
    if(doc.sectionIds.length!==parsed.sections.length-1)throw Error('heading-id-count');
    const ids=[doc.preambleId,...doc.sectionIds];
    assign(doc.id,{k:'document',path:doc.path,blob:'sha1-'+gitBlob(bytes),...(withDigest?{digest:parsed.documentDigest}:{})});
    views[doc.id]={digest:parsed.documentDigest,source:canonicalScope(parsed.text),path:doc.path};
    parsed.sections.forEach((s,i)=>{
      const id=ids[i],parent=s.parent===null?null:doc.sectionIds[s.parent];
      assign(id,{k:s.type,document:doc.id,...(s.type==='section'?{line:s.start+1}:{}),...(withDigest?{digest:s.digest}:{})});
      views[id]={digest:s.digest,source:canonicalScope(s.source),path:doc.path,line:s.start+1,parent,document:doc.id};
    });
  }
  for(const t of tombstones)assign(t.id,{k:'retired',kind:t.kind,reason:t.reason,successors:t.successors??[]});
  shardHex??=Object.keys(records).length<=4096?1:2;
  if(![1,2].includes(shardHex))throw Error('unsupported-shard-layout');
  const shards={};
  for(const [id,r] of Object.entries(records).sort())(shards[shardOf(id,shardHex)]??={})[id]=r;
  const config={version:1,namespace,profile:PROFILE,shardHex};
  const metadata={'.mdpkg/address/config.json':canonicalJson(config)};
  for(const [prefix,entries] of Object.entries(shards))metadata[`.mdpkg/address/ids/${prefix}.json`]=canonicalJson(entries);
  return {namespace,documents,records,views,metadata};
}
export function reference(namespace,kind,id,expect,at){
  const u=new URL(`mdpkg://${namespace}/v1/${kind}/${id}`);
  if(expect){u.searchParams.set('profile',PROFILE);u.searchParams.set('expect',expect);}
  if(at)u.searchParams.set('at',at);
  return u.href;
}
export function parseReference(value){
  const u=new URL(value),parts=u.pathname.split('/').filter(Boolean);
  if(u.protocol!=='mdpkg:'||parts[0]!=='v1'||u.username||u.password||u.port||u.hash)throw Error('invalid-reference');
  if(!UUID.test(u.hostname))throw Error('namespace');
  if(parts.length!==3||!['document','section','commit','diff','hunk'].includes(parts[1]))throw Error('reference-kind');
  const parameters={};for(const [k,v] of u.searchParams){if(k in parameters)throw Error('duplicate-parameter');parameters[k]=v;}
  const allowed=['document','section'].includes(parts[1])?['profile','expect','at']:parts[1]==='commit'?[]:['document','section','profile',...(parts[1]==='hunk'?['patch','ordinal']:[])];
  if(Object.keys(parameters).some(k=>!allowed.includes(k)))throw Error('unknown-parameter');
  if(['document','section'].includes(parts[1])&&!UUID.test(parts[2]))throw Error('entity-id');
  if(parts[1]==='commit'&&!new RegExp('^'+OID+'$').test(parts[2]))throw Error('commit-id');
  if(['diff','hunk'].includes(parts[1])&&!new RegExp('^'+OID+'\\.\\.'+OID+'$').test(parts[2]))throw Error('diff-endpoints');
  if(parameters.at&&!new RegExp('^'+OID+'$').test(parameters.at))throw Error('snapshot-id');
  return {namespace:u.hostname,kind:parts[1],id:parts[2],...parameters};
}
export function resolve(ref,state,{entityCoverage='complete',available=true}={}){
  const q=parseReference(ref);
  if(q.namespace!==state.namespace)return {status:'invalidated',reason:'wrong-lineage'};
  if(!['document','section'].includes(q.kind))throw Error('immutable-ref-needs-git');
  if(q.profile!==PROFILE)return {status:'invalidated',reason:'unsupported-profile'};
  if(q.at)return {status:'invalidated',reason:'historical-selector-needs-git'};
  const r=state.records[q.id];
  if(!r)return {status:'invalidated',reason:entityCoverage==='complete'?'unknown-id':'outside-entity-coverage'};
  if(r.k==='retired')return (q.kind==='document')!==(r.kind==='document')?{status:'invalidated',reason:'kind-mismatch'}:{status:'flagged-changed',reason:r.reason,successors:r.successors};
  if((q.kind==='document')!==(r.k==='document'))return {status:'invalidated',reason:'kind-mismatch'};
  if(!available)return {status:'invalidated',reason:'content-not-shipped'};
  const did=r.k==='document'?q.id:r.document,dr=state.records[did];
  const doc=state.documents.find(d=>d.id===did&&d.path===dr?.path);
  if(!doc||dr.k!=='document')return {status:'invalidated',reason:'invalid-document-binding'};
  if(dr.blob!=='sha1-'+gitBlob(Buffer.from(doc.source)))return {status:'invalidated',reason:'blob-binding-mismatch'};
  const parsed=sections(Buffer.from(doc.source));
  const s=r.k==='document'?{digest:parsed.documentDigest}:parsed.sections.find(s=>s.type===r.k&&(r.k==='preamble'||s.start+1===r.line));
  if(!s)return {status:'invalidated',reason:'invalid-heading-locator'};
  const v={digest:s.digest,path:doc.path,line:r.line};
  if(!/^[a-f0-9]{64}$/.test(q.expect??''))return {status:'invalidated',reason:'missing-or-invalid-digest'};
  return {status:v.digest===q.expect?'survives':'flagged-changed',reason:v.digest===q.expect?'same-source':'source-changed',
    id:q.id,actualDigest:v.digest,path:v.path,line:v.line,cacheValid:r.digest===undefined||r.digest===v.digest};
}
export function rangeSummary(states,sourceCommits,{coverage='complete',nested=[]}={}){
  if(states.length!==sourceCommits.length)throw Error('range-length');
  const stateDigest=s=>hash(canonicalJson(Object.fromEntries(Object.entries(s.views).map(([id,v])=>[id,v.digest]))));
  const changedAt={},identityEvents=[],expanded=[],collapsedInputs=sourceCommits.slice(1);
  const add=(id,n)=>{(changedAt[id]??=[]).push(n);};
  for(let i=1;i<states.length;i++){
    const a=states[i-1],b=states[i];
    const included=nested.find(n=>n.emitted===sourceCommits[i]);
    if(included){
      const s=included.summary,offset=expanded.length;
      if(s.namespace!==a.namespace||s.profile!==PROFILE||s.walk!=='first-parent'||s.beforeStateDigest!==stateDigest(a)||s.afterStateDigest!==stateDigest(b))throw Error('nested-range-mismatch');
      expanded.push(...s.sourceCommits);
      for(const [id,ordinals] of Object.entries(s.changedAt))for(const n of ordinals)add(id,n+offset);
      identityEvents.push(...s.identityEvents.map(e=>({...e,at:e.at+offset})));
      if(s.coverage!=='complete')coverage='partial';
      continue;
    }
    expanded.push(sourceCommits[i]);const at=expanded.length;
    for(const id of new Set([...Object.keys(a.records),...Object.keys(b.records)])){
      if(a.views[id]?.digest!==b.views[id]?.digest)add(id,at);
      if(!a.records[id]&&b.records[id])identityEvents.push({at,id,event:'created',kind:b.records[id].k});
      if(b.records[id]?.k==='retired' && a.records[id]?.k!=='retired')identityEvents.push({at,id,...b.records[id]});
    }
  }
  if(new Set(expanded).size!==expanded.length)throw Error('overlapping-source-ranges');
  const contentTouched=Object.keys(changedAt).sort(),endpoints={};
  for(const id of contentTouched)endpoints[id]={before:states[0].views[id]?.digest??null,after:states.at(-1).views[id]?.digest??null};
  return {version:1,namespace:states[0].namespace,profile:PROFILE,walk:'first-parent',coverage,
    base:sourceCommits[0],tip:expanded.at(-1),sourceCommits:expanded,collapsedInputs,
    beforeStateDigest:stateDigest(states[0]),afterStateDigest:stateDigest(states.at(-1)),
    nested:nested.map(n=>({summary:hash(canonicalJson(n.summary)),emitted:n.emitted})),
    contentTouched,changedAt,endpoints,identityEvents};
}
export function touched(summary,id,{from=0,to=summary.sourceCommits.length}={}){
  if(summary.coverage!=='complete')return 'unknown';
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to>summary.sourceCommits.length||from>to)throw Error('out-of-range');
  return (summary.changedAt[id]??[]).some(n=>n>from&&n<=to)?'yes':'no';
}
