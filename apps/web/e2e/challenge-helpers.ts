import { expect, type Page } from '@playwright/test';

/**
 * Shared challenge-run e2e helpers (m3.spec.ts + classic.spec.ts): the
 * completed-season-report wait, the record reader, and the deterministic
 * committed-game wait used before interrupting a running overlay with a
 * reload.
 */

/** The challenge mode a season report belongs to (result-route prefix). */
export type ChallengeMode = 'sandbox' | 'classic';

/** Waits for the completed season report after the animated overlay. */
export async function expectSeasonReport(page: Page, mode: ChallengeMode): Promise<void> {
  const resultPrefix = mode === 'classic' ? 'classic' : 'sandbox';
  await expect(page).toHaveURL(new RegExp(`/${resultPrefix}/result/?\\?runId=`), {
    timeout: 30000,
  });
  await expect(page.getByRole('heading', { name: 'Season report' })).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByText(/82(-0 · perfect| games · (contender|playoff|lottery|tanking))/),
  ).toBeVisible({
    timeout: 15000,
  });
}

/** Reads the current record text (e.g. "82–0") from the season report. */
export async function recordText(page: Page): Promise<string> {
  return page.getByText(/^\d+–\d+$/).innerText();
}

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
