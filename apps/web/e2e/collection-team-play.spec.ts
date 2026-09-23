import { expect, test, type Page } from '@playwright/test';

test.describe('collection: team building and basic game', () => {
  test.describe.configure({ timeout: 180_000 });

  async function claimStarter(page: Page) {
    await page.goto('/collection');
    await expect(page.getByRole('heading', { name: 'Collection' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Claim starter' }).or(page.getByText('Five cards added')),
    ).toBeVisible({ timeout: 60_000 });
    const claim = page.getByRole('button', { name: 'Claim starter' });
    if (await claim.isVisible()) {
      await claim.click();
      await expect(page.getByRole('heading', { name: 'Starter claimed' })).toBeVisible();
    }
  }

  async function buildTeam(page: Page) {
    await page.goto('/collection/team');
    await expect(page.getByText("Coach's board")).toBeVisible();
    await page.getByRole('button', { name: 'Auto build' }).click();
    await page.getByRole('button', { name: 'Save team' }).click();
    await expect(page.getByRole('status').filter({ hasText: /Saved team/ })).toBeVisible();
  }

  async function selectDifficulty(page: Page, label: string) {
    await page.getByText(label, { exact: true }).click();
  }

  test('setup, prepare, play, and watch the recording', async ({ page }) => {
    await claimStarter(page);
    await buildTeam(page);

    await page.getByRole('link', { name: 'Play' }).first().click();
    await expect(page.getByRole('heading', { name: 'Play' })).toBeVisible();
    await expect(page.getByText('Exact reward preview')).toBeVisible();
    await expect(page.getByRole('radio', { name: /Street/ })).toBeChecked();
    await expect(page.getByText('First clear available: +200 Coins')).toBeVisible();
    await expect(page.getByRole('radio', { name: /No objective/ })).toBeChecked();

    await selectDifficulty(page, 'Pro');
    await expect(page.getByText('First clear available: +350 Coins')).toBeVisible();
    await expect(page.getByText(/1\.35× on outcome, objective/)).toBeVisible();

    const objectiveGroup = page.getByRole('group', { name: 'Objective' });
    await objectiveGroup.locator('label').nth(1).click();
    await expect(objectiveGroup.getByRole('radio').nth(1)).toBeChecked();
    await expect(page.getByText('Potential bonus: +41 Coins').first()).toBeVisible();

    await page.getByRole('button', { name: 'Prepare matchup' }).click();
    await expect(page.getByRole('heading', { name: 'Matchup ready' })).toBeVisible();
    await expect(page.getByText('Declared matchup')).toBeVisible();
    await expect(page.getByText('Selected objective')).toBeVisible();
    await expect(page.getByText(/records a 0 rating shift/)).toBeVisible();
    await expect(page.getByText('CPU roster').first()).toBeVisible();

    await page.getByRole('button', { name: 'Play game' }).click();
    await expect(page.getByRole('heading', { name: /You \d+ · CPU \d+/ })).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByRole('heading', { name: 'Reward receipt' })).toBeVisible();
    await expect(page.getByText('New Coins balance')).toBeVisible();
    await expect(page.getByText(/passed|failed|No objective/).first()).toBeVisible();

    await page.getByRole('button', { name: 'Slow', exact: true }).click();
    await page.getByRole('button', { name: 'Skip to final' }).click();
    await expect(page.getByText('Final —')).toBeVisible();

    await page.getByRole('button', { name: 'Fast', exact: true }).click();
    await expect(page.getByText('Game facts')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: /You \d+ · CPU \d+/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Reward receipt' })).toBeVisible();
  });

  test('pending matchup resumes after reload with locked setup', async ({ page }) => {
    await claimStarter(page);
    await buildTeam(page);

    await page.goto('/collection/play');
    await expect(page.getByRole('radio', { name: /Street/ })).toBeChecked();
    await page.getByRole('button', { name: 'Prepare matchup' }).click();
    await expect(page.getByRole('heading', { name: 'Matchup ready' })).toBeVisible();
    await expect(page.getByText('Declared matchup')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Matchup ready' })).toBeVisible();
    await expect(page.getByText('Locked until abandoned')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abandon matchup' })).toBeVisible();

    await page.getByRole('button', { name: 'Abandon matchup' }).click();
    await expect(page.getByRole('button', { name: 'Prepare matchup' })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Street/ })).toBeChecked();
  });

  test('mobile layout plays the same journey', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await claimStarter(page);
    await buildTeam(page);

    await page.goto('/collection/play');
    await expect(page.getByText('Exact reward preview')).toBeVisible();
    await selectDifficulty(page, 'Legend');
    await expect(page.getByText('First clear available: +500 Coins')).toBeVisible();
    await page.getByRole('button', { name: 'Prepare matchup' }).click();
    await expect(page.getByRole('heading', { name: 'Matchup ready' })).toBeVisible();
    await page.getByRole('button', { name: 'Play game' }).click();
    await expect(page.getByRole('heading', { name: /You \d+ · CPU \d+/ })).toBeVisible({
      timeout: 120_000,
    });
  });
});
