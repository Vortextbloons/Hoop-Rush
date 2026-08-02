import { expect, test, type Page } from '@playwright/test';

/**
 * Sandbox draft journey (spec/01, spec/12): the draft requires exactly one
 * franchise and one decade; the corresponding pool loads only after both
 * selectors are chosen. Disabled franchise-era combinations stay visible
 * with a factual reason. The run simulates in the selected decade.
 */

/** Select a franchise/decade pair and wait for the pool heading. */
async function selectPool(page: Page, franchise: string, decade: string, heading: RegExp) {
  await page.getByRole('button', { name: 'Franchise' }).click();
  await page.getByRole('option', { name: new RegExp(franchise) }).click();
  await page.getByRole('button', { name: 'Decade' }).click();
  await page.getByRole('option', { name: decade, exact: true }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}

test.describe('sandbox draft journey', () => {
  test('loads the Lakers 1990s pool after both selectors are chosen', async ({ page }) => {
    await page.goto('/sandbox');
    await expect(page.getByText('Choose a franchise and decade')).toBeVisible();

    await selectPool(page, 'Los Angeles Lakers', '1990s', /LAL · 1990s/);

    // Pool header: player count, 40-game rule, coverage band, historical aliases.
    await expect(page.getByText(/players · 40-game rule/)).toBeVisible();
    await expect(page.getByText('complete-box-derived')).toBeVisible();

    // Each pool pick opens a position popup; the player lands in the chosen slot.
    await page.getByRole('button', { name: /Nick Van Exel/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page
      .getByRole('button', { name: 'Place Nick Van Exel at Point Guard slot 1', exact: true })
      .click();

    await page.getByRole('button', { name: /Magic Johnson/ }).click();
    await page
      .getByRole('button', { name: 'Place Magic Johnson at Shooting Guard slot 2', exact: true })
      .click();

    await page.getByRole('button', { name: /Kobe Bryant/ }).click();
    await page
      .getByRole('button', { name: 'Place Kobe Bryant at Small Forward slot 3', exact: true })
      .click();

    await page.getByRole('button', { name: /James Worthy/ }).click();
    await page
      .getByRole('button', { name: 'Place James Worthy at Power Forward slot 4', exact: true })
      .click();

    await page.getByRole('button', { name: /Shaquille O'Neal/ }).click();
    await page
      .getByRole('button', { name: "Place Shaquille O'Neal at Center slot 5", exact: true })
      .click();

    await expect(page.getByText('5/5', { exact: true })).toBeVisible();
    await expect(page.getByText('Lineup ready.')).toBeVisible();

    // Removing a player unlocks the slot again.
    await page.getByRole('button', { name: /Remove James Worthy/ }).click();
    await expect(page.getByText('4/5', { exact: true })).toBeVisible();
  });

  test('displaces a movable incumbent to fit a better player', async ({ page }) => {
    await page.goto('/sandbox');
    await selectPool(page, 'Los Angeles Lakers', '1990s', /LAL · 1990s/);

    await page.getByRole('button', { name: /Nick Van Exel/ }).click();
    await page
      .getByRole('button', { name: 'Place Nick Van Exel at Point Guard slot 1', exact: true })
      .click();
    await page.getByRole('button', { name: /Magic Johnson/ }).click();
    await page
      .getByRole('button', { name: 'Place Magic Johnson at Shooting Guard slot 2', exact: true })
      .click();
    await page.getByRole('button', { name: /James Worthy/ }).click();
    await page
      .getByRole('button', { name: 'Place James Worthy at Small Forward slot 3', exact: true })
      .click();
    await page.getByRole('button', { name: /Travis Knight/ }).click();
    await page
      .getByRole('button', { name: 'Place Travis Knight at Center slot 5', exact: true })
      .click();

    // Shaq's card is highlighted on the pool: he can take over center by moving Knight (C/F).
    const shaqCard = page.getByRole('button', { name: /Shaquille O'Neal/ });
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

    // Knight landed at power forward.
    await page.getByRole('button', { name: /Move Travis Knight to another position/ }).click();
    await expect(
      page.getByRole('button', {
        name: 'Travis Knight already at Power Forward slot 4',
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Every slot is now filled by immovable players, so Kobe's card is grayed out entirely.
    const kobeCard = page.getByRole('button', { name: /Kobe Bryant/ });
    await expect(kobeCard).toContainText('No slot');
    await expect(kobeCard).toBeDisabled();
  });

  test('moves a drafted player between positions they can play', async ({ page }) => {
    await page.goto('/sandbox');
    await selectPool(page, 'Los Angeles Lakers', '1990s', /LAL · 1990s/);

    await page.getByRole('button', { name: /Kobe Bryant/ }).click();
    await page
      .getByRole('button', { name: 'Place Kobe Bryant at Point Guard slot 1', exact: true })
      .click();

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

  test('keeps disabled combinations visible with a factual reason', async ({ page }) => {
    await page.goto('/sandbox');

    // The Pelicans did not exist before 2002-03: no-franchise-history in the 1980s.
    await selectPool(page, 'New Orleans Pelicans', '1980s', /NOP · 1980s/);
    await expect(page.getByText(/No franchise history in this decade/)).toBeVisible();
    await expect(page.getByText('first supported season 2002-03')).toBeVisible();
  });

  test('shows each player at their peak season with historical identity', async ({ page }) => {
    await page.goto('/sandbox');
    await selectPool(page, 'Oklahoma City Thunder', '1980s', /OKC · 1980s/);

    // The Thunder pool carries Seattle SuperSonics history in the 1980s.
    await expect(page.getByText(/Seattle SuperSonics/).first()).toBeVisible();
    await page.getByRole('button', { name: /Gary Payton/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByText(/Seattle SuperSonics/)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('mobile layout keeps the lineup within reach', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/sandbox');
    await selectPool(page, 'Los Angeles Lakers', '1990s', /LAL · 1990s/);

    // Sticky bottom bar shows lineup progress while the pool scrolls.
    const bar = page.getByRole('link', { name: /Your five/ });
    await expect(bar).toBeVisible();
    await expect(page.getByText('Picked 0 of 5')).toBeVisible();

    // Picking a player opens the position popup as a bottom sheet.
    await page.getByRole('button', { name: /Shaquille O'Neal/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page
      .getByRole('button', { name: "Place Shaquille O'Neal at Center slot 5", exact: true })
      .click();
    await expect(page.getByText('Picked 1 of 5')).toBeVisible();

    // Tapping the bar jumps to the lineup panel, where the picked player shows.
    await bar.click();
    await expect(page.getByRole('heading', { name: 'Your five' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Remove Shaquille O'Neal/ })).toBeVisible();
  });
});
