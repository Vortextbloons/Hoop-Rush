import { expect, test } from '@playwright/test';

test('Arm Guard artwork, upgraded ratings, set progress, and Spotlight are available', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/ultimate/run/collection');
  await page.getByRole('button', { name: 'Claim starter' }).click();
  await expect(page.getByRole('heading', { name: '5 cards added' })).toBeVisible();
  await page.getByRole('button', { name: 'Take cards' }).click();
  await page.getByPlaceholder('Search players').fill('Arm Guard');
  const cards = page.locator('.ur-card-grid button.ur-card');
  await expect(cards).toHaveCount(7);
  await expect(page.getByRole('button', { name: /Arm Guard Luka.*Overall 100/ })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Arm Guard Jordan Clarkson.*Overall 92/ }),
  ).toBeVisible();
  const images = cards.locator('img.ur-special-art');
  await expect(images).toHaveCount(7);
  await expect
    .poll(() =>
      images.evaluateAll((elements) =>
        elements.every(
          (element) =>
            element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0,
        ),
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: /Arm Guard Luka.*Overall 100/ }).click();
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Arm Guard Luka Dončić' })).toContainText('94');
  await expect(page.getByRole('dialog', { name: 'Arm Guard Luka Dončić' })).toContainText('+30');
  await page.getByRole('button', { name: 'Close card details' }).click();
  await expect(
    page.getByText('Own all seven Arm Guard cards to claim 2,500 Exchange once.'),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Packs', exact: true }).click();
  await expect(
    page.getByText('One Heat Check or Arm Guard special, Apex or better. Costs Exchange.'),
  ).toBeVisible();
  await expect(page.locator('img.pack-cover-image[src*="arm-guard/luka-doncic"]')).toBeVisible();
});
