// Write path: can a page, with no server and no native Git, produce a
// `delta`-shape review package (review-comments.md §7.4) that native Git and
// ordinary ZIP tools accept? Everything here uses APIs a browser has —
// Web Crypto, CompressionStream, TextEncoder — plus isomorphic-git for the
// curated repository. The result is validated by native git outside this file.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import * as mdpkg from './mdpkg_reader.mjs';
import {writePackage} from './mdpkg_writer.mjs';

const work = path.resolve('.antiphon/viewer-work');
const require = createRequire(path.join(work, 'js/package.json'));
const git = require('isomorphic-git');
const {Parser} = require('commonmark');
const {memoryFs} = await import('../history/memory_fs.js');

const ANCHOR = 'cm0312-trail-source-v1', DIGEST = 'cm0312-source-lf-v1';
const SELECTOR = 'cm0312-quote-context-v1';
const enc = new TextEncoder(), dec = new TextDecoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', typeof s === 'string' ? enc.encode(s) : s));
const sortKeys = o => Array.isArray(o) ? o.map(sortKeys)
  : (o && typeof o === 'object') ? Object.fromEntries(Object.keys(o).sort().map(k => [k, sortKeys(o[k])])) : o;
const canonicalJson = o => JSON.stringify(sortKeys(o)) + '\n';
const b64url = s => Buffer.from(s, 'utf8').toString('base64url');
const NUL = String.fromCharCode(0);   // the profile's field separator, kept out of this file's bytes

// §6.1 rule 5.
const canonicalScope = text => {
  const lines = text.split('\n');
  while (lines.length && lines[lines.length - 1].replace(/[ \t]/g, '') === '') lines.pop();
  return lines.length ? lines.join('\n') + '\n' : '';
};
const scopedDigest = (kind, source) => sha256(['mdpkg', DIGEST, kind, canonicalScope(source)].join(NUL));
const defaultRoot = (ns, locator) => sha256(['mdpkg-default', ANCHOR, ns, canonicalJson(locator)].join(NUL));

// §6.1 rules 2-4 over a real CommonMark 0.31.2 parse, not a heading regex.
function outline(text) {
  const lines = text.split('\n');
  const ast = new Parser({smart: false}).parse(text);
  const heads = [];
  for (let w = ast.walker(), ev; (ev = w.next());) {
    const n = ev.node;
    if (ev.entering && n.type === 'heading' && n.parent.type === 'document')
      heads.push({line: n.sourcepos[0][0] - 1, level: n.level});
  }
  const out = [{kind: 'preamble', start: 0, end: heads.length ? heads[0].line : lines.length, trail: []}];
  const trails = [], counts = new Map(), stack = [];
  heads.forEach((h, i) => {
    while (stack.length && heads[stack[stack.length - 1]].level >= h.level) stack.pop();
    let end = lines.length;
    for (let j = i + 1; j < heads.length; j++) if (heads[j].level <= h.level) { end = heads[j].line; break; }
    const parent = stack.length ? trails[stack[stack.length - 1]] : [];
    const title = lines[h.line];
    const key = JSON.stringify([parent, title]);
    const occ = counts.get(key) ?? 0; counts.set(key, occ + 1);
    const trail = [...parent, [title, occ]];
    trails.push(trail); stack.push(i);
    out.push({kind: 'section', start: h.line, end, trail, title});
  });
  for (const s of out) s.source = lines.slice(s.start, s.end).join('\n');
  return out;
}

// review-comments.md §2.4: build a selector from a character range the reader
// obtained from a DOM selection, over the canonical scope source.
function makeSelector(scope, start, end, context = 40) {
  const quote = scope.slice(start, end);
  let occurrence = 0;
  for (let i = scope.indexOf(quote); i >= 0 && i < start; i = scope.indexOf(quote, i + 1)) occurrence++;
  return {start, end, quote, occurrence,
          prefix: scope.slice(Math.max(0, start - context), start),
          suffix: scope.slice(end, Math.min(scope.length, end + context))};
}

