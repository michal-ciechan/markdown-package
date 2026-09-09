// App build: esbuild, minified, tree-shaken ESM, gzip level 9 — the same
// method docs/investigations/viewer-app/build_web.mjs used to measure the
// library slices, so the app's report stays comparable to those numbers.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';

const root = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(root, 'dist');

const result = await build({
  entryPoints: [path.join(root, 'src/main.js')],
  outdir,
  bundle: true,
  minify: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  metafile: true,
});

const chunks = [];
for (const file of Object.keys(result.metafile.outputs)) {
  const bytes = await fs.readFile(path.join(root, file));
  chunks.push({
    file: path.relative(root, file),
    bytes: bytes.length,
    gzip_bytes: gzipSync(bytes, {level: 9}).length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

const report = {esbuild: (await import('esbuild/package.json', {with: {type: 'json'}})).default.version, chunks};
await fs.writeFile(path.join(outdir, 'build-report.json'), JSON.stringify(report, null, 2) + '\n');
console.table(chunks.map(({sha256, ...rest}) => rest));
