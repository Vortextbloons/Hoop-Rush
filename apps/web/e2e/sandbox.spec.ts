import { expect, test } from '@playwright/test';
import { placeAtSlot } from './player-helpers';

/**
 * Sandbox draft smoke (spec/01): the draft browses the global players index
 * and lands five legal picks from any franchise/era combination; the run
 * simulates in a fixed 2010s environment. Displacement, repositioning, and
 * mobile variants are covered by unit tests.
 */

test.describe('sandbox draft smoke', () => {
  test(
    'drafts five players from any pool and validates the lineup',
    { tag: '@smoke' },
    async ({ page }) => {
      await page.goto('/sandbox');
      await expect(page.getByRole('heading', { name: 'Draft any five' })).toBeVisible();
      await expect(page.getByText(/players . sorted by OVER/)).toBeVisible();

      // Each pool pick opens a position popup; the player lands in the chosen slot.
      await placeAtSlot(page, 'Nick Van Exel', 'Point Guard slot 1');
      await placeAtSlot(page, 'Magic Johnson', 'Shooting Guard slot 2');
      await placeAtSlot(page, 'Kobe Bryant', 'Small Forward slot 3');
      await placeAtSlot(page, 'James Worthy', 'Power Forward slot 4');
      await placeAtSlot(page, "Shaquille O'Neal", 'Center slot 5');

      await expect(page.getByText('Lineup ready.')).toBeVisible();

      // The court heading counts the picks (the bottom nav renders a
      // mobile-only copy of the same count, so scope to the court).
      const count = page.locator('#your-five').getByText('5/5', { exact: true });
      await expect(count).toBeVisible();

      // Removing a player unlocks the slot again.
      await page.getByRole('button', { name: /Remove James Worthy/ }).click();
      await expect(page.locator('#your-five').getByText('4/5', { exact: true })).toBeVisible();
    },
  );
});
