export async function fillAuthor(page, value) {
  const input = page.getByLabel('Your name');
  if (!await input.isVisible()) await page.getByRole('button', {name: 'Edit your name', exact: true}).click();
  await input.fill(value);
}
