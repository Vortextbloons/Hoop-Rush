import { expect, test } from '@playwright/test';
import { DraftPlanner, draftOneRound } from './season-helpers';

/**
 * M2.6.5 free-agency market journey (season-free-agency-v1): create a run,
 * complete the ten-round draft, generate the AI league, simulate blocks 0-1,
 * land at the Block-2 market, declare with two ordered targets, reload
 * between declaration and resolution, resolve, verify the human result, and
 * confirm the next block's rotation lock is gated until the market resolves.
 *
 * Block simulation runs through the deterministic e2e fake runner (the
 * authoritative engine-seam folds, exactly like the real worker commits —
 * see fake-season-block-runner.ts); each journey stays a smoke-shortened
 * path to early checkpoints. The draft planner keeps every pick
 * feasibility-safe.
 */

const planner = new DraftPlanner();

/** Locks and simulates the next block through the deterministic e2e runner. */
async function simulateNextBlock(page: import('@playwright/test').Page): Promise<void> {
  const phase = page.locator('[data-block-phase]');
  await expect(phase).toHaveAttribute('data-block-phase', 'ready', { timeout: 30_000 });
  await expect(
    page.getByRole('button', { name: 'Lock rotation and simulate block' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Lock rotation and simulate block' }).click();
  await expect(phase).not.toHaveAttribute('data-block-phase', 'ready', { timeout: 30_000 });
  await expect(phase).toHaveAttribute('data-block-phase', 'ready', { timeout: 300_000 });
}
/** Activates the deterministic e2e block runner before app code runs. */
function useFakeRunner(page: import('@playwright/test').Page) {
  return page.addInitScript(() => {
    window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
  });
}

test.describe('season run: free agency market', () => {
  test.describe.configure({ timeout: 600_000 });

  test(
    'block 2 checkpoint opens the market; declare, reload, resolve, then block 3',
    { tag: '@smoke' },
    async ({ page }) => {
      await useFakeRunner(page);
      await page.goto('/');

      // Create a run and complete the full ten-round draft.
      await page.getByRole('link', { name: /Start season run/ }).click();
      await expect(page).toHaveURL(/\/season\/?$/);
      await expect(page.getByRole('heading', { name: 'Ten rounds. One league.' })).toBeVisible();
      await page.getByRole('button', { name: 'Start draft' }).click();
      await expect(page.locator('[data-season-round-heading]')).toBeVisible();
      planner.reset();
      for (let round = 0; round < 10; round += 1) {
        await draftOneRound(page, planner);
      }
      await expect(page.getByText('10 of 10 picked')).toBeVisible();

      // Finalize the draft, generate the AI league, and enter the command center.
      await page.getByRole('button', { name: 'Finalize my roster' }).click();
      await expect(page.getByRole('button', { name: /Generate AI league/ })).toBeVisible();
      await page.getByRole('button', { name: /Generate AI league/ }).click();
      await expect(page).toHaveURL(/\/season\/run\/?$/);
      await expect(page.locator('[data-block-phase]')).toBeVisible({ timeout: 30_000 });

      // Simulate blocks 0 and 1 (each waits for the fake runner to finish).
      await simulateNextBlock(page);
      await simulateNextBlock(page);

      // The Block-2 checkpoint opened the market: the hub shows the CTA.
      await expect(page.locator('[data-fa-hub-cta]')).toBeVisible({ timeout: 60_000 });
      await page.locator('[data-fa-hub-cta]').click();
      await expect(page).toHaveURL(/\/season\/run\/free-agency/);
      await expect(page.locator('[data-fa-window-open]')).toBeVisible();

      // While unresolved, the market must be resolved before the next lock.
      await page.goto('/season/run');
      await expect(page.locator('[data-fa-unresolved-notice]')).toBeVisible();
      await page.goto('/season/run/free-agency');

      // Declare two ordered targets with committed influence.
      const cards = page.locator('[data-fa-candidate-card]');
      const count = await cards.count();
      expect(count).toBeGreaterThanOrEqual(1);
      await cards.nth(0).locator('[data-fa-candidate-priority]').click();
      if (count > 1) {
        await cards.nth(1).locator('[data-fa-candidate-priority]').click();
      }
      await page.locator('[data-fa-declare-submit]').click();
      await expect(page.locator('[data-fa-review-panel]')).toBeVisible();
      await expect(page.getByText('Declaration submitted')).toBeVisible();

      // Reload between declaration and resolution: the declaration persists.
      await page.reload();
      await expect(page.locator('[data-fa-review-panel]')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Declaration submitted')).toBeVisible();

      // Resolve the market and verify the recorded human result.
      await page.locator('[data-fa-resolve]').click();
      await expect(page.locator('[data-fa-window-resolved]')).toBeVisible({ timeout: 60_000 });
      await expect(page.locator('[data-fa-resolution-announcement]')).toBeAttached();
      const humanResult = page.locator('[data-fa-human-result]');
      await expect(humanResult).toBeVisible();
      const result = (await humanResult.getAttribute('data-fa-human-result')) ?? '';
      expect(['signed', 'unsigned']).toContain(result);
      if (result === 'signed') {
        await expect(page.locator('[data-fa-signing-human]')).toBeVisible();
      }
      // The recorded trace is present (categorical disclosures).
      await expect(page.locator('[data-fa-trace-disclosure]').first()).toBeVisible();

      // Back at the hub, the market is resolved and the next block can lock.
      await page.goto('/season/run');
      await expect(page.locator('[data-block-phase]')).toHaveAttribute(
        'data-block-phase',
        'ready',
        {
          timeout: 30_000,
        },
      );
      await expect(
        page.getByRole('button', { name: 'Lock rotation and simulate block' }),
      ).toBeEnabled();
    },
  );

  test(
    'skip path: resolve without my team unlocks the next block',
    { tag: '@smoke' },
    async ({ page }) => {
      await useFakeRunner(page);
      await page.goto('/');

      await page.getByRole('link', { name: /Start season run/ }).click();
      await expect(page).toHaveURL(/\/season\/?$/);
      await page.getByRole('button', { name: 'Start draft' }).click();
      await expect(page.locator('[data-season-round-heading]')).toBeVisible();
      planner.reset();
      for (let round = 0; round < 10; round += 1) {
        await draftOneRound(page, planner);
      }
      await expect(page.getByText('10 of 10 picked')).toBeVisible();
      await page.getByRole('button', { name: /Generate AI league/ }).click();
      await expect(page).toHaveURL(/\/season\/run\/?$/);
      await expect(page.locator('[data-block-phase]')).toBeVisible({ timeout: 30_000 });

      await simulateNextBlock(page);
      await simulateNextBlock(page);

      await expect(page.locator('[data-fa-hub-cta]')).toBeVisible({ timeout: 60_000 });
      await page.locator('[data-fa-hub-cta]').click();
      await expect(page).toHaveURL(/\/season\/run\/free-agency/);

      // Skip, then resolve: the market resolves without a human target.
      await page.locator('[data-fa-skip]').click();
      await expect(page.locator('[data-fa-review-panel]')).toBeVisible();
      await page.locator('[data-fa-resolve]').click();
      await expect(page.locator('[data-fa-window-resolved]')).toBeVisible({ timeout: 60_000 });

      await page.goto('/season/run');
      await expect(page.locator('[data-block-phase]')).toHaveAttribute(
        'data-block-phase',
        'ready',
        {
          timeout: 30_000,
        },
      );
      await expect(
        page.getByRole('button', { name: 'Lock rotation and simulate block' }),
      ).toBeEnabled();
    },
  );
});
