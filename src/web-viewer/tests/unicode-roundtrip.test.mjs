// CARD-0058 / issue #3: cheap precursor to unicode-roundtrip.spec.js. Proves the
// real CLI packs the Unicode fixture byte for byte before any browser is involved.
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {unzipSync} from 'fflate';
import {openPackage} from '../src/inbound/open.js';
import {decode} from '../src/format.js';
import {packFixture, text, entryName, characters, mojibake} from './unicode-fixture-helper.js';

const packed = await packFixture();
const packageBytes = await fs.readFile(packed.output);
after(() => packed.cleanup());
const hex = bytes => Buffer.from(bytes).toString('hex');

test('CARD-0058 fixture is UTF-8 without BOM, LF only, and carries every sequence', () => {
  const {sourceBytes} = packed;
  assert.notEqual(hex(sourceBytes.subarray(0, 3)), 'efbbbf', 'fixture must not start with a BOM');
  assert.equal(sourceBytes.indexOf(0x0d), -1, 'fixture must not contain CR');
  for (const {name, bytes} of characters)
    assert.ok(sourceBytes.includes(Buffer.from(bytes)), `${name} bytes ${hex(bytes)} missing from the fixture`);
  assert.equal(decode(sourceBytes), text);
});

test('CARD-0058 mdpkg pack keeps the Markdown entry byte-identical (independent unzip)', () => {
  assert.equal(packed.report.exitCode, 0);
  assert.equal(packed.report.package.tier, 'conforming');
  assert.deepEqual(packed.report.diagnostics, []);
  const entries = unzipSync(new Uint8Array(packageBytes));
  assert.ok(entryName in entries, `${entryName} missing from ${Object.keys(entries).join(', ')}`);
  assert.equal(hex(entries[entryName]), hex(packed.sourceBytes));
});

test('CARD-0058 viewer container reader returns the identical bytes and text', async () => {
  const opened = await openPackage(new Blob([packageBytes]));
  const bytes = await opened.read(entryName);
  assert.equal(hex(bytes), hex(packed.sourceBytes));
  const decoded = decode(bytes);
  assert.equal(decoded, text);
  for (const signature of mojibake) assert.ok(!decoded.includes(signature), `decoded text contains mojibake ${JSON.stringify(signature)}`);
});
