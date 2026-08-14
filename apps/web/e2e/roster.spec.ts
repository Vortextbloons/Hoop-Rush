import { expect, test } from '@playwright/test';

/**
 * Roster browser smoke: the page lists every eligible peak player-season
 * from the global players index, organized by team then decade. Filtering,
 * search, sorting, detail dialogs, paging, and the mobile card layout are
 * covered by unit tests.
 *
 * Assertions are data-agnostic: player counts, group sizes, and exact stat
 * values change whenever the packaged dataset is re-imported, so journeys
 * match structure and ordering instead of hard-coded numbers.
 */

test.describe('roster browser smoke', () => {
  test(
    'loads the whole dataset grouped by team then decade',
    { tag: '@smoke' },
    async ({ page }) => {
      await page.goto('/roster');
      await expect(page.getByRole('heading', { name: 'Player database' })).toBeVisible();
      await expect(page.getByText(/^[\d,]+ players$/)).toBeVisible();

      // Default organization ("None") begins with a group header followed by
      // player rows. Avoid pinning this to a particular import order or team.
      const rows = page.locator('tbody tr');
      await expect(rows.first()).toContainText(/· \d{4}s ·\s*\d+\s*players/i);
      // Player rows are row-buttons carrying the view action.
      await expect(page.locator('tbody tr[role="button"]').first()).toHaveAttribute(
        'aria-label',
        /View .+ stats/,
      );
    },
  );
});
