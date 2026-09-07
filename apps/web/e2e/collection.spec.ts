import { expect, test } from '@playwright/test';

test.describe('collection: starter and packs', () => {
  test.describe.configure({ timeout: 120_000 });

  test('claim starter, browse the book, and open a pack', async ({ page }) => {
    await page.goto('/collection');
    await expect(page.getByRole('heading', { name: 'Collection' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Claim starter' })).toBeVisible();

    await page.getByRole('button', { name: 'Claim starter' }).click();
    await expect(page.getByRole('heading', { name: 'Starter claimed' })).toBeVisible();
    await expect(page.getByText('Five cards added')).toBeVisible();

    await expect(page.getByText(/of \d+ cards/)).toBeVisible();
    await page.getByPlaceholder('Search players').fill('Jordan');
    await expect(page.getByText(/of \d+ cards/)).toBeVisible();
    await page.getByPlaceholder('Search players').fill('');

    await page.getByRole('link', { name: 'Packs' }).click();
    await expect(page.getByRole('heading', { name: 'Pack store' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Open for 100 Coins/ })).toBeVisible();

    await page.getByRole('button', { name: /Open for 100 Coins/ }).click();
    await expect(page.getByRole('heading', { name: 'Pack opened' })).toBeVisible();
    await expect(page.getByText('balances now')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Pack opened' })).toBeVisible();
  });
});
