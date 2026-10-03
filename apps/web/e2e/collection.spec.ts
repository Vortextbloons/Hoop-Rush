import { expect, test } from '@playwright/test';

test.describe('collection: starter and packs', () => {
  test.describe.configure({ timeout: 120_000 });

  test('claim starter, browse the book, and open a pack', async ({ page }) => {
    await page.goto('/collection');
    await expect(page.getByRole('heading', { name: 'Collection' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Claim starter' })).toBeVisible();

    await page.getByRole('button', { name: 'Claim starter' }).click();
    await expect(page.getByRole('heading', { name: 'Five cards added' })).toBeVisible();

    await expect(page.getByText(/of \d+ cards/)).toBeVisible();
    await page.getByPlaceholder('Search players').fill('Jordan');
    await expect(page.getByText(/of \d+ cards/)).toBeVisible();
    await page.getByPlaceholder('Search players').fill('');

    await page.getByRole('link', { name: 'Packs' }).click();
    await expect(page.getByRole('heading', { name: 'Choose a pack' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Open for 100 Coins/ })).toBeVisible();

    await page.getByRole('button', { name: /Open for 100 Coins/ }).click();
    await expect(page.getByRole('button', { name: 'Skip' })).toBeFocused();
    await page.getByRole('button', { name: 'Skip' }).click();
    await expect(page.getByRole('heading', { name: 'Pack opened' })).toBeVisible();
    await expect(page.getByText('Coins now')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Pack opened' })).toBeVisible();
    await page.getByRole('button', { name: 'Take cards' }).click();

    await page.getByRole('button', { name: /Open for 300 Coins/ }).click();
    await page.getByRole('button', { name: 'Show all cards' }).click();
    await expect(page.getByRole('heading', { name: 'Pack opened' })).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Cards in this pack' }).getByRole('listitem'),
    ).toHaveCount(3);
    await page.getByRole('button', { name: 'Take cards' }).click();
  });

  test('reveal waits for the player and advances to the haul', async ({ page }) => {
    await page.goto('/collection');
    await page.getByRole('button', { name: 'Claim starter' }).click();
    await expect(page.getByRole('heading', { name: 'Five cards added' })).toBeVisible();
    await page.getByRole('link', { name: 'Packs' }).click();
    await page.getByRole('button', { name: /Open for 300 Coins/ }).click();
    const stage = page.locator('.ur-reveal-stage');
    await expect(stage).toHaveAttribute('data-stage', 'opening');
    const next = page.getByRole('button', { name: 'Next card' });
    await expect(next).toBeFocused();
    await expect(stage).toHaveAttribute('aria-label', 'Card 1 of 3');
    await page.waitForTimeout(1500);
    await expect(stage).toHaveAttribute('data-stage', 'revealed');
    await next.press('Enter');
    await expect(stage).toHaveAttribute('aria-label', 'Card 2 of 3');
    await expect(next).toBeFocused();
    await next.press('Enter');
    const haul = page.getByRole('button', { name: 'See your haul' });
    await expect(haul).toBeFocused();
    await haul.press('Enter');
    await expect(page.getByRole('button', { name: 'Take cards' })).toBeFocused();
    await expect(
      page.getByRole('list', { name: 'Cards in this pack' }).getByRole('listitem'),
    ).toHaveCount(3);
  });

  test('reduced motion opens directly to the haul', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/collection');
    await page.getByRole('button', { name: 'Claim starter' }).click();
    await expect(page.getByRole('heading', { name: 'Five cards added' })).toBeVisible();
    await page.getByRole('link', { name: 'Packs' }).click();
    await page.getByRole('button', { name: /Open for 100 Coins/ }).click();
    await expect(page.getByRole('heading', { name: 'Pack opened' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Take cards' })).toBeFocused();
    await expect(page.locator('.ur-reveal-stage')).toHaveCount(0);
  });
});
