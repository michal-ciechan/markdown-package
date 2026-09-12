import {test, expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

// The acceptance driver supplies freshly CLI-created packages, never a cached
// browser export. Ordinary browser runs exercise the committed snapshot matrix.
const directory = process.env.MDPKG_ACCEPTANCE_DIR;
for (const mode of ['snapshot', 'git']) test('CLI to browser review: ' + mode, async ({page}) => {
  test.skip(!directory, 'Run tests/prove-deferred-history.py to supply CLI inputs.');
  await page.goto('/');
  await page.locator('#package-file').setInputFiles(path.join(directory, mode + '.mdpkg'));
  await expect(page.locator('.document-title')).toHaveText('guide.md');
  await page.evaluate(() => {
    const node = document.querySelector('.markdown > p').firstChild;
    const start = node.data.indexOf('target words'), range = document.createRange();
    range.setStart(node, start); range.setEnd(node, start + 12);
    getSelection().removeAllRanges(); getSelection().addRange(range);
  });
  await page.getByRole('button', {name: 'Review selected text', exact: true}).click();
  await page.getByLabel('Your name').fill('Integration Reviewer');
  await page.getByLabel('Kind', {exact: true}).selectOption('change-request');
  await page.getByLabel('Feedback', {exact: true}).fill('Explain these words.');
  await page.getByRole('button', {name: 'Save comment', exact: true}).click();
  await expect(page.locator('.review-thread')).toHaveCount(1);
  await page.getByRole('button', {name: 'Prepare review file', exact: true}).click();
  const button = page.getByRole('button', {name: 'Download review', exact: true});
  await expect(button).toBeVisible();
  const pending = page.waitForEvent('download'); await button.click();
  const output = path.join(directory, mode + '-review.mdpkg');
  await (await pending).saveAs(output);
  const observed = await page.evaluate(async bytes => {
    const {openPackage, readComments} = await import('/test-api.js');
    const pkg = await openPackage(new Blob([new Uint8Array(bytes)]));
    await pkg.verifySnapshot();
    return {manifest: pkg.manifest, comments: readComments(await pkg.read(pkg.manifest.review.detail)), assurance: pkg.assurance};
  }, [...await fs.readFile(output)]);
  expect(observed.assurance).toBe('snapshot-verified');
  expect(observed.manifest.review.of.current.kind).toBe(mode === 'git' ? 'commit' : 'snapshot');
  await fs.writeFile(path.join(directory, mode + '-browser.json'), JSON.stringify(observed, null, 2) + '\n');
});
