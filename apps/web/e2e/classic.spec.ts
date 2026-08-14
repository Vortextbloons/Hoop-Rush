import { expect, test, type Page } from '@playwright/test';

/**
 * Classic M4 smoke journey (spec/01 Classic game mode, spec/08): five
 * deterministic franchise-era rolls with reel animation, the auto-season
 * launch after the fifth pick, and the challenge overlay. Roll outcomes are
 * deterministic per draft seed but the seed is random per creation, so the
 * helpers stay seed-agnostic: they always pick the first enabled pool card
 * and the first open-slot option. The journey stops at the challenge overlay
 * instead of the full season report, which is covered by unit tests.
 */

/**
 * Drafts five rounds seed-agnostically: click the first enabled pool card
 * that is not already on the court (a later roll may repeat an earlier
 * franchise-era pool, whose drafted players stay clickable for repositioning),
 * then the first enabled open-slot option in the picker dialog (the close
 * button is excluded by matching the "Place …" aria labels).
 */
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

/** Clicks one enabled pool card and places it in the first open eligible slot. */
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

/**
 * The round-card header. The roll modal also renders the round, so plain
 * getByText would match two elements while a spin is open; the header is
 * the only element carrying data-round-heading.
 */
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

      // The very first roll animates too: the modal opens with the spinning
      // reels, then closes on the landed pair.
      await expect(page.locator('.roll-overlay')).toBeVisible();
      await expect(page.locator('[data-axis="franchise"]')).toBeVisible();
      await expect(page.locator('[data-axis="era"]')).toBeVisible();
      await expect(page.locator('.roll-overlay')).not.toBeVisible({ timeout: 5000 });

      // The initial roll shows the franchise + era indicators.
      await expect(page.locator('[data-indicator="franchise"]')).toBeVisible();
      await expect(page.locator('[data-indicator="era"]')).toBeVisible();

      // After the first pick the roll modal opens with the spinning reels, then
      // closes on the new pair; the round advances and the indicators update.
      await pickOne(page);
      await expect(page.locator('.roll-overlay')).toBeVisible();
      await expect(page.locator('.roll-overlay')).not.toBeVisible({ timeout: 5000 });
      await expect(roundHeading(page, 2)).toBeVisible();

      // The remaining rounds: pick, spin, settle.
      await draftRounds(page, 2);

      // The fifth pick auto-launches: no 'Draft complete', no 'Play 82 games'.
      await expect(page.getByText('Draft complete')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Play 82 games' })).toHaveCount(0);
      await expect(page).toHaveURL(/\/classic\/challenge\/?$/, { timeout: 15000 });
      await expect(page.getByRole('heading', { name: 'Playing the season' })).toBeVisible();

      // The shared overlay presents the classic run with its variant label.
      await expect(page.getByLabel('82-game strip')).toBeVisible();
      await expect(page.getByText(/Classic · Ratings/)).toBeVisible();
    },
  );
});
