import { expect, test } from '@playwright/test';
import { DraftPlanner, draftOneRound } from './season-helpers';

/**
 * Season Run M2.3.5 draft smoke (season-draft-v2): home -> /season -> start
 * the ten-round global eight-card draft, pick one feasibility-safe offer,
 * and verify the draft persists across a reload. The journey stops after the
 * first round instead of running the full ten-round draft, AI generation,
 * and promotion (covered by engine and persistence unit tests). The block
 * worker is never needed here: no block is submitted.
 */

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
      await expect(page.getByRole('heading', { name: 'Ten rounds. One league.' })).toBeVisible();

      await page.getByRole('button', { name: 'Start draft' }).click();
      await expect(page.locator('[data-season-round-heading]')).toBeVisible();
      planner.reset();
      await draftOneRound(page, planner);
      await expect(page.getByText('1 of 10 picked')).toBeVisible();

      // The draft persists across a reload.
      await page.reload();
      await expect(page.getByRole('button', { name: 'Resume draft' })).toBeVisible();
      await page.getByRole('button', { name: 'Resume draft' }).click();
      await expect(
        page.locator('[data-season-round-heading]', { hasText: 'Round 2 of 10' }),
      ).toBeVisible();
      await expect(page.getByText('1 of 10 picked')).toBeVisible();
    },
  );
});
