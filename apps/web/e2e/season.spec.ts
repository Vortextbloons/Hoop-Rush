import { expect, test } from '@playwright/test';
import { DraftPlanner, draftOneRound } from './season-helpers';

const planner = new DraftPlanner();

test.describe('season run: draft smoke', () => {
  test.describe.configure({ timeout: 120_000 });

  test(
    'home card, first-round pick, and resume after reload',
    { tag: '@smoke' },
    async ({ page }) => {
      await page.goto('/');
      await page.getByRole('link', { name: /Start season run/ }).click();
      await expect(page).toHaveURL(/\/season\/?$/);
      await expect(page.getByRole('heading', { name: 'Draft 10. Coach 82.' })).toBeVisible();

      await page.getByRole('radio').first().click();
      await page.getByRole('button', { name: 'Start draft' }).click();
      await expect(page.locator('[data-season-round-heading]')).toBeVisible();
      planner.reset();
      await draftOneRound(page, planner);
      await expect(page.getByRole('heading', { name: /Your roster/ })).toBeVisible();
      await expect(page.getByText('1/10')).toBeVisible();

      await page.reload();
      await expect(page.getByRole('button', { name: 'Resume draft' })).toBeVisible();
      await page.getByRole('button', { name: 'Resume draft' }).click();
      await expect(
        page.locator('[data-season-round-heading]', { hasText: 'Round 2 of 10' }),
      ).toBeVisible();
      await expect(page.getByText('1/10')).toBeVisible();
    },
  );
});
