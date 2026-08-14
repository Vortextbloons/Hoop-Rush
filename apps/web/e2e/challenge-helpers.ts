import { expect, type Page } from '@playwright/test';

/**
 * Shared challenge-run e2e helper (m3.spec.ts): the deterministic
 * committed-game wait used before asserting the overlay has durable progress.
 */

/**
 * Waits until the challenge overlay has committed at least one game. The
 * runner persists each accepted game to IndexedDB before revealing it, so the
 * overlay's committed counter is a deterministic proxy for durable progress:
 * a reload right after this resolves resumes from a non-empty persisted
 * prefix (no arbitrary sleep).
 */
export async function expectCommittedGame(page: Page): Promise<void> {
  await expect(page.getByText(/\d+\/82 committed/)).not.toHaveText('0/82 committed', {
    timeout: 15_000,
  });
}
