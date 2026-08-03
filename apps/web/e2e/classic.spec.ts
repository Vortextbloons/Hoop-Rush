import { expect, test, type Page } from '@playwright/test';

/**
 * Classic M4 journeys (spec/01 Classic game mode, spec/08): five deterministic
 * franchise-era rolls, one franchise reroll and one era reroll, Ratings vs
 * Ball Knowledge presentations, reload-safe drafts, and the shared challenge
 * overlay / season report / history. Roll outcomes are deterministic per draft
 * seed but the seed is random per creation, so the helpers stay seed-agnostic:
 * they always pick the first enabled pool card and the first open-slot option.
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
    await expect(page.getByText(`Round ${String(round)} of 5`)).toBeVisible();
    await pickOne(page);
  }
}

/** Drafts five and starts the season from the completed classic board. */
async function reachClassicPlaying(page: Page) {
  await page.goto('/classic');
  await expect(page.getByRole('heading', { name: 'Five draft rounds' })).toBeVisible();
  await page.getByRole('button', { name: 'Start Ratings draft' }).click();
  await draftRounds(page);
  await expect(page.getByText('Draft complete')).toBeVisible();
  const cta = page.getByRole('button', { name: 'Play 82 games' });
  await expect(cta).toBeVisible();
  await cta.click();
  await expect(page).toHaveURL(/\/classic\/challenge\/?$/);
  await expect(page.getByRole('heading', { name: 'Playing the season' })).toBeVisible();
}

/** Waits for the completed classic season report after the animated overlay. */
async function expectClassicSeasonReport(page: Page) {
  await expect(page).toHaveURL(/\/classic\/result\/?\?runId=/, { timeout: 30000 });
  await expect(page.getByRole('heading', { name: 'Season report' })).toBeVisible();
  await expect(
    page.getByText(/82(-0 · perfect| games · (contender|playoff|lottery|tanking))/),
  ).toBeVisible({
    timeout: 15000,
  });
}

/** Reads the current record text (e.g. "82–0") from the season report. */
async function recordText(page: Page): Promise<string> {
  return page.getByText(/^\d+–\d+$/).innerText();
}

