import { expect, test, type Page } from '@playwright/test';

async function pickFranchise(page: Page, name: string) {
  await page.getByRole('button', { name: 'Franchise' }).click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
}

async function pickEra(page: Page, label: string) {
  await page.getByRole('button', { name: 'Decade' }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

async function draftLakers1990s(page: Page) {
  await page.goto('/sandbox');
  await pickFranchise(page, 'Los Angeles Lakers');
  await pickEra(page, '1990s');
  await expect(page.getByRole('heading', { name: /LAL · 1990s/ })).toBeVisible();
}

test.describe('sandbox draft journey', () => {
  test('chooses a position for each drafted player', async ({ page }) => {
    await draftLakers1990s(page);
    await expect(page.getByText(/44 players/)).toBeVisible();

    // Players are listed by overall rating first (Shaq is the top-rated Laker of the 1990s).
    await expect(page.locator('ul').first().locator('button').first()).toContainText(
      /Shaquille O'Neal/,
    );

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
    await draftLakers1990s(page);

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
    await draftLakers1990s(page);

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

  test('blocks ineligible franchise-era combinations', async ({ page }) => {
    await page.goto('/sandbox');

    // Charlotte Hornets (founded 2004-05) cannot play the 1960s.
    await pickEra(page, '1960s');
    await page.getByRole('button', { name: 'Franchise' }).click();
    await expect(page.getByRole('option', { name: /Charlotte Hornets/ })).toBeDisabled();

    // Lakers (founded 1948-49) can.
    await expect(page.getByRole('option', { name: /Los Angeles Lakers/ })).toBeEnabled();
  });

  test('shows each player at their peak season', async ({ page }) => {
    await draftLakers1990s(page);

    await expect(
      page.getByRole('button', { name: /Magic Johnson/ }).getByText('1990-91'),
    ).toBeVisible();
  });

  test('mobile layout keeps the lineup within reach', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await draftLakers1990s(page);

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
