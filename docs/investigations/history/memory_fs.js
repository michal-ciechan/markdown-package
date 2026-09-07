// Minimal measured in-memory filesystem for immutable fixtures and indexPack.
// Not a production ZIP mount. The source files have already been extracted.
const enc=new TextEncoder(),dec=new TextDecoder();
export function memoryFs(initial) {
  const files=new Map(initial), reads=new Map();
  const normalize=p=>p.replace(/^\/+/, '').replace(/^\.\//,'').replace(/\/$/,'');
  const fail=p=>{(globalThis.__fsMissing??=[]).push(p);throw Object.assign(new Error('ENOENT '+p),{code:'ENOENT'});};
  const isDir=p=>p==='' || [...files.keys()].some(k=>k.startsWith(p+'/'));
  const stat=async raw=>{
    const p=normalize(raw),file=files.has(p);
    if(!file&&!isDir(p)) fail(p);
    return {isFile:()=>file,isDirectory:()=>!file,isSymbolicLink:()=>false,
      mode:file?0o100644:0o40755,size:file?files.get(p).length:0,mtimeMs:0,ctimeMs:0,ino:1,dev:1};
  };
  const promises={
    async readFile(raw,options) {
      const p=normalize(raw),value=files.get(p);
      if(value===undefined) fail(p);
      reads.set(p,(reads.get(p)||0)+1);
      return (typeof options==='string'||options?.encoding)?dec.decode(value):value;
    },
    async writeFile(raw,value) {files.set(normalize(raw),typeof value==='string'?enc.encode(value):new Uint8Array(value));},
    async readdir(raw) {
      const p=normalize(raw),prefix=p?p+'/':'';
      if(!isDir(p)) fail(p);
      return [...new Set([...files.keys()].filter(k=>k.startsWith(prefix)).map(k=>k.slice(prefix.length).split('/')[0]))].sort();
    },
    async mkdir(){},async rmdir(){},async unlink(raw){files.delete(normalize(raw));},stat,lstat:stat,
    async readlink(p){fail(p);},async symlink(){throw Error('Unsupported');}
  };
  return {fs:{promises},files,reads,stats:()=>({files:[...reads].map(([p,c])=>({path:p,calls:c,bytes:files.get(p).length})),
    unique_bytes:[...reads.keys()].reduce((n,p)=>n+files.get(p).length,0),
    read_call_bytes:[...reads].reduce((n,[p,c])=>n+c*files.get(p).length,0)})};
}
