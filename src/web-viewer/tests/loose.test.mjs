import {test} from 'node:test';
import assert from 'node:assert/strict';
import {synthesizeLoose, looseNamespace, MAX_LOOSE_BYTES} from '../src/inbound/loose.js';
import {openContainer} from '../src/container/reader.js';
import {bytesSource} from '../src/container/source.js';
import {openPackage} from '../src/inbound/open.js';
import {UUID, MANIFEST, utf8, decode} from '../src/format.js';
import {referenceFor} from '../src/address/resolve.js';

const SMALL = '# Notes\n\nSome prose that carries a reference target.\n\n## Section two\n\nMore prose.\n';
const bytes = text => utf8.encode(text);
const blob = value => new Blob([value]);

// Every case opens the synthesized bytes through the real container reader: a
// synthesized loose file must be indistinguishable from a packed snapshot.
async function open(text, name = 'notes.md', identity = name) {
  const packaged = await synthesizeLoose(text instanceof Uint8Array ? text : bytes(text), name, {identity});
  const container = await openContainer(bytesSource(packaged));
  return {packaged, container};
}

test('L1 a normal .md synthesizes a conforming snapshot with no findings', async () => {
  const {packaged, container} = await open(SMALL);
  assert.equal(container.tier, 'conforming');
  assert.deepEqual(container.issues, []);
  assert.equal(container.entries.length, 2);
  assert.equal(container.manifest.history.mode, 'none');
  assert.equal(container.manifest.current.kind, 'snapshot');
  assert.match(container.manifest.current.id, /^sha256-[a-f0-9]{64}$/);
  assert.match(container.manifest.namespace, UUID);
  assert.equal(container.manifest.addressing.coverage, 'complete');
  assert.equal(container.manifest.addressing.overrides, null);
  assert.equal(container.manifest.review, undefined);
  const verified = await container.verifySnapshot();
  assert.equal(verified.assurance, 'snapshot-verified');
  // The document survives byte-for-byte and outlines as ordinary Markdown.
  assert.equal(decode(await container.read('notes.md')), SMALL);
  const pkg = await openPackage(blob(packaged));
  assert.deepEqual(pkg.documents.map(entry => entry.name), ['notes.md']);
  const model = await pkg.document('notes.md');
  assert.deepEqual(model.scopes.map(scope => scope.kind), ['document', 'preamble', 'section', 'section']);
  assert.deepEqual(model.scopes.filter(scope => scope.kind === 'section').map(scope => scope.title), ['# Notes', '## Section two']);
  // A generated reference resolves against the synthesized package.
  const reference = await referenceFor(pkg, model, model.scopes[2]);
  const resolved = await pkg.resolve(reference);
  assert.equal(resolved.status, 'survives');
  assert.equal(resolved.reason, 'same-source');
});

test('L2 CRLF and lone CR are normalized to LF before hashing', async () => {
  // snapshotIdentity rejects any CR outright, so normalization is mandatory,
  // not cosmetic: without it synthesis throws instead of producing a package.
  const {container} = await open('# Notes\r\n\r\nProse.\r\nMore.\rTail.\r\n');
  assert.equal(decode(await container.read('notes.md')), '# Notes\n\nProse.\nMore.\nTail.\n');
  assert.equal((await container.verifySnapshot()).assurance, 'snapshot-verified');
  // The normalized file is the same snapshot as the LF original: identity is
  // over the LF text, per the cm0312-source-lf-v1 digest profile.
  const lf = await open('# Notes\n\nProse.\nMore.\nTail.\n');
  assert.equal(container.manifest.current.id, lf.container.manifest.current.id);
});

test('L3 a leading UTF-8 BOM is STRIPPED, so the first heading stays a heading', async () => {
  // Decision (doc 5.3): strip. Keeping the BOM is spec-faithful but CommonMark
  // reads U+FEFF as text, which yields a document with no sections at all.
  const {packaged, container} = await open(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(SMALL)]));
  const text = decode(await container.read('notes.md'));
  assert.equal(text, SMALL);
  assert.ok(!text.startsWith('\ufeff'));
  assert.equal((await container.verifySnapshot()).assurance, 'snapshot-verified');
  const model = await (await openPackage(blob(packaged))).document('notes.md');
  assert.deepEqual(model.scopes.filter(scope => scope.kind === 'section').map(scope => scope.title), ['# Notes', '## Section two']);
  // Only a leading BOM goes; an interior U+FEFF is ordinary source.
  const interior = await open('# Notes\n\nPro\ufeffse.\n');
  assert.ok(decode(await interior.container.read('notes.md')).includes('\ufeff'));
});

