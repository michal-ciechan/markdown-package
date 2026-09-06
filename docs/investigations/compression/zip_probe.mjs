import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { openZip, extraFields } from './zip_tail_reader.mjs';
const out = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(out, '../../..');
const work = path.join(root, '.antiphon/compression-work');
const folder = path.join(work, 'zip');
const require = createRequire(path.join(work, 'js/package.json'));
const { unzipSync, zipSync, inflateSync } = require('fflate');
const sha = b => createHash('sha256').update(b).digest('hex');
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const expected = readJSON(path.join(folder, 'compat-expected.json'));
const result = { versions: { node: process.version, fflate: readJSON(path.join(work, 'js/node_modules/fflate/package.json')).version }, cases: [], range: [], metadata: [] };
for (const name of expected.cases) {
  try {
    const files = unzipSync(fs.readFileSync(path.join(folder, 'compat', name + '.zip')));
    const hashes = Object.fromEntries(Object.entries(files).map(([n, b]) => [n, sha(b)]));
    result.cases.push({ case: name, accepted: JSON.stringify(hashes) === JSON.stringify(expected.hashes), hashes });
  } catch (e) { result.cases.push({ case: name, accepted: false, error: String(e) }); }
}
const rewritten = zipSync(unzipSync(fs.readFileSync(path.join(folder, 'compat/prefix-1-adjusted.zip'))));
fs.writeFileSync(path.join(folder, 'fflate-repacked.zip'), rewritten);
result.rewrite = { file: 'fflate-repacked.zip' };
const serverLog = [];
const server = http.createServer((req, res) => {
  const file = path.resolve(folder, '.' + decodeURIComponent(req.url));
  if (!file.startsWith(folder + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  const bytes = fs.readFileSync(file), etag = '"' + sha(bytes) + '"';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (!range) { res.writeHead(200, { 'Content-Length': bytes.length, ETag: etag }).end(bytes); return; }
  const start = range[1] ? Number(range[1]) : Math.max(0, bytes.length - Number(range[2]));
  const end = range[1] ? Math.min(bytes.length - 1, range[2] ? Number(range[2]) : bytes.length - 1) : bytes.length - 1;
  if (start > end || (req.headers['if-range'] && req.headers['if-range'] !== etag)) { res.writeHead(416).end(); return; }
  serverLog.push({ path: req.url, range: req.headers.range, start, bytes: end - start + 1 });
  res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1, ETag: etag, 'Content-Type': 'application/zip' });
  res.end(bytes.subarray(start, end + 1));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  for (const file of ['normal.zip', 'metadata-maximum.zip', 'comment-false-signature.zip']) {
    const z = await openZip(`${origin}/compat/${file}`);
    const initial = z.wireBytes(), first = z.entries[0];
    const loc = await z.local(first);
    const extra = extraFields(await z.read(first.localOffset + 30 + loc.nameBytes, loc.extraBytes));
    if (file === 'metadata-maximum.zip') {
      assert.equal(z.comment.length, 65535); assert.equal(first.comment.length, 65535);
      assert.equal(first.extra[0].bytes.length, 65531); assert.equal(extra[0].bytes.length, 65531);
    } else if (file === 'normal.zip') {
      assert.equal(new TextDecoder().decode(z.comment), expected.comment);
      assert.equal(new TextDecoder().decode(first.extra[0].bytes), expected.comment);
      assert.equal(first.comment, expected.entry_comment);
    } else { assert.equal(z.entries.length, 1); }
    result.metadata.push({ file, totalBytes: z.total, metadataWireBytes: initial, withLocalExtraWireBytes: z.wireBytes(),
      commentBytes: z.comment.length, centralExtraPayloadBytes: first.extra[0]?.bytes.length || 0,
      localExtraPayloadBytes: extra[0]?.bytes.length || 0, cdBytes: z.cdBytes, requests: z.requests });
  }
  const sizes = readJSON(path.join(out, 'zip-results.json'));
  for (const corpus of sizes.corpora) for (const access of corpus.access.filter(a => a.member)) {
    for (const tailBytes of [65557, 22]) for (const unit of ['document', 'section']) {
      const z = await openZip(`${origin}/${corpus.corpus}/${access.variant}.zip`, tailBytes);
      const metadataBytes = z.wireBytes();
      if (access.mapping_bytes) {
        const idx = z.entries.find(e => e.name === '.mdpkg/blocks.json');
        const il = await z.local(idx);
        const mapping = JSON.parse(new TextDecoder().decode(await z.read(il.dataOffset, idx.compressedBytes)));
        const mapped = mapping.entries.find(e => e[0] === corpus.target.key);
        assert.equal(`blocks/${String(mapped[1]).padStart(4, '0')}.tar.gz`, access.member);
      }
      const entry = z.entries.find(e => e.name === access.member);
      const local = await z.local(entry);
      let start = local.dataOffset, length = entry.compressedBytes;
      if (access.variant === 'zip-stored' && unit === 'section') { start += corpus.target.section.offset; length = corpus.target.section.bytes; }
      const payload = await z.read(start, length);
      const archive = fs.readFileSync(path.join(folder, corpus.corpus, access.variant + '.zip'));
      assert.deepEqual(Buffer.from(payload), archive.subarray(start, start + length));
      let decoded;
      if (entry.method === 8) decoded = inflateSync(payload);
      else if (access.variant === 'zip-stored') decoded = payload;
      // Solid tar/zstd extraction is hash-verified by the Python benchmark.
      // Here every fetched compressed byte is independently compared with the fixture.
      if (decoded) {
        if (unit === 'section' && access.variant !== 'zip-stored') decoded = decoded.subarray(corpus.target.section.offset, corpus.target.section.offset + corpus.target.section.bytes);
        assert.equal(sha(decoded), unit === 'section' ? corpus.target.section.sha256 : corpus.target.sha256);
      }
      result.range.push({ corpus: corpus.corpus, variant: access.variant, unit, tailBytes, totalBytes: z.total,
        metadataWireBytes: metadataBytes, wireBytes: z.wireBytes(), requests: z.requests, payloadVerified: true });
    }
  }
  const shell = readJSON(path.join(out, 'zip-shell-results.json'));
  fs.copyFileSync(shell.ads_source, path.join(folder, 'ads-source.zip'));
  const response = await fetch(`${origin}/ads-source.zip`);
  const download = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(folder, 'http-downloaded.zip'), download);
  assert.equal(sha(download), sha(fs.readFileSync(shell.ads_source)));
  assert.equal(fs.existsSync(path.join(folder, 'http-downloaded.zip:mdpkg.version')), false);
  result.adsHttpTransportSurvives = false;
  result.serverResponses = serverLog.length;
  assert.equal(serverLog.length, result.range.reduce((n, r) => n + r.requests.length, 0) + result.metadata.reduce((n, r) => n + r.requests.length, 0));
  fs.writeFileSync(path.join(out, 'zip-js-results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ prefixCases: result.cases.length, accepted: result.cases.filter(r => r.accepted).length, rangeScenarios: result.range.length, metadataFixtures: result.metadata.length, serverResponses: serverLog.length }));
} finally { await new Promise(resolve => server.close(resolve)); }
