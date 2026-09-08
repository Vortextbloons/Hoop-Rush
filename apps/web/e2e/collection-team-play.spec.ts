import { expect, test } from '@playwright/test';

test.describe('collection: team building and basic game', () => {
  test.describe.configure({ timeout: 180_000 });

  async function claimStarter(page) {
    await page.goto('/collection');
    await expect(page.getByRole('heading', { name: 'Collection' })).toBeVisible();
    await expect(
      page
        .getByRole('button', { name: 'Claim starter' })
        .or(page.getByText('Five cards added')),
    ).toBeVisible({ timeout: 60_000 });
    const claim = page.getByRole('button', { name: 'Claim starter' });
    if (await claim.isVisible()) {
      await claim.click();
      await expect(page.getByRole('heading', { name: 'Starter claimed' })).toBeVisible();
    }
  }

  test('auto build, save, prepare, play, and watch the recording', async ({ page }) => {
    await claimStarter(page);

    await page.getByRole('link', { name: 'Team' }).first().click();
    await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();
    await expect(page.getByText("Coach's board")).toBeVisible();

    await page.getByRole('button', { name: 'Auto build' }).click();
    await expect(page.getByText('Team is valid.')).toBeVisible();
    await page.getByRole('button', { name: 'Save team' }).click();
    await expect(page.getByText(/Saved team/)).toBeVisible();

    await page.getByRole('link', { name: 'Play' }).first().click();
    await expect(page.getByRole('heading', { name: 'Play' })).toBeVisible();
    await expect(page.getByText('Win 100 Coins · Loss 10 Coins').first()).toBeVisible();

    await page.getByRole('button', { name: 'Prepare game' }).click();
    await expect(page.getByRole('heading', { name: 'Matchup ready' })).toBeVisible();
    await expect(page.getByText('Your starters')).toBeVisible();
    await expect(page.getByText('CPU starters')).toBeVisible();

    await page.getByRole('button', { name: 'Start game' }).click();
    await expect(page.getByRole('heading', { name: /You \d+ · CPU \d+/ })).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByText(/Coins \(/)).toBeVisible();

    await page.getByRole('button', { name: 'Slow', exact: true }).click();
    await page.getByRole('button', { name: 'Skip to final' }).click();
    await expect(page.getByText('Final —')).toBeVisible();

    await page.getByRole('button', { name: 'Fast', exact: true }).click();
    await expect(page.getByText('Game facts')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: /You \d+ · CPU \d+/ })).toBeVisible();
  });

  test('pending matchup resumes after reload', async ({ page }) => {
    await claimStarter(page);

    await page.goto('/collection/team');
    await expect(page.getByText("Coach's board")).toBeVisible();
    await page.getByRole('button', { name: 'Auto build' }).click();
    await page.getByRole('button', { name: 'Save team' }).click();
    await expect(page.getByText(/Saved team/)).toBeVisible();

    await page.goto('/collection/play');
    await page.getByRole('button', { name: 'Prepare game' }).click();
    await expect(page.getByRole('heading', { name: 'Matchup ready' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Matchup ready' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abandon matchup' })).toBeVisible();

    await page.getByRole('button', { name: 'Abandon matchup' }).click();
    await expect(page.getByRole('button', { name: 'Prepare game' })).toBeVisible();
  });

  test('mobile layout plays the same journey', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await claimStarter(page);

    await page.goto('/collection/team');
    await expect(page.getByText("Coach's board")).toBeVisible();
    await page.getByRole('button', { name: 'Auto build' }).click();
    await page.getByRole('button', { name: 'Save team' }).click();
    await expect(page.getByText(/Saved team/)).toBeVisible();

    await page.goto('/collection/play');
    await page.getByRole('button', { name: 'Prepare game' }).click();
    await expect(page.getByRole('heading', { name: 'Matchup ready' })).toBeVisible();
    await page.getByRole('button', { name: 'Start game' }).click();
    await expect(page.getByRole('heading', { name: /You \d+ · CPU \d+/ })).toBeVisible({
      timeout: 120_000,
    });
  });
});
