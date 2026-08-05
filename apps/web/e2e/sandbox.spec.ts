import { expect, test } from '@playwright/test';
import { placeAtSlot } from './player-helpers';

/**
 * Sandbox draft journey (spec/01): the draft browses the global players index
 * with optional search and position chips; nothing is required except five
 * legal picks from any franchise/era combination. The run simulates in a
 * fixed 2010s environment.
 */

test.describe('sandbox draft journey', () => {
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

      await expect(page.getByText('5/5', { exact: true })).toBeVisible();
      await expect(page.getByText('Lineup ready.')).toBeVisible();

      // Removing a player unlocks the slot again.
      await page.getByRole('button', { name: /Remove James Worthy/ }).click();
      await expect(page.getByText('4/5', { exact: true })).toBeVisible();
    },
  );

  test('displaces a movable incumbent to fit a better player', async ({ page }) => {
    await page.goto('/sandbox');

    await placeAtSlot(page, 'Nick Van Exel', 'Point Guard slot 1');
    await placeAtSlot(page, 'Magic Johnson', 'Shooting Guard slot 2');
    await placeAtSlot(page, 'James Worthy', 'Small Forward slot 3');
    await placeAtSlot(page, 'Travis Knight', 'Center slot 5');

    // Shaq's card is highlighted: he can take over center by moving Knight (C/F).
    const search = page.getByRole('searchbox', { name: 'Search players by name' });
    await search.fill("Shaquille O'Neal");
    const shaqCard = page.getByRole('button', { name: /Shaquille O'Neal/ }).first();
    await expect(shaqCard).toContainText('Moves Knight');
    await shaqCard.click();
    await page
      .getByRole('button', {
        name: "Place Shaquille O'Neal at Center slot 5, moving Travis Knight to Power Forward slot 4",
        exact: true,
      })
      .click();

    await expect(page.getByText('5/5', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Remove Shaquille O'Neal/ })).toBeVisible();
  });

  test('moves a drafted player between positions they can play', async ({ page }) => {
    await page.goto('/sandbox');

    await placeAtSlot(page, 'Kobe Bryant', 'Point Guard slot 1');

    // Kobe (G/F) can slide to a forward slot from the lineup panel.
    await page.getByRole('button', { name: /Move Kobe Bryant to another position/ }).click();
    await page
      .getByRole('button', { name: 'Place Kobe Bryant at Small Forward slot 3', exact: true })
      .click();

    await expect(page.getByText('Open PG')).toBeVisible();
    await page.getByRole('button', { name: /Move Kobe Bryant to another position/ }).click();
    await expect(
      page.getByRole('button', {
        name: 'Kobe Bryant already at Small Forward slot 3',
        exact: true,
      }),
    ).toBeVisible();
  });

  test('mixes players from different franchises and decades in one lineup', async ({ page }) => {
    await page.goto('/sandbox');

    await placeAtSlot(page, 'Michael Jordan', 'Point Guard slot 1');
    await placeAtSlot(page, 'LeBron James', 'Small Forward slot 3');
    await placeAtSlot(page, 'B.J. Armstrong', 'Shooting Guard slot 2');
    await placeAtSlot(page, 'Dennis Rodman', 'Power Forward slot 4');
    await placeAtSlot(page, 'Timofey Mozgov', 'Center slot 5');

    await expect(page.getByText('5/5', { exact: true })).toBeVisible();
    await expect(page.getByText('Lineup ready.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove Michael Jordan' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove LeBron James' })).toBeVisible();
  });

  test('shows each player at their peak season with historical coverage', async ({ page }) => {
    await page.goto('/sandbox');

    // The exact peak can change when ratings are regenerated. Prove that the
    // season shown on the selected card is carried into the placement dialog.
    const search = page.getByRole('searchbox', { name: 'Search players by name' });
    await search.fill('Magic Johnson');
    const magicCard = page.getByRole('button', { name: /Magic Johnson/ }).first();
    const magicSeason = (await magicCard.innerText()).match(/\b\d{4}-\d{2}\b/)?.[0];
    if (!magicSeason) throw new Error('Magic Johnson card did not expose a season');
    await magicCard.click();
    await expect(page.getByRole('dialog').getByText(magicSeason, { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Historical coverage: Dale Ellis carries his Seattle identity from the
    // Thunder lineage, and whichever peak is currently selected is preserved.
    await search.fill('Dale Ellis');
    const ellisCard = page.getByRole('button', { name: /Dale Ellis/ }).first();
    await expect(ellisCard).toBeVisible();
    await expect(ellisCard).toContainText(/SEA · \d{4}s/);
    const ellisSeason = (await ellisCard.innerText()).match(/\b\d{4}-\d{2}\b/)?.[0];
    if (!ellisSeason) throw new Error('Dale Ellis card did not expose a season');
    await ellisCard.click();
    await expect(page.getByRole('dialog').getByText(ellisSeason, { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('mobile layout keeps the lineup within reach', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/sandbox');

    const bar = page.getByRole('link', { name: /Your five/ });
    await expect(bar).toBeVisible();
    await expect(page.getByText('Picked 0 of 5')).toBeVisible();

    await placeAtSlot(page, "Shaquille O'Neal", 'Center slot 5');
    await expect(page.getByText('Picked 1 of 5')).toBeVisible();

    await bar.click();
    await expect(page.getByRole('heading', { name: 'Your five' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Remove Shaquille O'Neal/ })).toBeVisible();
  });
});
