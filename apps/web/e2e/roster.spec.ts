import { expect, test } from '@playwright/test';

test.describe('roster browser smoke', () => {
  test(
    'loads the whole dataset grouped by team then decade',
    { tag: '@smoke' },
    async ({ page }) => {
      await page.goto('/roster');
      await expect(page.getByRole('heading', { name: 'Player database' })).toBeVisible();
      await expect(page.getByText(/^[\d,]+ players$/)).toBeVisible();

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toContainText(/· \d{4}s ·\s*\d+\s*players/i);

      await expect(page.locator('tbody tr[role="button"]').first()).toHaveAttribute(
        'aria-label',
        /View .+ stats/,
      );
    },
  );
});
