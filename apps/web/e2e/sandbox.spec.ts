import { expect, test, type Page } from '@playwright/test';

/**
 * Sandbox draft journey (spec/01): the draft browses the global players index
 * with optional search and position chips; nothing is required except five
 * legal picks from any franchise/era combination. The run simulates in a
 * fixed 2010s environment.
 */

/** Search the global index and pick the first exact-name card. */
async function pickPlayer(page: Page, name: string) {
  const search = page.getByRole('searchbox', { name: 'Search players by name' });
  await search.fill(name);
  const card = page.getByRole('button', { name: new RegExp(name) }).first();
  await expect(card).toBeVisible();
  await card.click();
}

test.describe('sandbox draft journey', () => {
  test('drafts five players from any pool and validates the lineup', async ({ page }) => {
    await page.goto('/sandbox');
    await expect(page.getByRole('heading', { name: 'Draft any five' })).toBeVisible();
    await expect(page.getByText(/players . sorted by OVER/)).toBeVisible();

    // Each pool pick opens a position popup; the player lands in the chosen slot.
    await pickPlayer(page, 'Nick Van Exel');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page
      .getByRole('button', { name: 'Place Nick Van Exel at Point Guard slot 1', exact: true })
      .click();

    await pickPlayer(page, 'Magic Johnson');
    await page
      .getByRole('button', { name: 'Place Magic Johnson at Shooting Guard slot 2', exact: true })
      .click();

    await pickPlayer(page, 'Kobe Bryant');
    await page
      .getByRole('button', { name: 'Place Kobe Bryant at Small Forward slot 3', exact: true })
      .click();

    await pickPlayer(page, 'James Worthy');
    await page
      .getByRole('button', { name: 'Place James Worthy at Power Forward slot 4', exact: true })
      .click();

    await pickPlayer(page, "Shaquille O'Neal");
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

    await pickPlayer(page, 'Nick Van Exel');
    await page
      .getByRole('button', { name: 'Place Nick Van Exel at Point Guard slot 1', exact: true })
      .click();
    await pickPlayer(page, 'Magic Johnson');
    await page
      .getByRole('button', { name: 'Place Magic Johnson at Shooting Guard slot 2', exact: true })
      .click();
    await pickPlayer(page, 'James Worthy');
    await page
      .getByRole('button', { name: 'Place James Worthy at Small Forward slot 3', exact: true })
      .click();
    await pickPlayer(page, 'Travis Knight');
    await page
      .getByRole('button', { name: 'Place Travis Knight at Center slot 5', exact: true })
      .click();

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

    await pickPlayer(page, 'Kobe Bryant');
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

  test('mixes players from different franchises and decades in one lineup', async ({ page }) => {
    await page.goto('/sandbox');

    await pickPlayer(page, 'Michael Jordan');
    await page
      .getByRole('button', { name: 'Place Michael Jordan at Point Guard slot 1', exact: true })
      .click();
    await pickPlayer(page, 'LeBron James');
    await page
      .getByRole('button', { name: 'Place LeBron James at Small Forward slot 3', exact: true })
      .click();
    await pickPlayer(page, 'B.J. Armstrong');
    await page
      .getByRole('button', { name: 'Place B.J. Armstrong at Shooting Guard slot 2', exact: true })
      .click();
    await pickPlayer(page, 'Dennis Rodman');
    await page
      .getByRole('button', { name: 'Place Dennis Rodman at Power Forward slot 4', exact: true })
      .click();
    await pickPlayer(page, 'Timofey Mozgov');
    await page
      .getByRole('button', { name: 'Place Timofey Mozgov at Center slot 5', exact: true })
      .click();

    await expect(page.getByText('5/5', { exact: true })).toBeVisible();
    await expect(page.getByText('Lineup ready.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove Michael Jordan' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove LeBron James' })).toBeVisible();
  });

  test('shows each player at their peak season with historical coverage', async ({ page }) => {
    await page.goto('/sandbox');

    // Magic Johnson's Lakers 1990s peak is shown on the card.
    await pickPlayer(page, 'Magic Johnson');
    await expect(page.getByRole('dialog').getByText('1990-91')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Historical coverage: Dale Ellis appears at his Seattle SuperSonics peak
    // from the 1980s Thunder pool.
    const search = page.getByRole('searchbox', { name: 'Search players by name' });
    await search.fill('Dale Ellis');
    const ellisCard = page.getByRole('button', { name: /Dale Ellis/ }).first();
    await expect(ellisCard).toBeVisible();
    await expect(ellisCard.getByText('1988-89')).toBeVisible();
    await ellisCard.click();
    await expect(page.getByRole('dialog').getByText('1988-89')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('mobile layout keeps the lineup within reach', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/sandbox');

    const bar = page.getByRole('link', { name: /Your five/ });
    await expect(bar).toBeVisible();
    await expect(page.getByText('Picked 0 of 5')).toBeVisible();

    await pickPlayer(page, "Shaquille O'Neal");
    await expect(page.getByRole('dialog')).toBeVisible();
    await page
      .getByRole('button', { name: "Place Shaquille O'Neal at Center slot 5", exact: true })
      .click();
    await expect(page.getByText('Picked 1 of 5')).toBeVisible();

    await bar.click();
    await expect(page.getByRole('heading', { name: 'Your five' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Remove Shaquille O'Neal/ })).toBeVisible();
  });
});
