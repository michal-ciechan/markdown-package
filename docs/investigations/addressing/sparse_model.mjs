// Follow-up executable storage proposal. Producer correspondence is explicit input.
import {sections,hash,canonicalJson,PROFILE,canonicalScope,UUID} from './model.mjs';
export const ANCHOR='cm0312-trail-source-v1';
const parseCache=new Map();
export const clearParseCache=()=>parseCache.clear();
export function parsedSource(source){if(!parseCache.has(source))parseCache.set(source,sections(Buffer.from(source)));return parseCache.get(source);}
export const slot=(namespace,locator)=>hash(`mdpkg-default\0${ANCHOR}\0${namespace}\0${canonicalJson(locator)}`);
export function inventory(namespace,documents){
  const byEntity={},bySlot={},byPath={},duplicateGroups=[];
  for(const doc of documents){
    const parsed=parsedSource(doc.source),lines=parsed.text.split('\n'),trails=[],counts=new Map(),groups=new Map();
    const add=(entity,kind,trail,scope)=>{
      const locator=[kind,doc.path,trail],token=slot(namespace,locator);
      if(bySlot[token])throw Error('duplicate-slot');
      const v={entity,kind,locator,slot:token,digest:scope.digest,source:canonicalScope(scope.source),path:doc.path};
      byEntity[entity]=bySlot[token]=v;(byPath[doc.path]??=[]).push(v);return v;
    };
    add(doc.id,'document',[],{digest:parsed.documentDigest,source:parsed.text});
    parsed.sections.forEach((s,i)=>{
      if(!i){add(doc.preambleId,'preamble',[],s);return;}
      const parent=s.parent===null?[]:trails[s.parent];
      // Heading source, including rank/markup, not a content-derived whole-section ID.
      const title=lines.slice(s.start,s.headingEnd).join('\n');
      const family=JSON.stringify([parent,title]),occurrence=counts.get(family)??0;counts.set(family,occurrence+1);
      const trail=[...parent,[title,occurrence]];trails[i-1]=trail;
      const v=add(doc.sectionIds[i-1],'section',trail,s);(groups.get(family)??groups.set(family,[]).get(family)).push(v);
    });
    for(const group of groups.values())if(group.length>1){duplicateGroups.push(group.map(v=>v.slot));for(const v of group)v.duplicate=true;}
  }
  return {namespace,documents,byEntity,bySlot,byPath,duplicateGroups};
}
export function initial(state){
  const view=inventory(state.namespace,state.documents);
  return {view,roots:Object.fromEntries(Object.values(view.byEntity).map(v=>[v.entity,v.slot])),overrides:{},used:new Set(Object.keys(view.bySlot))};
}
export function advance(previous,state,{checkpoint='fixture'}={}){
  const view=inventory(state.namespace,state.documents),roots={},used=new Set(previous.used),overrides={};
  for(const v of Object.values(view.byEntity)){
    let root=previous.roots[v.entity];
    if(!root){root=v.slot;if(used.has(root))root=hash(`mdpkg-birth\0${state.namespace}\0${checkpoint}\0${v.entity}\0${canonicalJson(v.locator)}`);}
    roots[v.entity]=root;used.add(root);
    // Once exceptional, keep its current target even after a move/rename is reverted.
    // An external review may carry the intermediate locator as its navigation hint.
    if(root!==v.slot || previous.overrides[root]?.to)overrides[root]={to:v.locator};
  }
  // Carry old tombstones and unresolved boundaries, even when ancestry is removed.
  for(const [root,r] of Object.entries(previous.overrides))if(!r.to)overrides[root]=r;
  for(const [entity,root] of Object.entries(previous.roots))if(!roots[entity]){
    const retired=state.records?.[entity];
    overrides[root]=retired?.k==='retired'?{dead:retired.reason,next:(retired.successors??[]).map(id=>roots[id])}:{unknown:'unconfirmed-removal'};
  }
  return {view,roots,used,overrides};
}
export function metadata(sparse){
  // No config/section entries in the no-exception case; the shared manifest selects the profile.
  if(!Object.keys(sparse.overrides).length)return {};
  return {'.mdpkg/address/overrides.json':canonicalJson({version:1,anchor:ANCHOR,entries:sparse.overrides})};
}
export const review=(state,entity)=>({namespace:state.view.namespace,root:state.roots[entity],locator:state.view.byEntity[entity].locator,
  expect:state.view.byEntity[entity].digest,profile:PROFILE,anchor:ANCHOR});