const out = {};
const original = new Uint8Array(await fs.readFile(path.join(work, 'fixture/full.mdpkg')));
const src = mdpkg.bytesSource(original);
const eocd = await mdpkg.readEndOfCentralDirectory(src);
const {entries} = await mdpkg.readCentralDirectory(src, eocd);
const read = async name => (await mdpkg.readEntry(src, entries.find(e => e.name === name))).bytes;
const manifest = JSON.parse(dec.decode(await read('.mdpkg/manifest.json')));
const guide = dec.decode(await read('guide.md'));
out.reviewOf = {namespace: manifest.namespace, current: manifest.current,
  packageDigest: 'sha256-' + await sha256(original), packageBytes: original.length};

// Anchor a thread on `## Usage` of guide.md, at a character range inside it.
const secs = outline(guide);
const target = secs.find(s => s.kind === 'section' && s.title === '## Usage');
const scope = canonicalScope(target.source);
const locator = ['section', 'guide.md', target.trail];
const root = await defaultRoot(manifest.namespace, locator);
const expect = await scopedDigest('section', target.source);
const needle = 'produce a package';        // the run of characters the reviewer selected
const at = scope.indexOf(needle);
const select = makeSelector(scope, at, at + needle.length);
out.thread = {locator, root, expect, select, scopeLength: scope.length, scope};

// Cross-check root and digest against the Python emitter's own numbers.
const wexample = await fs.readFile('docs/spec/worked-example.json', 'utf8');
out.crossCheck = {rootAppearsInWorkedExample: wexample.includes(root),
                  digestAppearsInWorkedExample: wexample.includes(expect)};

const comments = {
  version: 1, anchor: ANCHOR, profile: DIGEST, selector: SELECTOR,
  reviewOf: out.reviewOf,
  threads: [{id: '7f1c9b40-0000-4000-8000-000000000001', root, loc: b64url(canonicalJson(locator)),
             expect, state: 'open', select,
             comments: [{id: 'a1000000-0000-4000-8000-000000000001', at: '2026-09-08T10:04:00Z',
                         author: 'reviewer@example.invalid',
                         body: 'This sentence names the scheme without saying which profile resolves it.'}]}]};
const commentsBytes = enc.encode(canonicalJson(comments));
out.commentsBytes = commentsBytes.length;

// The curated repository, built with isomorphic-git in memory: one commit whose
// tree touches only `.mdpkg/review/` (review-comments.md §7.4), then a pack and
// its index.
const fsAdapter = memoryFs([]).fs;
const dir = '/r';
await git.init({fs: fsAdapter, dir, defaultBranch: 'main'});
const blobOid = await git.writeBlob({fs: fsAdapter, dir, blob: commentsBytes});
const reviewTree = await git.writeTree({fs: fsAdapter, dir,
  tree: [{mode: '100644', path: 'comments.json', oid: blobOid, type: 'blob'}]});
const mdpkgTree = await git.writeTree({fs: fsAdapter, dir,
  tree: [{mode: '040000', path: 'review', oid: reviewTree, type: 'tree'}]});
const rootTree = await git.writeTree({fs: fsAdapter, dir,
  tree: [{mode: '040000', path: '.mdpkg', oid: mdpkgTree, type: 'tree'}]});
const author = {name: 'Example Reviewer', email: 'reviewer@example.invalid',
                timestamp: 1757318400, timezoneOffset: 0};
const commitOid = await git.writeCommit({fs: fsAdapter, dir,
  commit: {tree: rootTree, parent: [], author, committer: author, message: 'Review of guide.md\n'}});
await git.writeRef({fs: fsAdapter, dir, ref: 'refs/heads/main', value: commitOid, force: true});
const {packfile, filename} = await git.packObjects({fs: fsAdapter, dir,
  oids: [commitOid, rootTree, mdpkgTree, reviewTree, blobOid]});
