// One-snapshot allocation for cost only, not a heuristic for matching revisions.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {performance} from 'node:perf_hooks';
import {sections,makeState,canonicalJson,PROFILE,hash,resolve,reference} from './model.mjs';
const work=path.resolve('.antiphon/addressing-work'),out=path.resolve('docs/investigations/addressing');
const require=createRequire(path.join(work,'js/package.json'));
const uuid=name=>{const b=createHash('sha256').update('one-time fixture allocation '+name).digest();b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const x=b.toString('hex').slice(0,32);return `${x.slice(0,8)}-${x.slice(8,12)}-${x.slice(12,16)}-${x.slice(16,20)}-${x.slice(20)}`;};
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const input=JSON.parse(await fs.readFile(path.join(work,'corpora.json'),'utf8'));
const result=[];
for(const corpus of input){
  const namespace=uuid(corpus.corpus),documents=corpus.documents.map(d=>{
    if(hash(Buffer.from(d.source))!==d.sha256)throw Error('Corpus drift');
    const parsed=sections(Buffer.from(d.source));
    return {id:uuid(corpus.corpus+d.path),path:d.path,source:d.source,preambleId:uuid(corpus.corpus+d.path+' preamble'),
      sectionIds:parsed.sections.slice(1).map((_,i)=>uuid(corpus.corpus+d.path+' allocation '+i))};
  });
  const minimal=makeState(namespace,documents),cached=makeState(namespace,documents,[],true),fixed256=makeState(namespace,documents,[],false,2);
  const prefix=path.join(work,'corpus',corpus.corpus);
  await fs.mkdir(prefix,{recursive:true});
  for(const [label,state] of [['identity',minimal],['cached',cached],['identity256',fixed256]]){
    await fs.writeFile(path.join(prefix,label+'.json'),JSON.stringify(state.metadata));
  }
  const target=documents.find(d=>d.path===corpus.target),sid=target.sectionIds[0]??target.preambleId;
  const digits=JSON.parse(minimal.metadata['.mdpkg/address/config.json']).shardHex;
  const uri=reference(namespace,'section',sid,minimal.views[sid].digest);
  const raw=Buffer.from(target.source),parseTimes=[],resolveTimes=[],cachedTimes=[];
  for(let i=0;i<32;i++){
    let t=performance.now();sections(raw);parseTimes.push(performance.now()-t);
    t=performance.now();const r=resolve(uri,minimal);resolveTimes.push(performance.now()-t);
    if(r.status!=='survives')throw Error('Bad resolution');
    // A previously verified local derived-state cache lookup, excluding source I/O.
    t=performance.now();for(let j=0;j<10000;j++)if(minimal.views[sid].digest!==cached.records[sid].digest)throw Error('Bad cache');cachedTimes.push((performance.now()-t)/10000);
  }
  result.push({corpus:corpus.corpus,base:corpus.base,documents:documents.length,
    headingSections:documents.reduce((n,d)=>n+d.sectionIds.length,0),preambles:documents.length,
    totalRecords:Object.keys(minimal.records).length,shardHex:digits,nonemptyShards:Object.keys(minimal.metadata).length-1,
    target:{path:target.path,bytes:raw.length,section:sid,document:target.id,
      neededShards:[...new Set([sid.slice(0,digits),target.id.slice(0,digits)])],
      parseFirstMs:parseTimes[0],parseWarmMedianMs:median(parseTimes.slice(1)),
      resolveFirstMs:resolveTimes[0],resolveWarmMedianMs:median(resolveTimes.slice(1)),verifiedCacheLookupMedianMs:median(cachedTimes.slice(1))},
    continuityChecks:documents.length,checks:32,metadataFixtures:{identity:`corpus/${corpus.corpus}/identity.json`,cached:`corpus/${corpus.corpus}/cached.json`,identity256:`corpus/${corpus.corpus}/identity256.json`}});
}
// Actual browser parser import delivery size; no browser timing is claimed.
const {build}=require('esbuild');
await fs.writeFile(path.join(work,'parser-entry.js'),"export {Parser} from './js/node_modules/commonmark/lib/index.js';\n");
const bundle=await build({entryPoints:[path.join(work,'parser-entry.js')],write:false,bundle:true,minify:true,format:'esm',platform:'browser',target:'es2020'});
const js=bundle.outputFiles[0].contents;
await fs.writeFile(path.join(work,'parser-browser.js'),js);
const assets={node:process.version,commonmark:JSON.parse(await fs.readFile(path.join(work,'js/node_modules/commonmark/package.json'),'utf8')).version,
  esbuild:require('esbuild/package.json').version,parserJSBytes:js.length,parserGzipBytes:gzipSync(js,{level:9}).length,
  sha256:hash(js),profile:PROFILE};
await fs.writeFile(path.join(out,'corpus-results.json'),JSON.stringify({corpora:result,assets},null,2)+'\n');
console.log(JSON.stringify({assets,corpora:result.map(r=>({corpus:r.corpus,documents:r.documents,sections:r.headingSections,target:r.target}))},null,2));
