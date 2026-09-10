import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
const root = process.cwd(), repo = path.resolve(root, '../..');
const testBundle = await build({entryPoints: ['tests/browser-entry.js'], bundle: true, format: 'esm', platform: 'browser',
  inject: ['src/review/buffer-shim.js'], write: false});
http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/test-api.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(testBundle.outputFiles[0].contents); return; }
    const file = url.pathname === '/original.mdpkg' ? path.join(repo, 'docs/spec/review-fixtures/original.mdpkg') :
      path.resolve(root, 'dist', '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (file !== path.join(repo, 'docs/spec/review-fixtures/original.mdpkg') && !file.startsWith(path.join(root, 'dist') + path.sep)) throw Error('Path');
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    response.end(await fs.readFile(file));
  } catch { response.writeHead(404); response.end(); }
}).listen(8138, '127.0.0.1');
