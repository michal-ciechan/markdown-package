import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
test('regenerated link fixtures retain the single typed-state contract', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mdpkg-links-'));
  try {
    const file = path.join(temporary, 'links.json');
    execFileSync(process.execPath, ['tests/generate-links.mjs', file]);
    const actual = JSON.parse(await fs.readFile(file, 'utf8'));
    const expected = JSON.parse(await fs.readFile(new URL('../../../docs/spec/link-fixtures.json', import.meta.url), 'utf8'));
    assert.deepEqual(actual, expected);
    assert.equal(actual.current.kind, 'commit');
  } finally { await fs.rm(temporary, {recursive: true, force: true}); }
});
