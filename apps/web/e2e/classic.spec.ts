import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectCommittedGame, expectSeasonReport, recordText } from './challenge-helpers';

/**
 * Classic M4 journeys (spec/01 Classic game mode, spec/08): five deterministic
 * franchise-era rolls with reel animation, one franchise reroll and one era
 * reroll, Ratings vs Ball Knowledge presentations, reload-safe drafts, the
 * navigation guard with leave/discard confirmation, the automatic season
 * launch after the fifth pick, and the shared challenge overlay / season
 * report / history. Roll outcomes are deterministic per draft seed but the
 * seed is random per creation, so the helpers stay seed-agnostic: they always
 * pick the first enabled pool card and the first open-slot option.
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
 * Drafts all five rounds and waits for the automatic launch: the fifth pick
 * starts the season without any intermediate step.
 */
async function reachClassicPlaying(page: Page) {
  await page.goto('/classic');
  await expect(page.getByRole('heading', { name: 'Five draft rounds' })).toBeVisible();
  await page.getByRole('button', { name: 'Start Ratings draft' }).click();
  await draftRounds(page);
  // The fifth pick pre-simulates the season before navigating; under a fully
  // parallel gate that can take well past the default 15s budget.
  await expect(page).toHaveURL(/\/classic\/challenge\/?$/, { timeout: 30000 });
  await expect(page.getByRole('heading', { name: 'Playing the season' })).toBeVisible();
}

/**
 * The round-card header. The roll modal also renders the round, so plain
 * getByText would match two elements while a spin is open; the header is
 * the only element carrying data-round-heading.
 */
function roundHeading(page: Page, round: number) {
  return page.locator('[data-round-heading]', { hasText: `Round ${String(round)} of 5` });
}

/**
 * The first reroll axis that is currently enabled, or null when both are
 * disabled (reroll availability is seed-dependent: a rolled pool without an
 * alternative for an axis disables that reroll permanently).
 */
async function availableRerolls(
  franchiseReroll: Locator,
  eraReroll: Locator,
): Promise<'franchise' | 'era' | null> {
  if (await franchiseReroll.isEnabled()) return 'franchise';
  if (await eraReroll.isEnabled()) return 'era';
  return null;
}

/**
 * Clicks a reroll button when the rolled pool offers an alternative for its
 * axis; otherwise asserts the disabled button explains itself (title).
 * Returns whether the reroll was spent.
 */
async function useRerollIfAvailable(
  page: Page,
  button: Locator,
  overlay: Locator,
): Promise<boolean> {
  if (!(await button.isEnabled())) {
    await expect(button).toHaveAttribute('title', /\S/);
    return false;
  }
  await button.click();
  await expect(overlay).toBeVisible();
  await expect(overlay).not.toBeVisible({ timeout: 5000 });
  return true;
}

