import { expect, test } from '@playwright/test';

test.describe('sandbox draft journey', () => {
  test('choose Lakers 1990s and draft a legal five', async ({ page }) => {
    await page.goto('/sandbox');

    await expect(
      page.getByRole('heading', { name: 'Choose a franchise and decade' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Los Angeles Lakers' }).click();
    await page.getByRole('button', { name: '1990s', exact: true }).click();

    await expect(page.getByRole('heading', { name: /Los Angeles Lakers · 1990s/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Shaquille O'Neal/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Magic Johnson/ })).toBeVisible();
    await expect(page.getByText(/44 eligible/)).toBeVisible();

    // Draft five: two guards, two forwards, one center.
    await page.getByRole('button', { name: /Nick Van Exel/ }).click();
    await page.getByRole('button', { name: /Magic Johnson/ }).click();
    await page.getByRole('button', { name: /Kobe Bryant/ }).click();
    await page.getByRole('button', { name: /James Worthy/ }).click();
    await page.getByRole('button', { name: /Shaquille O'Neal/ }).click();

    await expect(page.getByText('5/5', { exact: true })).toBeVisible();
    await expect(page.getByText('Legal lineup.')).toBeVisible();

    // Removing a player unlocks the slot again.
    await page.getByRole('button', { name: /Remove James Worthy/ }).click();
    await expect(page.getByText('4/5', { exact: true })).toBeVisible();
  });

  test('blocks ineligible franchise-era combinations', async ({ page }) => {
    await page.goto('/sandbox');

    // Charlotte Hornets (founded 2004-05) cannot play the 1960s.
    await page.getByRole('button', { name: '1960s', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Charlotte Hornets' }).first()).toBeDisabled();

    // Lakers (founded 1948-49) can.
    await expect(page.getByRole('button', { name: 'Los Angeles Lakers' }).first()).toBeEnabled();
  });

  test('shows the pool rules and peak seasons', async ({ page }) => {
    await page.goto('/sandbox');
    await page.getByRole('button', { name: 'Los Angeles Lakers' }).click();
    await page.getByRole('button', { name: '1990s', exact: true }).click();

    await expect(page.getByText('Pool rules')).toBeVisible();
    await expect(
      page.getByText('At least 40 games for this franchise in the chosen season'),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Magic Johnson/ }).getByText('1990-91'),
    ).toBeVisible();
  });
});
