import { expect, test, type Page } from '@playwright/test';
import { expectCommittedGame } from './challenge-helpers';
import { placeAtSlot } from './player-helpers';

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

async function reachPlaying(page: Page) {
  await draftFive(page);
  const cta = page.getByRole('button', { name: 'Play 82 games' });
  await expect(cta).toBeVisible();
  await cta.click();

  await expect(page).toHaveURL(/\/sandbox\/challenge\/?$/, { timeout: 30000 });
  await expect(page.getByRole('heading', { name: 'Playing the season' })).toBeVisible();
}

test.describe('m3: draft to 82-game season smoke', () => {
  test(
    'drafts five, launches the overlay, and commits games',
    { tag: '@smoke' },
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await reachPlaying(page);

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