test.describe('classic: reel draft, auto-launch, guard, and result journeys', () => {
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
      await expect(page.locator('[data-axis="franchise"]')).toBeVisible();
      await expect(page.locator('[data-axis="era"]')).toBeVisible();
      await expect(page.locator('.roll-overlay')).not.toBeVisible({ timeout: 5000 });
      await expect(roundHeading(page, 2)).toBeVisible();
      await expect(page.locator('[data-indicator="franchise"]')).toBeVisible();
      await expect(page.locator('[data-indicator="era"]')).toBeVisible();

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

      await expectSeasonReport(page, 'classic');

      // The result report shows the classic mode identity and all sections.
      await expect(page.getByText('Classic · Ratings')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'League MVP' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Your five · season' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Season facts' })).toBeVisible();
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
    },
  );

  test('ball knowledge hides all ratings, sorts by name, and auto-launches', async ({ page }) => {
    await page.goto('/classic');
    await expect(page.getByRole('heading', { name: 'Five draft rounds' })).toBeVisible();
    await page.getByRole('button', { name: 'Start Ball Knowledge draft' }).click();

    // Pool presentation: alphabetical sort label, no rating badges at all,
    // and the shared name search is available.
    await expect(page.getByText(/sorted by NAME/)).toBeVisible();
    await expect(page.getByTitle('Overall')).toHaveCount(0);
    await expect(page.getByTitle('Offense')).toHaveCount(0);
    await expect(page.getByTitle('Defense')).toHaveCount(0);
    await expect(page.getByLabel('Search players by name')).toBeVisible();

    // The rendered cards are their own alphabetical sort of themselves: the
    // first card is the alphabetically-first display name of the rolled pool.
    const cardNames = await page.locator('ul li button span.truncate.font-bold').allInnerTexts();
    const sortedNames = [...cardNames].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    );
    expect(cardNames).toEqual(sortedNames);

    await draftRounds(page);
    await expect(page).toHaveURL(/\/classic\/challenge\/?$/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Playing the season' })).toBeVisible();
    await expectSeasonReport(page, 'classic');
    await expect(page.getByText('Classic · Ball Knowledge')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'League MVP' })).toBeVisible();
  });

  test('a reroll spins only its axis whenever one is available', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/classic');
    await page.getByRole('button', { name: 'Start Ratings draft' }).click();
    await expect(roundHeading(page, 1)).toBeVisible();

    // The initial roll spins on fresh creation; wait for it to settle so the
    // reroll buttons are usable and the indicators hold the landed pair.
    await expect(page.locator('.roll-overlay')).toBeVisible();
    await expect(page.locator('.roll-overlay')).not.toBeVisible({ timeout: 5000 });

    const franchiseIndicator = page.locator('[data-indicator="franchise"]');
    const eraIndicator = page.locator('[data-indicator="era"]');
    const overlay = page.locator('.roll-overlay');
    const franchiseReel = page.locator('[data-axis="franchise"]');
    const eraReel = page.locator('[data-axis="era"]');
    const franchiseReroll = page.getByRole('button', { name: /Reroll franchise/ });
    const eraReroll = page.getByRole('button', { name: /Reroll era/ });
    await expect(franchiseReroll).toBeVisible();
    await expect(eraReroll).toBeVisible();

    // Reroll availability is seed-dependent, so poll for any enabled reroll
    // instead of sampling once: the isolation assertions then run on every
    // seed that offers a reroll at all. When neither axis can be rerolled
    // (the rolled pool has no alternative), the buttons must explain
    // themselves on their titles instead.
    await expect
      .poll(() => availableRerolls(franchiseReroll, eraReroll), { timeout: 10_000 })
      .not.toBeNull()
      .catch(() => undefined);
    const available = await availableRerolls(franchiseReroll, eraReroll);

    if (available === 'franchise') {
      const eraBefore = (await eraIndicator.innerText()).trim();
      const franchiseBefore = (await franchiseIndicator.innerText()).trim();
      await franchiseReroll.click();
      // The modal opens; only the franchise reel animates; the era stays fixed.
      await expect(overlay).toBeVisible();
      await expect(franchiseReel.locator('.reel-strip')).toHaveClass(/reel-spinning/, {
        timeout: 2000,
      });
      await expect(eraReel.locator('.reel-strip')).not.toHaveClass(/reel-spinning/);
      // After the result beat the modal closes; the era indicator is unchanged
      // and the franchise changed.
      await expect(overlay).not.toBeVisible({ timeout: 5000 });
      await expect(eraIndicator).toContainText(eraBefore);
      await expect(franchiseIndicator).not.toContainText(franchiseBefore);
    } else if (available === 'era') {
      const eraBefore = (await eraIndicator.innerText()).trim();
      await eraReroll.click();
      await expect(overlay).toBeVisible();
      await expect(eraReel.locator('.reel-strip')).toHaveClass(/reel-spinning/, {
        timeout: 2000,
      });
      await expect(franchiseReel.locator('.reel-strip')).not.toHaveClass(/reel-spinning/);
      await expect(overlay).not.toBeVisible({ timeout: 5000 });
      // The franchise id stays fixed, but its historical display identity can
      // legitimately change with the era (for example NJN -> BKN). The reel
      // class assertion above is the stable proof that this axis did not spin.
      await expect(eraIndicator).not.toContainText(eraBefore);
    } else {
      // A roll with no alternative franchise or era explains itself on the
      // disabled buttons.
      await expect(franchiseReroll).toHaveAttribute('title', /\S/);
      await expect(eraReroll).toHaveAttribute('title', /\S/);
    }
  });

  test('reroll state survives a reload and resume never replays the animation', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/classic');
    await page.getByRole('button', { name: 'Start Ratings draft' }).click();
    await expect(roundHeading(page, 1)).toBeVisible();

    // The initial roll spins on fresh creation; wait for it to settle so the
    // reroll buttons are usable.
    await expect(page.locator('.roll-overlay')).toBeVisible();
    await expect(page.locator('.roll-overlay')).not.toBeVisible({ timeout: 5000 });

    const overlay = page.locator('.roll-overlay');
    const franchiseReroll = page.getByRole('button', { name: /Reroll franchise/ });
    const eraReroll = page.getByRole('button', { name: /Reroll era/ });

    // Spend the franchise reroll when this seed's pools offer one; otherwise
    // the disabled button must explain itself.
    await useRerollIfAvailable(page, franchiseReroll, overlay);

    // Pick round 1, then reload: the draft resumes in round 2 with the spent
    // reroll state still recorded, and the roll modal never replays.
    // Wait for the round header to advance first: it only renders after the
    // pick's persist commits, so the reload can never race the save.
    await pickOne(page);
    await expect(roundHeading(page, 2)).toBeVisible({ timeout: 5000 });
    await page.reload();
    await expect(roundHeading(page, 2)).toBeVisible();
    await expect(overlay).toHaveCount(0);
    const spent = await franchiseReroll.isDisabled();
    const showsUsed = /used/i.test(await franchiseReroll.innerText());
    expect(spent || showsUsed).toBe(true);

    // The era reroll is independent: it can be spent in a later round.
    await useRerollIfAvailable(page, eraReroll, overlay);

    // Draft to completion across the reload; the fifth pick auto-launches.
    await draftRounds(page, 2);
    await expect(page).toHaveURL(/\/classic\/challenge\/?$/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Playing the season' })).toBeVisible();
  });

  test('the classic variant is immutable once a draft starts', async ({ page }) => {
    await page.goto('/classic');
    await page.getByRole('button', { name: 'Start Ratings draft' }).click();
    await expect(roundHeading(page, 1)).toBeVisible();

    // No variant picker exists inside an in-progress draft.
    await expect(page.getByRole('button', { name: 'Start Ratings draft' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start Ball Knowledge draft' })).toHaveCount(0);

    // The variant label survives a reload unchanged.
    await page.reload();
    await expect(roundHeading(page, 1)).toBeVisible();
    await expect(page.getByText('Classic · Ratings')).toBeVisible();
  });

  test('a mid-challenge reload resumes and completes the classic run', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await reachClassicPlaying(page);
    // Wait until at least one game is committed (persisted) before
    // interrupting the overlay, so the reload resumes from a non-empty
    // persisted prefix rather than racing the first commit.
    await expectCommittedGame(page);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Playing the season' })).toBeVisible({
      timeout: 15000,
    });
    await expectSeasonReport(page, 'classic');
    expect(await recordText(page)).toMatch(/^\d+–\d+$/);
  });

  test('navigation guard: Stay keeps the draft on Back, reload, and browser back', async ({
    page,
  }) => {
    // Enter /classic through an in-app link so browser-back has a route to pop.
    await page.goto('/');
    await page.getByRole('link', { name: /Start classic/ }).click();
    await expect(page).toHaveURL(/\/classic\/?$/);
    await expect(page.getByRole('heading', { name: 'Five draft rounds' })).toBeVisible();
    await page.getByRole('button', { name: 'Start Ratings draft' }).click();
    await expect(roundHeading(page, 1)).toBeVisible();

    // The page Back link is intercepted with the leave/discard dialog.
    await page.getByRole('link', { name: 'Back' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Stay' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Leave and discard' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Stay' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(/\/classic\/?$/);
    await expect(roundHeading(page, 1)).toBeVisible();

    // Reload keeps the draft (the guard never intercepts full-page unloads).
    await page.reload();
    await expect(roundHeading(page, 1)).toBeVisible();

    // Browser-back ('popstate') is guarded the same way.
    await page.goBack();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Stay' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page).toHaveURL(/\/classic\/?$/);
    await expect(roundHeading(page, 1)).toBeVisible();
  });

  test('navigation guard: Leave and discard clears the draft', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /Start classic/ }).click();
    await expect(page).toHaveURL(/\/classic\/?$/);
    await page.getByRole('button', { name: 'Start Ratings draft' }).click();
    await expect(roundHeading(page, 1)).toBeVisible();

    // The home page offers to resume the in-progress draft.
    await page.goto('/');
    await page.getByRole('link', { name: /Continue draft/ }).click();
    await expect(roundHeading(page, 1)).toBeVisible();

    await page.getByRole('link', { name: 'Back' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Leave and discard' }).click();

    // Lands on the target with the draft discarded.
    await expect(page).toHaveURL(/\/?$/);
    await expect(page.getByRole('link', { name: /Continue draft/ })).toHaveCount(0);

    // A fresh visit to /classic shows the variant picker, no resume.
    await page.goto('/classic');
    await expect(page.getByRole('heading', { name: 'Five draft rounds' })).toBeVisible();
  });

  test('classic result: Run again restarts with a fresh draft', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await reachClassicPlaying(page);
    await expectSeasonReport(page, 'classic');

    // The result shows exactly one action button: Run again.
    await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Retry with same team', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit team' })).toHaveCount(0);

    // MVP spotlight: the League MVP heading, the winner's name, and the side.
    const mvp = page.getByRole('region', { name: 'League MVP' });
    await expect(mvp).toBeVisible();
    const mvpText = await mvp.innerText();
    const fiveText = await page.getByRole('region', { name: 'Your five · season' }).innerText();
    const namesLine = mvpText
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 2 && fiveText.includes(line));
    expect(mvpText).toMatch(/(Your five|Opponent)/i);
    expect(/opponent/i.test(mvpText) || namesLine !== undefined).toBe(true);

    // Run again clears the draft: /classic shows the variant picker again.
    await page.getByRole('button', { name: 'Run again' }).click();
    await expect(page).toHaveURL(/\/classic\/?$/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Five draft rounds' })).toBeVisible();
  });

  test('history identifies the classic mode and variant', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await reachClassicPlaying(page);
    await expectSeasonReport(page, 'classic');

    await page.goto('/classic/history');
    await expect(page.getByRole('link', { name: /Classic · Ratings/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /five drafted players · seed/ })).toBeVisible();
  });
});
