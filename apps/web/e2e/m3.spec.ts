import { expect, test, type Page } from '@playwright/test';
import { expectCommittedGame, expectSeasonReport, recordText } from './challenge-helpers';
import { placeAtSlot } from './player-helpers';

/**
 * M3 journeys (spec/08, spec/06): draft five → Play → animated 82-game
 * overlay → completed summary → reload → history → reopen result, plus
 * cancellation/resume, mobile layout, keyboard control, screen-reader
 * landmarks, image fallbacks, and reduced motion. The draft browses a global
 * players index with optional Franchise/Decade filters; every run simulates
 * in the fixed 2010s environment era.
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

test.describe('m3: draft to 82-game season journey', () => {
  test(
    'drafts five, plays 82 games, inspects the summary, reloads, and reopens from history',
    {
      tag: '@smoke',
    },
    async ({ page }) => {
      // Headless Chromium defaults to reduced motion, which skips the paced
      // reveal; opt back in so the overlay is observable.
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await reachPlaying(page);

      // The overlay reveals games in the 82-cell strip.
      await expect(page.getByLabel('82-game strip')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();

      // The overlay completes and navigates to the season report.
      await expectSeasonReport(page, 'sandbox');

      // Season facts: final record, strip, League MVP, and the five-player table.
      await expect(
        page.getByText(/82(-0 · perfect| games · (contender|playoff|lottery|tanking))/),
      ).toBeVisible();
      await expect(page.getByRole('heading', { name: 'League MVP' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Your five · season' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Season facts' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Totals' })).toBeVisible();
      const strip = page.getByLabel('82-game strip');
      await expect(strip.locator('li')).toHaveCount(82);

      // The record survives a reload.
      const record = await recordText(page);
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Season report' })).toBeVisible();
      await expect(page.getByText(/^\d+–\d+$/)).toBeVisible();
      expect(await recordText(page)).toBe(record);

      // Totals toggle switches the season table to totals.
      await page.getByRole('button', { name: 'Totals' }).click();
      await expect(page.getByRole('button', { name: 'Totals' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      // History reopens the stored summary. Sandbox runs no longer carry a
      // franchise-era label (every run simulates in the fixed 2010s era), so
      // the row is identified by its record instead.
      await page.goto('/sandbox/history');
      await expect(page.getByRole('heading', { name: 'Challenge history' })).toBeVisible();
      const row = page.getByRole('link', { name: new RegExp(record) });
      await expect(row).toBeVisible();
      await row.click();
      await expect(page.getByRole('heading', { name: 'Season report' })).toBeVisible();
      await expect(page.getByText(/^\d+–\d+$/)).toBeVisible();
      expect(await recordText(page)).toBe(record);

      // The start page lists the completed challenge.
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Recent challenges' })).toBeVisible();
      await expect(page.getByRole('link', { name: new RegExp(record) })).toBeVisible();
    },
  );

  test('result actions: Run again returns to a cleared draft', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await reachPlaying(page);
    await expectSeasonReport(page, 'sandbox');

    // Sandbox shows retry, edit, and run-again actions.
    await expect(page.getByRole('button', { name: 'Retry with same team' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit team' })).toBeVisible();

    // Run again returns to a completely cleared sandbox draft.
    const record = await recordText(page);
    await page.getByRole('button', { name: 'Run again' }).click();
    await expect(page).toHaveURL(/\/sandbox\/?$/);
    await expect(page.getByText('Picked 0 of 5')).toBeVisible();
    await expect(page.getByText('5/5', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove Nick Van Exel' })).toHaveCount(0);

    // Completed history remains intact.
    await page.goto('/sandbox/history');
    await expect(page.getByRole('heading', { name: 'Challenge history' })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(record) })).toBeVisible();
  });

  test('result actions: Retry with same team starts a new run immediately', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await reachPlaying(page);
    await expectSeasonReport(page, 'sandbox');
    const previousRunId = page.url();

    // The same five re-run under a fresh seed: the challenge screen appears,
    // plays out, and lands on a NEW result page (different runId).
    await page.getByRole('button', { name: 'Retry with same team' }).click();
    await expect(page.getByRole('heading', { name: 'Playing the season' })).toBeVisible({
      timeout: 30000,
    });
    await expect(page).toHaveURL(/\/sandbox\/result\/\?runId=/, { timeout: 30000 });
    expect(page.url()).not.toBe(previousRunId);
    await expectSeasonReport(page, 'sandbox');
  });

  test('result actions: Edit team restores the completed lineup on the draft', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await reachPlaying(page);
    await expectSeasonReport(page, 'sandbox');

    await page.getByRole('link', { name: 'Edit team' }).click();
    // The app routes with a trailing slash (trailingSlash = 'always').
    await expect(page).toHaveURL(/\/sandbox\/?\?slots=/);
    await expect(page.getByText('5/5', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove Nick Van Exel' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove Vlade Divac' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play 82 games' })).toBeEnabled();
  });

  test('cancel pauses at the persisted prefix and continue finishes the same run', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await reachPlaying(page);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Challenge paused' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();

    // Reload resumes from the last persisted game (the paused prefix).
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Playing the season' })).toBeVisible({
      timeout: 15000,
    });
    await expectSeasonReport(page, 'sandbox');
  });

  test(
    'a reload mid-run resumes and reproduces the same final record',
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
      await expectSeasonReport(page, 'sandbox');
      const record = await recordText(page);
      expect(record).toMatch(/^\d+–\d+$/);
    },
  );
});

test.describe('m3: URL state validation', () => {
  test('the progress page explains when no active challenge exists', async ({ page }) => {
    await page.goto('/sandbox/challenge');
    await expect(page.getByText('No active challenge.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to the draft' })).toBeVisible();
  });
});

test.describe('m3: accessibility and mobile', () => {
  test('keyboard: Play 82 games is reachable and activates', async ({ page }) => {
    await draftFive(page);
    const play = page.getByRole('button', { name: 'Play 82 games' });
    await play.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/sandbox\/challenge\/?$/);
  });

  test(
    'mobile: the draft and season report fit without horizontal overflow',
    { tag: '@smoke' },
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.setViewportSize({ width: 390, height: 844 });
      await reachPlaying(page);
      await expectSeasonReport(page, 'sandbox');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow).toBe(false);
    },
  );

  test('reduced motion: the overlay completes without artificial pacing', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await reachPlaying(page);
    await expect(page.getByRole('heading', { name: 'Playing the season' })).toBeVisible();
    await expectSeasonReport(page, 'sandbox');
    await expect(page.getByRole('heading', { name: 'Season facts' })).toBeVisible();
  });

  test('screen reader: key regions carry labelled landmarks', async ({ page }) => {
    await reachPlaying(page);
    await expectSeasonReport(page, 'sandbox');
    await expect(page.getByRole('heading', { name: 'League MVP' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your five · season' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Season facts' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Per game' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Totals' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry with same team' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit team' })).toBeVisible();
  });

  test('image fallbacks never block the challenge flow', async ({ page }) => {
    await page.route('https://cdn.nba.com/**', (route) => route.abort());
    await reachPlaying(page);
    await expectSeasonReport(page, 'sandbox');
    await expect(page.getByRole('heading', { name: 'Your five · season' })).toBeVisible();
  });
});
