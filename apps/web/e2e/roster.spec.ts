import { expect, test, type Page } from '@playwright/test';

/**
 * Roster browser journey: the page lists every eligible peak player-season
 * from the global players index, filtered by franchise and decade, organized
 * by sort mode ('None' groups by team then decade), searched by name and
 * position, and inspected through a full-stat detail dialog.
 *
 * Assertions are data-agnostic: player counts, group sizes, and exact stat
 * values change whenever the packaged dataset is re-imported, so journeys
 * match structure and ordering instead of hard-coded numbers.
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
    await expect(page.getByText(/^[\d,]+ players$/)).toBeVisible();

    // Default organization ("None") groups by franchise then decade in pool order.
    // The header cell wraps before its count, so match the stable prefix and
    // check the player row below it.
    await expect(page.locator('tbody').getByText(/POR · 1990s/i)).toBeVisible();
    await expect(
      page
        .locator('tbody')
        .getByRole('button', { name: /View Walt Williams stats/ })
        .filter({ hasText: 'POR' }),
    ).toBeVisible();
  });

  test('filters by franchise and decade', async ({ page }) => {
    await filterLakers1990s(page);
    await expect(
      page.locator('tbody').getByRole('button', { name: /View Shaquille O'Neal stats/ }),
    ).toBeVisible();

    // The filtered count matches the filtered pool's group header.
    const header = page.locator('tbody').getByText(/LAL · 1990s/i);
    await expect(header).toBeVisible();
    const headerCount = (await header.innerText()).match(/(\d+) players/i)?.[1] ?? '';
    await expect(page.getByText(/^[\d,]+ players$/)).toHaveText(`${headerCount} players`);

    // Clearing the decade filter widens the view to every Lakers era.
    await page.getByLabel('Decade').click();
    await page.getByRole('option', { name: 'Any decade' }).click();
    await expect(page.locator('tbody').getByText(/LAL · 1990s/i)).toBeVisible();
  });

  test('searches by name and filters by position', async ({ page }) => {
    await page.goto('/roster');
    await page.getByLabel('Search players by name').fill('jordan');
    // The index carries Jordan's Chicago peaks from both the 1980s and 1990s.
    await expect(
      page
        .locator('tbody tr')
        .filter({ hasText: /Michael Jordan/ })
        .filter({ hasText: /1990s/ }),
    ).toBeVisible();

    // Point-guard positions keep Shaq out of the Lakers 1990s pool, PG keeps him excluded.
    await filterLakers1990s(page);
    await page.getByRole('button', { name: 'PG', exact: true }).click();
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

    // Highest overall first: every row's overall (column index 4) is ordered.
    const overallOf = (row: number) =>
      page
        .locator('tbody tr')
        .nth(row)
        .locator('td')
        .nth(4)
        .innerText()
        .then((text) => Number(text.trim()));
    const first = await overallOf(0);
    const second = await overallOf(1);
    expect(first).toBeGreaterThanOrEqual(second);

    // Flipping the direction puts the lowest-rated player first.
    await page.getByRole('button', { name: 'Sort direction: descending' }).click();
    await expect(page.getByRole('button', { name: 'Sort direction: ascending' })).toBeVisible();
    const firstAsc = await overallOf(0);
    const secondAsc = await overallOf(1);
    expect(firstAsc).toBeLessThanOrEqual(secondAsc);
  });

  test('opens a player detail with per-game and advanced stats', async ({ page }) => {
    await page.goto('/roster');
    await page
      .locator('tbody')
      .getByRole('button', { name: /View Walt Williams stats/ })
      .filter({ hasText: 'POR' })
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Walt Williams' })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Per game' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Shooting' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Advanced' })).toBeVisible();
    await expect(page.getByRole('dialog').getByText('Points', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('opens the player detail from the keyboard', async ({ page }) => {
    await page.goto('/roster');
    const row = page
      .locator('tbody')
      .getByRole('button', { name: /View Walt Williams stats/ })
      .filter({ hasText: 'POR' });
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('reveals more players in pages', async ({ page }) => {
    await page.goto('/roster');
    await expect(page.getByText(/^Showing [\d,]+ of [\d,]+ players$/)).toBeVisible();
    await page.getByRole('button', { name: 'Show 120 more' }).click();
    await expect(page.getByText(/^Showing 240 of [\d,]+ players$/)).toBeVisible();
  });

  test('mobile layout uses compact cards', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/roster');
    await expect(page.getByText(/^[\d,]+ players$/)).toBeVisible();

    const card = page
      .locator('ul')
      .getByRole('button', { name: /View Walt Williams stats/ })
      .filter({ hasText: 'POR' });
    await expect(card).toContainText('POR');
    await card.click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
