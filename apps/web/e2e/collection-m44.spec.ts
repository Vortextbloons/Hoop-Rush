import { expect, test } from '@playwright/test';

test.describe('collection M4.4: targeting, sets, and challenges', () => {
  test.describe.configure({ timeout: 120_000 });

  async function claimStarter(page: import('@playwright/test').Page): Promise<void> {
    await page.goto('/collection');
    await expect(page.getByRole('heading', { name: 'Collection' })).toBeVisible();
    await page.getByRole('button', { name: 'Claim starter' }).click();
    await expect(page.getByRole('heading', { name: 'Starter claimed' })).toBeVisible();
  }

  test('target an unowned player, read exact odds, clear, and reload', async ({ page }) => {
    await claimStarter(page);

    await page
      .getByRole('button', { name: /unowned/ })
      .first()
      .click();
    const targetButton = page.getByRole('button', { name: 'Target player' });
    await expect(targetButton).toBeVisible();
    await targetButton.click();
    await page.keyboard.press('Escape');

    await expect(page.getByLabel('Active target player')).toBeVisible();

    await page.getByRole('link', { name: 'Packs' }).click();
    await expect(page.getByRole('heading', { name: 'Choose a pack' })).toBeVisible();
    await expect(page.getByText(/P\(at least one /).first()).toBeVisible();

    await page.getByRole('button', { name: 'Clear target' }).first().click();
    await expect(page.getByLabel('Active target player')).toHaveCount(0);

    await page.reload();
    await expect(page.getByLabel('Active target player')).toHaveCount(0);
  });

  test('shows the three sets with progress and no claim action while incomplete', async ({
    page,
  }) => {
    await claimStarter(page);
    await expect(page.getByRole('heading', { name: 'Sets' })).toBeVisible();
    await expect(page.getByText('Incomplete').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Claim / })).toHaveCount(0);
  });

  test('ineligible challenge offers Edit team and returns', async ({ page }) => {
    await claimStarter(page);

    await page.goto('/collection/play');
    await page
      .locator('label')
      .filter({ has: page.getByRole('radio', { name: 'Challenges' }) })
      .click();
    await expect(page.getByRole('radio', { name: 'Challenges' })).toBeChecked();
    await expect(page.getByText('Not eligible').first()).toBeVisible();
    const edit = page.getByRole('link', { name: 'Edit team' }).first();
    await expect(edit).toBeVisible();
    await edit.click();
    await expect(page).toHaveURL(/\/ultimate\/run\/team/);
  });
});