export function sparseURI(ref){
  const kind=ref.locator[0]==='document'?'document':'section';
  const u=new URL(`mdpkg://${ref.namespace}/v2/${kind}/${ref.root}`);
  for(const k of ['anchor','profile','expect'])u.searchParams.set(k,ref[k]);
  u.searchParams.set('loc',Buffer.from(canonicalJson(ref.locator)).toString('base64url'));return u.href;
}
export function parseSparseURI(value){
  const u=new URL(value),parts=u.pathname.split('/'),params={};
  if(u.protocol!=='mdpkg:'||u.username||u.password||u.port||u.hash||!UUID.test(u.hostname)||parts.length!==4||parts[1]!=='v2'||!['section','document'].includes(parts[2])||!/^[a-f0-9]{64}$/.test(parts[3]))throw Error('invalid-reference');
  for(const [k,v] of u.searchParams){if(!['anchor','profile','expect','loc'].includes(k)||k in params)throw Error('invalid-parameter');params[k]=v;}
  if(Object.keys(params).length!==4||!/^[a-f0-9]{64}$/.test(params.expect))throw Error('invalid-state-digest');
  const locator=JSON.parse(Buffer.from(params.loc,'base64url').toString('utf8'));
  if(Buffer.from(canonicalJson(locator)).toString('base64url')!==params.loc)throw Error('noncanonical-locator');
  if(!Array.isArray(locator)||locator.length!==3||!['document','section','preamble'].includes(locator[0])||typeof locator[1]!=='string'||!Array.isArray(locator[2]))throw Error('invalid-locator');
  if(locator[1].includes('\\')||locator[1].split('/').some(p=>!p||p==='.'||p==='..'))throw Error('invalid-path');
  if((locator[0]==='document')!==(parts[2]==='document'))throw Error('kind-mismatch');
  if(locator[0]!=='section'&&locator[2].length)throw Error('invalid-trail');
  if(locator[0]==='section'&&!locator[2].length)throw Error('invalid-trail');
  if(locator[2].some(t=>!Array.isArray(t)||t.length!==2||typeof t[0]!=='string'||!Number.isSafeInteger(t[1])||t[1]<0))throw Error('invalid-trail');
  return {namespace:u.hostname,root:parts[3],locator,expect:params.expect,profile:params.profile,anchor:params.anchor};
}
export function resolveSparse(ref,view,overrides={},options={}){
  if(ref.namespace!==view.namespace)return {status:'invalidated',reason:'wrong-lineage'};
  if(ref.profile!==PROFILE)return {status:'invalidated',reason:'unsupported-profile'};
  if(ref.anchor!==ANCHOR)return {status:'invalidated',reason:'unsupported-anchor-profile'};
  if(options.correspondence==='partial')return {status:'unconfirmed',reason:'incomplete-correspondence-for-review-range'};
  const entry=overrides[ref.root];
  if(entry?.dead)return {status:'flagged-changed',reason:entry.dead,successors:entry.next};
  if(entry?.unknown)return {status:'unconfirmed',reason:entry.unknown};
  if(!entry && ref.root!==slot(ref.namespace,ref.locator))return {status:'unconfirmed',reason:'missing-override'};
  const target=slot(ref.namespace,entry?.to??ref.locator),v=view.bySlot[target];
  if(!v)return {status:options.naive?'not-found':'unconfirmed',reason:'possibly-renamed-moved-or-deleted'};
  if(options.guardDuplicates&&v.duplicate&&!entry)return {status:'unconfirmed',reason:'duplicate-correspondence'};
  // A complete confirmed ledger, not digest similarity, authorizes this correspondence.
  return {status:v.digest===ref.expect?'survives':'flagged-changed',reason:v.digest===ref.expect?'same-source':'source-changed',
    matchedEntity:v.entity,actualDigest:v.digest,locator:v.locator};
}
