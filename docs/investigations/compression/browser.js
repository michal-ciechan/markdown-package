// Standalone experiment, served by browser_benchmark.py. No package-format reader.
const post = (path, obj) => fetch(path, {method:'POST', body:JSON.stringify(obj)}).then(r=>r.json());
const getBytes = async path => new Uint8Array(await (await fetch(path)).arrayBuffer());
const hex = bytes => Array.from(bytes, x=>x.toString(16).padStart(2,'0')).join('');
const digest = async bytes => hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
const median = a => [...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];

async function nativeDecode(format, data, offset, size, stream) {
  let cursor=0;
  const source=new ReadableStream({pull(controller){
    if(cursor===data.length) return controller.close();
    const next=Math.min(cursor+4096,data.length);
    controller.enqueue(data.subarray(cursor,next)); cursor=next;
  }}).pipeThrough(new DecompressionStream(format));
  if(!stream) {
    const decoded=new Uint8Array(await new Response(source).arrayBuffer());
    return decoded.slice(offset,offset+size);
  }
  const out=new Uint8Array(size);
  let pos=0;
  for await(const chunk of source) {
    const start=Math.max(0,offset-pos), end=Math.min(chunk.length,offset+size-pos);
    if(end>start) out.set(chunk.subarray(start,end),Math.max(0,pos-offset));
    pos+=chunk.length;
  }
  return out;
}

async function main() {
  const cfg=await (await fetch('/config')).json();
  const support={};
  for(const format of ['gzip','deflate','deflate-raw','brotli','br','zstd','xz']) {
    try { new DecompressionStream(format); support[format]=true; }
    catch(e) { support[format]=false; }
  }
  if(cfg.probe) {
    const decoded={};
    for(const [format,file] of Object.entries(cfg.probes)) {
      try {
        const out=await nativeDecode(format,await getBytes('/fixtures/'+file),0,cfg.size,false);
        decoded[format]=await digest(out)===cfg.sha;
      } catch(e) { decoded[format]=String(e); }
    }
    // A zlib preset dictionary is explicitly forbidden by the Streams standard.
    let fdict;
    try { await nativeDecode('deflate',await getBytes('/fdict.bin'),0,11,false); fdict='accepted'; }
    catch(e) { fdict=String(e); }
    const gz=await getBytes('/fixtures/'+cfg.probes.gzip);
    const responseBytes=new Uint8Array(await new Response(gz,{headers:{'Content-Encoding':'gzip'}}).arrayBuffer());
    const malformed={};
    const badCrc=gz.slice(); badCrc[badCrc.length-8]^=1;
    const concat=new Uint8Array(gz.length*2); concat.set(gz); concat.set(gz,gz.length);
    for(const [name,data] of Object.entries({badCrc,truncated:gz.slice(0,-1),concatenated:concat})) {
      try { await nativeDecode('gzip',data,0,cfg.size,false); malformed[name]='accepted'; }
      catch(e) { malformed[name]='rejected: '+String(e); }
    }
    return post('/done',{userAgent:navigator.userAgent,support,decoded,fdict,malformed,
      constructedResponsePreservesCompressedBytes:await digest(responseBytes)===await digest(gz)});
  }
  const f=cfg.fixture;
  const data=await getBytes('/fixtures/'+f.file);
  const dictionary=f.dictionary ? await getBytes('/fixtures/'+f.dictionary) : null;
  let decode, memory=null, ctx=null, startupMs=0;
  if(cfg.engine==='native') {
    const format=f.codec.split('-')[0]==='raw' ? 'deflate-raw' : f.codec.split('-')[0];
    if(!support[format]) return post('/done',{unsupported:true,format,support,userAgent:navigator.userAgent});
    decode=()=>nativeDecode(format,data,f.offset,f.target_bytes,cfg.stream);
  } else {
    // Time module fetch/parse plus WASM fetch/compile/instantiate on localhost.
    // Fresh browser/profile for each sample; excludes WAN and browser launch.
    const start=performance.now();
    if(cfg.engine==='brotli-wasm') {
      const mod=await import('/js/node_modules/brotli-dec-wasm/pkg/brotli_dec_wasm.js');
      const instance=await mod.default({module_or_path:'/js/node_modules/brotli-dec-wasm/pkg/brotli_dec_wasm_bg.wasm'});
      memory=()=>instance.memory.buffer.byteLength;
      decode=()=>mod.decompress(data).slice(f.offset,f.offset+f.target_bytes);
    } else if(cfg.engine==='zstd-wasm') {
      const mod=await import('/zstd-bundle.js');
      await mod.init('/js/node_modules/@bokuweb/zstd-wasm/dist/esm/zstd.wasm');
      memory=()=>mod.Module.HEAPU8.buffer.byteLength;
      if(dictionary) ctx=mod.createDCtx();
      decode=()=>{
        const all=dictionary ? mod.decompressUsingDict(ctx,data,dictionary) : mod.decompress(data);
        return all.slice(f.offset,f.offset+f.target_bytes);
      };
    } else {
      const mod=await import('/fflate-bundle.js');
      decode=()=>mod.gunzipSync(data).slice(f.offset,f.offset+f.target_bytes);
    }
    startupMs=performance.now()-start;
  }
  const memoryBefore=memory?.() ?? null;
  // Identify the active renderer by a controlled CPU pulse, not by RSS (a spare
  // renderer can be larger). This occurs before the memory/timing baseline.
  await post('/identify-start',{});
  const pulseEnd=performance.now()+300;
  while(performance.now()<pulseEnd) { /* intentional identification pulse */ }
  await post('/identify-end',{});
  await post('/ready',{});
  const start=performance.now();
  const first=await decode();
  const firstMs=performance.now()-start;
  const firstMemory=memory?.() ?? null;
  await post('/first',{});
  if(await digest(first)!==f.target_sha256) throw Error('First decode hash mismatch');
  const timings=[];
  let last;
  for(let i=0;i<31;i++) {
    const t=performance.now(); last=await decode(); timings.push(performance.now()-t);
  }
  if(await digest(last)!==f.target_sha256) throw Error('Repeated decode hash mismatch');
  await post('/done',{userAgent:navigator.userAgent,support,startupMs,firstMs,
    medianMs:median(timings),p95Ms:[...timings].sort((a,b)=>a-b)[29],timings,
    wasmMemoryBefore:memoryBefore,wasmMemoryAfterFirst:firstMemory,
    resources:performance.getEntriesByType('resource').filter(r=>/wasm|bundle/.test(r.name)).map(r=>({name:r.name,bytes:r.decodedBodySize,duration:r.duration}))});
}
main().catch(e=>post('/done',{error:String(e),stack:e.stack}));