test.describe('classic: ratings and ball knowledge journeys', () => {
  test.describe.configure({ timeout: 60_000 });

  test('ratings draft, 82 games, result, and history reopen', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await reachClassicPlaying(page);

    // The shared overlay presents the classic run with its variant label.
    await expect(page.getByLabel('82-game strip')).toBeVisible();
    await expect(page.getByText(/Classic · Ratings/)).toBeVisible();

    await expectClassicSeasonReport(page);

    // The result report shows the classic mode identity and all sections.
    await expect(page.getByText('Classic · Ratings')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your five · season' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Season facts' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Best performance' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Totals' })).toBeVisible();

    // History reopens the stored classic summary by its record.
    const record = await recordText(page);
    await page.goto('/classic/history');
    await expect(page.getByRole('heading', { name: 'Challenge history' })).toBeVisible();
    const row = page.getByRole('link', { name: new RegExp(record) });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByRole('heading', { name: 'Season report' })).toBeVisible();
    expect(await recordText(page)).toBe(record);
  });

  test('ball knowledge hides Overall, sorts by name, and completes', async ({ page }) => {
    await page.goto('/classic');
    await expect(page.getByRole('heading', { name: 'Five draft rounds' })).toBeVisible();
    await page.getByRole('button', { name: 'Start Ball Knowledge draft' }).click();

    // Pool presentation: alphabetical sort label, no Overall badge.
    await expect(page.getByText(/sorted by NAME/)).toBeVisible();
    await expect(page.getByTitle('Overall')).toHaveCount(0);
    expect(await page.getByTitle('Offense').count()).toBeGreaterThan(0);
    expect(await page.getByTitle('Defense').count()).toBeGreaterThan(0);

    // The rendered cards are their own alphabetical sort of themselves: the
    // first card is the alphabetically-first display name of the rolled pool.
    const cardNames = await page.locator('ul li button span.truncate.font-bold').allInnerTexts();
    const sortedNames = [...cardNames].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    );
    expect(cardNames).toEqual(sortedNames);

    await draftRounds(page);
    await expect(page.getByText('Draft complete')).toBeVisible();
    await page.getByRole('button', { name: 'Play 82 games' }).click();
    await expect(page).toHaveURL(/\/classic\/challenge\/?$/);
    await expect(page.getByRole('heading', { name: 'Playing the season' })).toBeVisible();
    await expectClassicSeasonReport(page);
    await expect(page.getByText('Classic · Ball Knowledge')).toBeVisible();
  });

  test('rerolls spend once and survive a mid-draft reload', async ({ page }) => {
    await page.goto('/classic');
    await page.getByRole('button', { name: 'Start Ratings draft' }).click();
    await expect(page.getByText('Round 1 of 5')).toBeVisible();

    const reroll = page.getByRole('button', { name: /Reroll franchise/ });
    await expect(reroll).toBeVisible();
    if (await reroll.isEnabled()) {
      const before = await page.locator('body').innerText();
      await reroll.click();
      // The reroll must change the visible roll context (new franchise).
      await expect.poll(() => page.locator('body').innerText()).not.toBe(before);
    } else {
      // A roll with no alternative franchise explains itself on the button.
      await expect(reroll).toHaveAttribute('title', /\S/);
    }

    // Pick round 1, then reload: the draft resumes in round 2 with the spent
    // reroll state still recorded.
    await pickOne(page);
    await page.reload();
    await expect(page.getByText('Round 2 of 5')).toBeVisible();
    const spent = await reroll.isDisabled();
    const showsUsed = /used/i.test(await reroll.innerText());
    expect(spent || showsUsed).toBe(true);

    // The era reroll is independent: it can be spent in a later round.
    const eraReroll = page.getByRole('button', { name: /Reroll era/ });
    if (await eraReroll.isEnabled()) {
      const before = await page.locator('body').innerText();
      await eraReroll.click();
      await expect.poll(() => page.locator('body').innerText()).not.toBe(before);
    } else {
      await expect(eraReroll).toHaveAttribute('title', /\S/);
    }

    // Draft to completion across the reload; the completion survives reloads.
    await draftRounds(page, 2);
    await expect(page.getByText('Draft complete')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Draft complete')).toBeVisible();
    await expect(page.getByText('Round 1 of 5')).toHaveCount(0);
  });

  test('the classic variant is immutable once a draft starts', async ({ page }) => {
    await page.goto('/classic');
    await page.getByRole('button', { name: 'Start Ratings draft' }).click();
    await expect(page.getByText('Round 1 of 5')).toBeVisible();

    // No variant picker exists inside an in-progress draft.
    await expect(page.getByRole('button', { name: 'Start Ratings draft' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start Ball Knowledge draft' })).toHaveCount(0);

    // The variant label survives a reload unchanged.
    await page.reload();
    await expect(page.getByText('Round 1 of 5')).toBeVisible();
    await expect(page.getByText('Classic · Ratings')).toBeVisible();
  });

  test('a mid-challenge reload resumes and completes the classic run', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await reachClassicPlaying(page);
    await page.waitForTimeout(1200);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Playing the season' })).toBeVisible({
      timeout: 15000,
    });
    await expectClassicSeasonReport(page);
    expect(await recordText(page)).toMatch(/^\d+–\d+$/);
  });

  test('classic result actions: Retry replays and Edit team reopens the draft', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await reachClassicPlaying(page);
    await expectClassicSeasonReport(page);

    // Retry starts a brand-new classic run with the same five picks.
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page).toHaveURL(/\/classic\/challenge\/?$/);
    await expect(page.getByRole('heading', { name: 'Playing the season' })).toBeVisible();
    await expectClassicSeasonReport(page);

    // Edit team restores the completed draft: five picks, no removal.
    await page.getByRole('button', { name: 'Edit team' }).click();
    await expect(page).toHaveURL(/\/classic\/?$/);
    await expect(page.getByText('Draft complete')).toBeVisible();
    await expect(page.getByText('5/5', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Remove / })).toHaveCount(0);

    // A court player can swap positions with a movable incumbent.
    const movesBefore = await page
      .getByRole('button', { name: /Move .* to another position/ })
      .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
    await page
      .getByRole('button', { name: /Move .* to another position/ })
      .first()
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^Swap / })
      .first()
      .click();
    const movesAfter = await page
      .getByRole('button', { name: /Move .* to another position/ })
      .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
    expect(movesAfter[0]).not.toBe(movesBefore[0]);

    // The repositioned lineup plays out and reports again.
    await page.getByRole('button', { name: 'Play 82 games' }).click();
    await expect(page).toHaveURL(/\/classic\/challenge\/?$/);
    await expect(page.getByRole('heading', { name: 'Playing the season' })).toBeVisible();
    await expectClassicSeasonReport(page);
  });

  test('history identifies the classic mode and variant', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await reachClassicPlaying(page);
    await expectClassicSeasonReport(page);

    await page.goto('/classic/history');
    await expect(page.getByRole('link', { name: /Classic · Ratings/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /five drafted players · seed/ })).toBeVisible();
  });
});
