import {test, expect} from '@playwright/test';
import {packFixture, text, entryName, heading, rendered, mojibake} from './unicode-fixture-helper.js';

// CARD-0058 / issue #3: the real CLI packs a fixture with an em dash, a minus
// sign, emoji and accented/non-Latin text; the browser must show every character
// exactly. unicode-roundtrip.test.mjs is the byte-level precursor to this check.
let packed;
test.beforeAll(async () => {
  test.setTimeout(300_000); // a cold Release build of the CLI, not a widened assertion window
  packed = await packFixture();
});
test.afterAll(async () => { await packed?.cleanup(); });

test('CLI-packed Unicode renders exactly in the browser', async ({page}) => {
  await page.goto('/');
  await page.locator('#package-file').setInputFiles(packed.output);
  await expect(page.locator('.document-title')).toHaveText(entryName);
  const article = page.locator('#reader article.markdown');
  expect(await article.locator('h1').textContent()).toBe(heading);
  const paragraphs = article.locator('p');
  await expect(paragraphs).toHaveCount(rendered.length);
  for (const [index, expected] of rendered.entries()) expect(await paragraphs.nth(index).textContent()).toBe(expected);
  const shown = await article.textContent();
  for (const signature of mojibake) expect(shown, 'rendered article contains ' + JSON.stringify(signature)).not.toContain(signature);
  // Source view shows the decoded entry verbatim, so it must equal the fixture text.
  await page.getByRole('button', {name: 'View source', exact: true}).click();
  expect(await article.locator('pre code').textContent()).toBe(text);
});
