import { expect, test, type Page } from '@playwright/test';

/**
 * Roster browser journey: the page lists every eligible peak player-season
 * from the global players index, filtered by franchise and decade, organized
 * by sort mode ('None' groups by team then decade), searched by name and
 * position, and inspected through a full-stat detail dialog.
 */

/** Narrow the roster browser to the Lakers 1990s pool. */
async function filterLakers1990s(page: Page) {
  await page.goto('/roster');
  await page.getByLabel('Franchise').click();
  await page.getByRole('option', { name: /Los Angeles Lakers/ }).click();
  await page.getByLabel('Decade').click();
  await page.getByRole('option', { name: '1990s', exact: true }).click();
}

test.describe('roster browser', () => {
  test('loads the whole dataset grouped by team then decade', async ({ page }) => {
    await page.goto('/roster');
    await expect(page.getByRole('heading', { name: 'Player database' })).toBeVisible();
    await expect(page.getByText('5,324 players', { exact: true })).toBeVisible();

    // Default organization ("None") groups by franchise then decade in pool order.
    await expect(page.locator('tbody').getByText('POR · 1990s · 42 players')).toBeVisible();
    await expect(
      page.locator('tbody').getByRole('button', { name: /View Walt Williams stats/ }),
    ).toBeVisible();
  });

  test('filters by franchise and decade', async ({ page }) => {
    await filterLakers1990s(page);
    await expect(page.getByText('44 players', { exact: true })).toBeVisible();
    await expect(
      page.locator('tbody').getByRole('button', { name: /View Shaquille O'Neal stats/ }),
    ).toBeVisible();

    // Clearing the decade filter widens the view to every Lakers era.
    await page.getByLabel('Decade').click();
    await page.getByRole('option', { name: 'Any decade' }).click();
    await expect(page.locator('tbody').getByText('LAL · 1990s · 44 players')).toBeVisible();
  });

  test('searches by name and filters by position', async ({ page }) => {
    await page.goto('/roster');
    await page.getByLabel('Search players by name').fill('jordan');
    await expect(
      page
        .locator('tbody')
        .getByRole('button', { name: /View Michael Jordan stats/ })
        .filter({ hasText: 'CHI' }),
    ).toBeVisible();

    // Guard positions keep Shaq in the Lakers 1990s pool, G excludes him.
    await filterLakers1990s(page);
    await page.getByRole('button', { name: 'G', exact: true }).click();
    await expect(
      page.locator('tbody').getByRole('button', { name: /View Magic Johnson stats/ }),
    ).toBeVisible();
    await expect(
      page.locator('tbody').getByRole('button', { name: /View Shaquille O'Neal stats/ }),
    ).toHaveCount(0);
  });

  test('sorts by overall rating', async ({ page }) => {
    await page.goto('/roster');
    await page.getByRole('button', { name: 'Overall', exact: true }).click();

    // Highest overall first (84, tied, broken by name).
    await expect(page.locator('tbody tr').first()).toContainText(/Hakeem Olajuwon/);
    await expect(page.locator('tbody tr').first()).not.toContainText(/Walt Williams/);

    // Toggling the sort flips to ascending: the lowest-rated player comes first.
    await page.getByRole('button', { name: 'Overall', exact: true }).click();
    await expect(page.locator('tbody tr').first()).toContainText(/Michael Bradley/);
    await expect(page.locator('tbody tr').first()).not.toContainText(/Olajuwon/);
  });

  test('opens a player detail with per-game and advanced stats', async ({ page }) => {
    await page.goto('/roster');
    await page
      .locator('tbody')
      .getByRole('button', { name: /View Walt Williams stats/ })
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Walt Williams' })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Per game' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Shooting' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Advanced' })).toBeVisible();
    await expect(page.getByRole('dialog').getByText('8.2', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('opens the player detail from the keyboard', async ({ page }) => {
    await page.goto('/roster');
    const row = page.locator('tbody').getByRole('button', { name: /View Walt Williams stats/ });
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('reveals more players in pages', async ({ page }) => {
    await page.goto('/roster');
    await expect(page.getByText('Showing 120 of 5,324 players')).toBeVisible();
    await page.getByRole('button', { name: 'Show 120 more' }).click();
    await expect(page.getByText('Showing 240 of 5,324 players')).toBeVisible();
  });

  test('mobile layout uses compact cards', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/roster');
    await expect(page.getByText('5,324 players', { exact: true })).toBeVisible();

    const card = page.locator('ul').getByRole('button', { name: /View Walt Williams stats/ });
    await expect(card).toContainText('POR');
    await card.click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
