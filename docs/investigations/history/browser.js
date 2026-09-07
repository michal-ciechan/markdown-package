import {memoryFs} from './memory_fs.js';
const dec=new TextDecoder(),enc=new TextEncoder();
const sha=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
const post=async(path,value={})=>fetch(path,{method:'POST',body:JSON.stringify(value)});
const bytes=async url=>new Uint8Array(await (await fetch(url)).arrayBuffer());
const median=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
function section(blob,heading) {
  // Exactly the inspected ATX fixtures; deliberately not CARD-0004's resolver.
  const text=dec.decode(blob),heads=[...text.matchAll(/^#{1,6} [^\r\n]+/gm)];
  const i=heads.findIndex(h=>h[0]===heading);
  return i<0?null:enc.encode(text.slice(heads[i].index,i+1<heads.length?heads[i+1].index:text.length));
}
async function main() {
  const config=await (await fetch('/config')).json();
  const f=config.fixture,target=f.targets[config.target];
  let initial=[],bundle=null;
  if(config.mode==='directory') {
    initial=await Promise.all(f.files.map(async file=>[file.path,await bytes(file.url)]));
  } else {
    bundle=await bytes(f.bundle_url);
  }
  // Same fresh-profile harness and renderer identification as CARD-0002.
  await post('/identify-start');
  const pulse=performance.now();while(performance.now()-pulse<300){}
  await post('/identify-end');await post('/ready');
  const t0=performance.now();
  const git=await import(config.mode==='directory'?'./git-read.js':'./git-bundle.js');
  const moduleMs=performance.now()-t0;
  const m=memoryFs(initial),cache={};
  const args={fs:m.fs,dir:'/',gitdir:'/.git',cache};
  let prepareMs=0,indexedObjects=0;
  if(bundle) {
    const start=performance.now();
    let end=-1;
    for(let i=0;i<bundle.length-1;i++)if(bundle[i]===10&&bundle[i+1]===10){end=i+2;break;}
    if(end<0)throw Error('Missing bundle header');
    const header=dec.decode(bundle.slice(0,end));
    if(!header.startsWith('# v2 git bundle\n')||header.split('\n').some(l=>l.startsWith('-')))throw Error('Expected self-contained v2 bundle');
    if(!header.includes(f.head+' refs/heads/main'))throw Error('Wrong ref');
    const packed=bundle.subarray(end),hex=Array.from(packed.slice(-20),v=>v.toString(16).padStart(2,'0')).join('');
    const file=`.git/objects/pack/pack-${hex}.pack`;
    m.files.set(file,packed);
    m.files.set('.git/HEAD',enc.encode('ref: refs/heads/main\n'));
    m.files.set('.git/refs/heads/main',enc.encode(f.head+'\n'));
    m.files.set('.git/config',enc.encode('[core]\nrepositoryformatversion = 0\nbare = true\n'));
    const result=await git.indexPack({...args,filepath:file});
    indexedObjects=result.oids.length;
    prepareMs=performance.now()-start;
  }
  async function read() {
    const commits=(await git.log({...args,ref:f.head})).reverse();
    if(commits.length!==f.commits.length || commits.some((c,i)=>c.oid!==f.commits[i]))throw Error('Wrong history');
    const results=[];
    for(const c of commits) results.push(await git.readBlob({...args,oid:c.oid,filepath:target.path}));
    return results;
  }
  let start=performance.now();
  const result=await read();
  const firstMs=performance.now()-start;
  const firstReads=m.stats();
  await post('/first');
  let hashChecks=0,sectionChecks=0;
  // Hashes and section processing excluded from document extraction timing.
  for(let i=0;i<result.length;i++) {
    if(result[i].oid!==target.versions[i].oid || await sha(result[i].blob)!==target.versions[i].sha256)throw Error('Blob mismatch '+i);
    hashChecks++;
    const s=section(result[i].blob,target.heading);
    if((s===null?null:await sha(s))!==target.versions[i].section_sha256)throw Error('Section mismatch '+i);
    sectionChecks++;
  }
  const warm=[],sections=[];
  for(let i=0;i<7;i++) {
    start=performance.now();await read();warm.push(performance.now()-start);
    start=performance.now();result.map(r=>section(r.blob,target.heading));sections.push(performance.now()-start);
  }
  return {userAgent:navigator.userAgent,moduleMs,prepareMs,indexedObjects,firstMs,
    startupAndFirstMs:moduleMs+prepareMs+firstMs,warmMedianMs:median(warm),warmSamplesMs:warm,
    sectionParseMedianMs:median(sections),sectionSamplesMs:sections,hashChecks,sectionChecks,
    firstReads,uniqueDocumentBytes:[...new Map(result.map(r=>[r.oid,r.blob.length])).values()].reduce((a,b)=>a+b,0),
    preloadedBytes:config.mode==='directory'?initial.reduce((n,[,b])=>n+b.length,0):bundle.length};
}
try{await post('/done',await main());}catch(e){await post('/done',{error:String(e),stack:e.stack,missing:globalThis.__fsMissing});}
