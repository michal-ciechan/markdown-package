// Exact browser imports, no HTTP client, checkout UI, WASM, or persistent FS.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const work=path.resolve('.antiphon/history-work');
const require=createRequire(path.join(work,'js/package.json'));
const {build}=require('esbuild');
const shim=path.join(work,'buffer-shim.js');
await fs.writeFile(shim,"export { Buffer } from './js/node_modules/buffer/index.js';\n");
const results=[];
for(const [name,exports] of [['git-read','log, readBlob'],['git-bundle','log, readBlob, indexPack']]) {
  const entry=path.join(work,name+'-entry.js');
  await fs.writeFile(entry,`export { ${exports} } from './js/node_modules/isomorphic-git/index.js';\n`);
  const outfile=path.join(work,name+'.js');
  const result=await build({entryPoints:[entry],outfile,bundle:true,minify:true,format:'esm',platform:'browser',target:'es2020',metafile:true,inject:[shim]});
  const bytes=await fs.readFile(outfile);
  results.push({name,exports,bytes:bytes.length,gzip_bytes:gzipSync(bytes,{level:9}).length,
    sha256:createHash('sha256').update(bytes).digest('hex'),
    inputs:Object.keys(result.metafile.inputs).map(p=>p.replaceAll('\\','/'))});
}
await fs.copyFile('docs/investigations/history/browser.js',path.join(work,'browser.js'));
await fs.copyFile('docs/investigations/history/memory_fs.js',path.join(work,'memory_fs.js'));
const adapter=await build({entryPoints:[path.join(work,'memory_fs.js')],write:false,minify:true,format:'esm',target:'es2020'});
const bytes=adapter.outputFiles[0].contents;
results.push({name:'experiment-memory-fs',bytes:bytes.length,gzip_bytes:gzipSync(bytes,{level:9}).length,
  sha256:createHash('sha256').update(bytes).digest('hex')});
await fs.writeFile('docs/investigations/history/browser-assets.json',JSON.stringify({
  node:process.version,isomorphic_git:JSON.parse(await fs.readFile(path.join(work,'js/node_modules/isomorphic-git/package.json'),'utf8')).version,esbuild:require('esbuild/package.json').version,assets:results},null,2)+'\n');
console.log(results.map(({inputs,...rest})=>rest));
