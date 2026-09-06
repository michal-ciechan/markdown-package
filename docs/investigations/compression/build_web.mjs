// Builds only decoder benchmark imports; generated files stay in .antiphon.
import path from 'node:path';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const work=path.resolve('.antiphon/compression-work');
const require=createRequire(path.join(work,'js/package.json'));
const {build}=require('esbuild');
await fs.writeFile(path.join(work,'zstd-entry.js'),
  `export { init, decompress, decompressUsingDict, createDCtx, freeDCtx } from './js/node_modules/@bokuweb/zstd-wasm/dist/esm/index.web.js';\nexport { Module } from './js/node_modules/@bokuweb/zstd-wasm/dist/esm/module.js';\n`);
await fs.writeFile(path.join(work,'fflate-entry.js'),
  `export { gunzipSync } from './js/node_modules/fflate/esm/browser.js';\n`);
for(const name of ['zstd','fflate']) await build({entryPoints:[path.join(work,name+'-entry.js')],
  outfile:path.join(work,name+'-bundle.js'),bundle:true,minify:true,format:'esm',platform:'browser',target:'es2020'});
