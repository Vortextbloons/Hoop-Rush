import { expect, test } from '@playwright/test';

test('boots without schema initialization errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');
  await page.waitForTimeout(500);

  expect(
    errors.filter((error) => /Cannot read properties of undefined \(reading .parse.\)/.test(error)),
  ).toEqual([]);
});
