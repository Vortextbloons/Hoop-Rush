import { expect, test, type Page } from '@playwright/test';
import { expectCommittedGame } from './challenge-helpers';
import { placeAtSlot } from './player-helpers';

/**
 * M3 smoke journeys (spec/08, spec/06): draft five players, launch the
 * 82-game overlay, and verify a persisted prefix. Journeys stop at the first
 * committed game instead of playing out the whole season; the full season
 * report, history, result actions, and accessibility/mobile variants are
 * covered by unit tests.
 */

async function draftFive(page: Page) {
  await page.goto('/sandbox');
  for (const [name, slotLabel] of [
    ['Nick Van Exel', 'Point Guard slot 1'],
    ['Sedale Threatt', 'Shooting Guard slot 2'],
    ['A.C. Green', 'Small Forward slot 3'],
    ['Robert Horry', 'Power Forward slot 4'],
    ['Vlade Divac', 'Center slot 5'],
  ] as const) {
    await placeAtSlot(page, name, slotLabel);
  }
}

/** Drafts five, then starts the season from the draft screen. */
async function reachPlaying(page: Page) {
  await draftFive(page);
  const cta = page.getByRole('button', { name: 'Play 82 games' });
  await expect(cta).toBeVisible();
  await cta.click();
  // The launch pre-simulates the season before navigating; under a fully
  // parallel gate that can take well past the default 15s budget.
  await expect(page).toHaveURL(/\/sandbox\/challenge\/?$/, { timeout: 30000 });
  await expect(page.getByRole('heading', { name: 'Playing the season' })).toBeVisible();
}

test.describe('m3: draft to 82-game season smoke', () => {
  test(
    'drafts five, launches the overlay, and commits games',
    { tag: '@smoke' },
    async ({ page }) => {
      // Headless Chromium defaults to reduced motion, which skips the paced
      // reveal; opt back in so the overlay is observable.
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await reachPlaying(page);

      // The overlay reveals games in the 82-cell strip.
      await expect(page.getByLabel('82-game strip')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
      await expectCommittedGame(page);
    },
  );

  test(
    'a reload mid-run resumes from the persisted prefix',
    { tag: '@smoke' },
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await reachPlaying(page);
      // Wait until at least one game is committed (persisted) before
      // interrupting the overlay, so the reload resumes from a non-empty
      // persisted prefix rather than racing the first commit.
      await expectCommittedGame(page);
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Playing the season' })).toBeVisible({
        timeout: 15000,
      });
      await expectCommittedGame(page);
    },
  );

  test(
    'mobile: the draft and overlay fit without horizontal overflow',
    { tag: '@smoke' },
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.setViewportSize({ width: 390, height: 844 });
      await reachPlaying(page);
      await expectCommittedGame(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow).toBe(false);
    },
  );
});
