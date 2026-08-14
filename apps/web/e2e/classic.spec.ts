import { expect, test, type Page } from '@playwright/test';

async function draftedNames(page: Page): Promise<string[]> {
  return page
    .getByRole('button', { name: /Move .* to another position/ })
    .evaluateAll((els) =>
      els.map((el) =>
        (el.getAttribute('aria-label') ?? '').replace(/^Move (.+) to another position$/, '$1'),
      ),
    );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function pickOne(page: Page) {
  const names = await draftedNames(page);
  const pool = page.locator('ul li button:not([disabled])');
  const target =
    names.length > 0
      ? pool.filter({ hasNotText: new RegExp(names.map(escapeRegex).join('|')) })
      : pool;
  await target.first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Place / })
    .first()
    .click();
}

async function draftRounds(page: Page, fromRound = 1) {
  for (let round = fromRound; round <= 5; round += 1) {
    await expect(roundHeading(page, round)).toBeVisible();
    await pickOne(page);
  }
}

function roundHeading(page: Page, round: number) {
  return page.locator('[data-round-heading]', { hasText: `Round ${String(round)} of 5` });
}

test.describe('classic: reel draft and auto-launch smoke', () => {
  test.describe.configure({ timeout: 60_000 });

  test(
    'ratings draft: reels spin, rounds advance, and the fifth pick auto-launches',
    {
      tag: '@smoke',
    },
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.goto('/classic');
      await expect(page.getByRole('heading', { name: 'Five draft rounds' })).toBeVisible();
      await page.getByRole('button', { name: 'Start Ratings draft' }).click();
      await expect(roundHeading(page, 1)).toBeVisible();

      await expect(page.locator('.roll-overlay')).toBeVisible();
      await expect(page.locator('[data-axis="franchise"]')).toBeVisible();
      await expect(page.locator('[data-axis="era"]')).toBeVisible();
      await expect(page.locator('.roll-overlay')).not.toBeVisible({ timeout: 5000 });

      await expect(page.locator('[data-indicator="franchise"]')).toBeVisible();
      await expect(page.locator('[data-indicator="era"]')).toBeVisible();

      await pickOne(page);
      await expect(page.locator('.roll-overlay')).toBeVisible();
      await expect(page.locator('.roll-overlay')).not.toBeVisible({ timeout: 5000 });
      await expect(roundHeading(page, 2)).toBeVisible();

      await draftRounds(page, 2);

      await expect(page.getByText('Draft complete')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Play 82 games' })).toHaveCount(0);
      await expect(page).toHaveURL(/\/classic\/challenge\/?$/, { timeout: 15000 });
      await expect(page.getByRole('heading', { name: 'Playing the season' })).toBeVisible();

      await expect(page.getByLabel('82-game strip')).toBeVisible();
      await expect(page.getByText(/Classic · Ratings/)).toBeVisible();
    },
  );
});