const packName = filename.replace(/\.pack$/, '');
await fsAdapter.promises.writeFile(dir + '/.git/objects/pack/' + filename, packfile);
const idxResult = await git.indexPack({fs: fsAdapter, dir, filepath: '.git/objects/pack/' + filename});
const idx = await fsAdapter.promises.readFile(dir + '/.git/objects/pack/' + packName + '.idx');
out.repo = {commit: commitOid, tree: rootTree, packBytes: packfile.length, idxBytes: idx.length,
            packOids: idxResult.oids ? idxResult.oids.length : null};

const reviewManifest = {
  mdpkg: 'markdown-package/1', namespace: 'e9f0a1b2-3c4d-4e5f-9a0b-1c2d3e4f5a6b',
  current: 'sha1-' + commitOid, anchor: ANCHOR, profile: DIGEST,
  review: {of: {namespace: out.reviewOf.namespace, current: out.reviewOf.current,
                packageDigest: out.reviewOf.packageDigest},
           shape: 'delta', detail: '.mdpkg/review/comments.json'}};
// §4: canonical JSON with one exception, the `mdpkg` key written first so the
// magic member lands at byte 50 and §3.1 can type the package in 79 bytes.
const manifestJson = m => '{"mdpkg":' + JSON.stringify(m.mdpkg) + ',' +
  canonicalJson(Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'mdpkg'))).slice(1);
const manifestBytes = enc.encode(manifestJson(reviewManifest));

const pkg = await writePackage([
  {name: '.mdpkg/manifest.json', bytes: manifestBytes, stored: true},
  {name: '.mdpkg/review/comments.json', bytes: commentsBytes},
  {name: '.mdpkg/history.json', bytes: enc.encode(canonicalJson(
     {retained: [{commit: 'sha1-' + commitOid, kind: 'update'}], coverage: 'full'}))},
  {name: '.git/HEAD', bytes: enc.encode('ref: refs/heads/main\n')},
  {name: '.git/config', bytes: enc.encode('[core]\n\trepositoryformatversion = 0\n\tbare = false\n')},
  {name: '.git/refs/heads/main', bytes: enc.encode(commitOid + '\n')},
  {name: '.git/objects/pack/' + packName + '.idx', bytes: new Uint8Array(idx), stored: true},
  {name: '.git/objects/pack/' + packName + '.pack', bytes: new Uint8Array(packfile), stored: true},
]);
out.package = {bytes: pkg.length, sha256: await sha256(pkg)};

const written = path.join(work, 'review-delta.mdpkg');
await fs.writeFile(written, pkg);

// Read it back with the same bounded reader that reads a producer's package.
const back = mdpkg.bytesSource(pkg);
out.selfRead = {typing: await mdpkg.typePackage(back)};
const e2 = await mdpkg.readEndOfCentralDirectory(back);
const cd2 = await mdpkg.readCentralDirectory(back, e2);
out.selfRead.entries = cd2.entries.map(e => ({name: e.name, method: e.method,
  internalAttributes: e.internalAttributes, compressedSize: e.compressedSize, uncompressedSize: e.uncompressedSize}));
const rt = await mdpkg.readEntry(back, cd2.entries.find(e => e.name === '.mdpkg/review/comments.json'));
out.selfRead.commentsRoundTrip = dec.decode(rt.bytes) === canonicalJson(comments);
out.selfRead.eocdCommentLengthZero = !e2.fallback;
out.selfRead.textFlagClearEverywhere = cd2.entries.every(e => (e.internalAttributes & 1) === 0);

const pkgVersion = async n => JSON.parse(await fs.readFile(path.join(work, 'js/node_modules', n, 'package.json'), 'utf8')).version;
out.node = process.version;
out.versions = {'isomorphic-git': await pkgVersion('isomorphic-git'), commonmark: await pkgVersion('commonmark')};
out.writtenTo = written;
await fs.writeFile('docs/investigations/viewer-app/review-probe-results.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 1));
