// Browser delivery cost of each viewer capability, measured the same way as
// history/build_web.mjs: exact minified, tree-shaken ESM bundles, gzip level 9.
// No worker assets, no WASM, no UI, no persistent filesystem.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';

const work = path.resolve('.antiphon/viewer-work');
const require = createRequire(path.join(work, 'js/package.json'));
const {build} = require('esbuild');
const shim = path.join(work, 'buffer-shim.js');
await fs.writeFile(shim, "export { Buffer } from './js/node_modules/buffer/index.js';\n");

const ZIP = './js/node_modules/@zip.js/zip.js';
const SLICES = [
  ['zip-read-native', `export { ZipReader, BlobReader, HttpRangeReader, Uint8ArrayWriter, TextWriter, configure } from '${ZIP}/index-native.js';`],
  ['zip-readwrite-native', `export { ZipReader, ZipWriter, BlobReader, BlobWriter, HttpRangeReader, Uint8ArrayReader, Uint8ArrayWriter, TextReader, TextWriter, configure } from '${ZIP}/index-native.js';`],
  ['zip-read-wasm-fallback', `export { ZipReader, BlobReader, HttpRangeReader, Uint8ArrayWriter, TextWriter, configure } from '${ZIP}/index.js';`],
  ['fflate-unzip', "export { unzipSync } from './js/node_modules/fflate/esm/browser.js';"],
  ['fflate-zip-unzip', "export { zipSync, unzipSync } from './js/node_modules/fflate/esm/browser.js';"],
  ['commonmark-parse', "export { Parser } from './js/node_modules/commonmark/lib/index.js';"],
  ['commonmark-parse-render', "export { Parser, HtmlRenderer } from './js/node_modules/commonmark/lib/index.js';"],
  ['git-read', "export { log, readBlob } from './js/node_modules/isomorphic-git/index.js';"],
  ['git-write-review', "export { init, writeBlob, writeTree, writeCommit, writeRef, packObjects, indexPack } from './js/node_modules/isomorphic-git/index.js';"],
  ['mdpkg-minimal-reader', "export * from '../../docs/investigations/viewer-app/mdpkg_reader.mjs';"],
  ['mdpkg-minimal-writer', "export * from '../../docs/investigations/viewer-app/mdpkg_writer.mjs';"],
];

const results = [];
for (const [name, source] of SLICES) {
  const entry = path.join(work, name + '-entry.js');
  await fs.writeFile(entry, source + '\n');
  const outfile = path.join(work, name + '.js');
  // The Buffer shim is injected only where isomorphic-git needs it, and its
  // bytes are counted in those slices, as history/build_web.mjs counts them.
  const r = await build({entryPoints: [entry], outfile, bundle: true, minify: true, format: 'esm',
    platform: 'browser', target: 'es2020', metafile: true,
    inject: name.startsWith('git-') ? [shim] : []});
  const bytes = await fs.readFile(outfile);
  results.push({name, entry_source: source, bytes: bytes.length,
    gzip_bytes: gzipSync(bytes, {level: 9}).length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    input_count: Object.keys(r.metafile.inputs).length});
}

const v = p => JSON.parse(require('node:fs').readFileSync(path.join(work, 'js/node_modules', p, 'package.json'), 'utf8')).version;
await fs.writeFile('docs/investigations/viewer-app/bundle-results.json', JSON.stringify({
  node: process.version, esbuild: require('esbuild/package.json').version,
  versions: {'@zip.js/zip.js': v('@zip.js/zip.js'), fflate: v('fflate'), commonmark: v('commonmark'),
    'isomorphic-git': v('isomorphic-git'), buffer: v('buffer')},
  assets: results}, null, 2) + '\n');
console.table(results.map(({entry_source, sha256, ...rest}) => rest));
