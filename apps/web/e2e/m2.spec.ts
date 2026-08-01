import { expect, test, type Page } from '@playwright/test';

/**
 * M2 journeys (spec/08, spec/06): draft five → setup → simulate → inspect
 * result → replay same seed → return and edit, plus URL-state validation,
 * reload determinism, accessibility, and mobile behavior.
 */

const LAKERS_1990S_QUERY = 'franchise=lakers&era=1990s';
const FIVE_SLOTS = ['p-89', 'p-9', 'p-920', 'p-109', 'p-124'].join(',');
const GAME_URL = `/sandbox/game?${LAKERS_1990S_QUERY}&slots=${FIVE_SLOTS}&seed=abc123abc123abc123abc123abc123ab`;

async function pickFranchise(page: Page, name: string) {
  await page.getByRole('button', { name: 'Franchise' }).click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
}

async function pickEra(page: Page, label: string) {
  await page.getByRole('button', { name: 'Decade' }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

async function draftFive(page: Page) {
  await page.goto('/sandbox');
  await pickFranchise(page, 'Los Angeles Lakers');
  await pickEra(page, '1990s');
  await expect(page.getByRole('heading', { name: /LAL · 1990s/ })).toBeVisible();
  for (const [name, slotLabel] of [
    ['Nick Van Exel', 'Point Guard slot 1'],
    ['Sedale Threatt', 'Shooting Guard slot 2'],
    ['A.C. Green', 'Small Forward slot 3'],
    ['Robert Horry', 'Power Forward slot 4'],
    ['Vlade Divac', 'Center slot 5'],
  ] as const) {
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await page.getByRole('button', { name: `Place ${name} at ${slotLabel}`, exact: true }).click();
  }
}

test.describe('m2: draft to result journey', () => {
  test('drafts five, confirms setup, simulates, inspects, replays, and edits', async ({ page }) => {
    await draftFive(page);

    // Legal-lineup CTA appears on the draft page.
    const cta = page.getByRole('link', { name: /Continue to challenge setup/ });
    await expect(cta).toBeVisible();

    // Setup page: five players, opponent preview, rules, and the start button.
    await cta.click();
    await expect(page).toHaveURL(/\/sandbox\/setup\?/);
    await expect(page.getByRole('heading', { name: 'One game. Five players.' })).toBeVisible();
    const yourFive = page.getByRole('region', { name: 'Your five' });
    await expect(yourFive.getByText('Nick Van Exel')).toBeVisible();
    await expect(yourFive.getByText('Vlade Divac')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Opening opponent' })).toBeVisible();
    const opponentRegion = page.getByRole('complementary', { name: 'Opening opponent' });
    await expect(opponentRegion.getByText('Los Angeles Lakers')).toBeVisible();
    await expect(opponentRegion.getByText('Van Exel')).toBeVisible();
    await expect(page.getByText('No bench, no substitutions, no fatigue.')).toBeVisible();
    await expect(
      page.getByText('Medium difficulty comes from a calibrated opponent band'),
    ).toBeVisible();

    // Tip off generates a seed and moves to the game page.
    await page.getByRole('button', { name: 'Tip off' }).click();
    await expect(page).toHaveURL(/\/sandbox\/game\?/);
    await expect(page).toHaveURL(/seed=/);

    // Scoreboard-led result.
    await expect(page.getByRole('heading', { name: 'The tape' })).toBeVisible();
    await expect(page.getByText(/^\d+ – \d+$/)).toBeVisible({ timeout: 15000 });
    const score = await page.getByText(/^\d+ – \d+$/).innerText();
    await expect(page.getByRole('heading', { name: 'Why it ended this way' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Box score' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Team comparison' })).toBeVisible();
    // Period scores table exists with Q1..Q4 headers.
    await expect(page.getByRole('columnheader', { name: 'Q1' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Final' })).toBeVisible();

    // Replay the same seed: identical score, then a new seed changes it.
    await page.getByRole('button', { name: 'Replay this seed' }).click();
    await expect(page.getByText(/^\d+ – \d+$/)).toBeVisible();
    const replayedScore = await page.getByText(/^\d+ – \d+$/).innerText();
    expect(replayedScore).toBe(score);

    await page.getByRole('button', { name: 'New seed' }).click();
    await expect(page).toHaveURL(/seed=/);
    await expect(page.getByText(/^\d+ – \d+$/)).toBeVisible({ timeout: 15000 });
    const newScore = await page.getByText(/^\d+ – \d+$/).innerText();
    expect(newScore).not.toBe(score);

    // Edit lineup returns to the draft with the state intact.
    await page.getByRole('link', { name: 'Edit lineup' }).click();
    await expect(page).toHaveURL(/\/sandbox\?franchise=lakers&era=1990s/);
    await expect(page.getByRole('group', { name: 'Your five on the court' })).toBeVisible();
    await expect(page.getByText('Nick Van Exel').last()).toBeVisible();
  });

  test('reload keeps the same seeded result', async ({ page }) => {
    await page.goto(GAME_URL);
    await expect(page.getByText(/^\d+ – \d+$/)).toBeVisible({ timeout: 15000 });
    const before = await page.getByText(/^\d+ – \d+$/).innerText();
    await page.reload();
    await expect(page.getByText(/^\d+ – \d+$/)).toBeVisible({ timeout: 15000 });
    const after = await page.getByText(/^\d+ – \d+$/).innerText();
    expect(after).toBe(before);
  });

  test('setup page survives a reload with the same draft', async ({ page }) => {
    await page.goto(`/sandbox/setup?${LAKERS_1990S_QUERY}&slots=${FIVE_SLOTS}`);
    const yourFive = page.getByRole('region', { name: 'Your five' });
    await expect(yourFive.getByText('Nick Van Exel')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tip off' })).toBeEnabled();
    await page.reload();
    await expect(yourFive.getByText('Nick Van Exel')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tip off' })).toBeEnabled();
  });
});

test.describe('m2: URL state validation', () => {
  test('rejects a missing lineup', async ({ page }) => {
    await page.goto('/sandbox/game?franchise=lakers&era=1990s');
    await expect(page.getByText('Game unavailable')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to the draft' })).toBeVisible();
  });

  test('rejects an unknown franchise', async ({ page }) => {
    await page.goto(
      `/sandbox/game?franchise=atlantis&era=1990s&slots=${FIVE_SLOTS}&seed=abc123abc123abc123abc123abc123ab`,
    );
    await expect(page.getByText('Game unavailable')).toBeVisible();
    await expect(page.getByText(/Unknown franchise/)).toBeVisible();
  });

  test('rejects a seed that is not valid hex', async ({ page }) => {
    await page.goto(`/sandbox/game?${LAKERS_1990S_QUERY}&slots=${FIVE_SLOTS}&seed=not-a-seed!`);
    await expect(page.getByText('Game unavailable')).toBeVisible();
  });

  test('rejects a player that is not in the pool', async ({ page }) => {
    await page.goto(
      `/sandbox/game?${LAKERS_1990S_QUERY}&slots=p-1,p-2,p-3,p-4,p-5&seed=abc123abc123abc123abc123abc123ab`,
    );
    await expect(page.getByText('Game unavailable')).toBeVisible();
    await expect(page.getByText(/not in this pool/)).toBeVisible();
  });

  test('rejects an illegal position assignment', async ({ page }) => {
    // Two centers (Divac + Shaq) cannot both fit the G,G,F,F,C structure.
    await page.goto(
      `/sandbox/game?${LAKERS_1990S_QUERY}&slots=p-124,p-406,p-109,p-920,p-89&seed=abc123abc123abc123abc123abc123ab`,
    );
    await expect(page.getByText('Game unavailable')).toBeVisible();
    await expect(page.getByText(/not legal/)).toBeVisible();
  });
});

test.describe('m2: accessibility and mobile', () => {
  test('keyboard: the Tip off button is reachable and activates', async ({ page }) => {
    await page.goto(`/sandbox/setup?${LAKERS_1990S_QUERY}&slots=${FIVE_SLOTS}`);
    await expect(page.getByRole('button', { name: 'Tip off' })).toBeEnabled();
    await page.getByRole('button', { name: 'Tip off' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/sandbox\/game\?/);
  });

  test('mobile: box score uses team tabs and the scoreboard fits', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(GAME_URL);
    await expect(page.getByText(/^\d+ – \d+$/)).toBeVisible({ timeout: 15000 });
    // The team tabs switch the box score table.
    const userTab = page.getByRole('button', { name: /Your five · LAL/ });
    const opponentTab = page.getByRole('button', { name: /Los Angeles Lakers · LAL/ });
    await expect(userTab).toBeVisible();
    await expect(opponentTab).toBeVisible();
    await userTab.click();
    await expect(page.getByRole('columnheader', { name: 'Player' })).toBeVisible();
    await opponentTab.click();
    await expect(page.getByRole('columnheader', { name: 'Player' })).toBeVisible();
    // No horizontal overflow of the scoreboard card on a phone.
    const scoreboard = page.getByRole('heading', { name: 'The tape' });
    await expect(scoreboard).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });

  test('reduced motion: the result renders without animation dependencies', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(GAME_URL);
    await expect(page.getByText(/^\d+ – \d+$/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Box score' })).toBeVisible();
  });

  test('screen reader: key regions carry labelled landmarks', async ({ page }) => {
    await page.goto(GAME_URL);
    await expect(page.getByText(/^\d+ – \d+$/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Why it ended this way' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Box score' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Team comparison' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Replay this seed' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New seed' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit lineup' })).toBeVisible();
  });
});
