export async function fillAuthor(page, value) {
  const input = page.getByLabel('Your name');
  if (!await input.isVisible()) await page.getByRole('button', {name: /^Edit name:/}).click();
  await input.fill(value);
}