test('L4 a reserved basename is refused', async () => {
  await assert.rejects(open(SMALL, '.mdpkg', '.mdpkg'), /Reserved package path/);
  await assert.rejects(open(SMALL, '.git', '.git'), /Reserved package path/);
  // The reserved rule is a prefix rule, not an equality rule.
  await assert.rejects(open(SMALL, '.mdpkg/manifest.json', '.mdpkg/manifest.json'), /Reserved package path|Ambiguous/);
  // A name that merely starts with those characters is fine.
  assert.equal((await open(SMALL, '.mdpkg.md', '.mdpkg.md')).container.tier, 'conforming');
});

// The three measured sizes of doc 2.2. 10 MiB is exercised for synthesis and
// container shape only: its cost is CommonMark parsing, which is unchanged
// behaviour and already covered by the packaged path.
for (const [label, size, outline] of [['small 16 KiB', 16 * 1024, true], ['medium 1 MiB', 1024 * 1024, true], ['large 10 MiB', 10 * 1024 * 1024, false]])
  test('L5 shape holds at ' + label, async () => {
    const body = 'Filler prose line that is long enough to be realistic.\n';
    const text = '# Generated\n\n' + body.repeat(Math.ceil(size / body.length)) + '\n## Tail\n\nEnd.\n';
    const {packaged, container} = await open(text, 'generated.md');
    assert.equal(container.tier, 'conforming');
    assert.deepEqual(container.issues, []);
    assert.equal(container.entries.length, 2);
    assert.equal((await container.verifySnapshot()).assurance, 'snapshot-verified');
    assert.equal(decode(await container.read('generated.md')), text);
    if (!outline) return;
    const model = await (await openPackage(blob(packaged))).document('generated.md');
    assert.deepEqual(model.scopes.filter(scope => scope.kind === 'section').map(scope => scope.title), ['# Generated', '## Tail']);
  });

test('L6 the namespace is a stable, identity-derived lowercase UUIDv8', async () => {
  const value = await looseNamespace('notes.md');
  assert.match(value, UUID);
  assert.equal(value, value.toLowerCase());
  assert.equal(value[14], '8', 'version nibble is 8');
  assert.ok('89ab'.includes(value[19]), 'RFC 4122 variant nibble');
  assert.equal(value, await looseNamespace('notes.md'));
  assert.notEqual(value, await looseNamespace('other.md'));
  // Same identity, different content: the namespace must survive an edit, or
  // resume and the native watcher's identity gate both break.
  const first = await open('# One\n', 'notes.md');
  const second = await open('# One\n\nEdited.\n', 'notes.md');
  assert.equal(first.container.manifest.namespace, value);
  assert.equal(second.container.manifest.namespace, value);
  assert.notEqual(first.container.manifest.current.id, second.container.manifest.current.id);
  // Identity is the caller's, not the document path: the native shell supplies
  // an absolute path for the same file name.
  const native = await synthesizeLoose(bytes('# One\n'), 'notes.md', {identity: 'C:/docs/notes.md'});
  const opened = await openContainer(bytesSource(native));
  assert.equal(opened.manifest.namespace, await looseNamespace('C:/docs/notes.md'));
  assert.notEqual(opened.manifest.namespace, value);
});

test('L7 identity is required and bytes are required', async () => {
  await assert.rejects(synthesizeLoose(bytes(SMALL), 'notes.md'), /requires an identity/);
  await assert.rejects(synthesizeLoose(bytes(SMALL), 'notes.md', {}), /requires an identity/);
  await assert.rejects(synthesizeLoose(bytes(SMALL), 'notes.md', {identity: ''}), /requires an identity/);
  await assert.rejects(looseNamespace(undefined), /requires an identity/);
  await assert.rejects(synthesizeLoose(SMALL, 'notes.md', {identity: 'notes.md'}), /supplied as bytes/);
});

test('L8 non-UTF-8 input and oversized input are refused', async () => {
  await assert.rejects(synthesizeLoose(new Uint8Array([0x23, 0x20, 0xff, 0xfe, 0x0a]), 'latin1.md', {identity: 'latin1.md'}), /not UTF-8 text/);
  const oversized = Object.create(Uint8Array.prototype, {length: {value: MAX_LOOSE_BYTES + 1}});
  await assert.rejects(synthesizeLoose(oversized, 'huge.md', {identity: 'huge.md'}), /too large/);
});

test('L9 an empty file and an unnamed file still open', async () => {
  const empty = await open('', 'empty.md');
  assert.equal(empty.container.tier, 'conforming');
  assert.equal((await empty.container.verifySnapshot()).assurance, 'snapshot-verified');
  const unnamed = await synthesizeLoose(bytes(SMALL), '', {identity: 'document.md'});
  const opened = await openContainer(bytesSource(unnamed));
  assert.deepEqual(opened.entries.filter(entry => entry.name !== MANIFEST).map(entry => entry.name), ['document.md']);
});
