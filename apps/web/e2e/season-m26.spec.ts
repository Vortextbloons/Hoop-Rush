import { expect, test, type Page } from '@playwright/test';
import {
  DraftPlanner,
  loadDraftCatalog,
  reachLeagueHub,
  selectFirstObjective,
} from './season-helpers';

/**
 * M2.6 postseason and history journeys (spec/2.0 M2.6): through the fake
 * block runner the spec completes all nine regular-season blocks, starts
 * the postseason from the hub, and drives the tournament to its champion —
 * submitting human rotations (with risky-rehab and rotation-swap recovery
 * for the deterministic fake-runner injury), spectating or fast-forwarding
 * once eliminated — then follows the champion summary into completed
 * history, opens the result, and deletes it.
 *
 * Both runner seams are fake (`__HOOP_RUSH_E2E_FAKE_RUNNER__` for blocks,
 * `__HOOP_RUSH_E2E_FAKE_POSTSEASON_RUNNER__` for the postseason), so the
 * journey is deterministic and needs no worker. The postseason fake runs
 * the EXACT engine command handler the real worker runs.
 */

const planner = new DraftPlanner();

test.describe('season M2.6: postseason and history', () => {
  test.describe.configure({ timeout: 900_000 });

  test.beforeAll(async () => {
    await loadDraftCatalog();
  });

  test('from the final regular-season block to a champion and back through history', async ({
    page,
  }) => {
    page.on('pageerror', (error) => {
      console.log('PAGE ERROR:', error.message);
    });
    await page.addInitScript(() => {
      window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
      window.__HOOP_RUSH_E2E_FAKE_POSTSEASON_RUNNER__ = true;
    });
    await reachLeagueHub(page, planner, { runShell: true });

    // --- Nine regular-season blocks through the fake runner ---
    for (let block = 1; block <= 9; block += 1) {
      await submitBlockAndSettle(page, block);
    }

    // --- Start the postseason ---
    const startButton = page.locator('[data-season-start-postseason-button]');
    await expect(startButton).toBeVisible();
    await startButton.click();
    await expect(page.locator('[data-season-current-matchup]')).toBeVisible({
      timeout: 30_000,
    });

    // --- Drive the tournament to a champion ---
    await driveToChampion(page);

    const champion = page.locator('[data-season-champion]');
    await expect(champion).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/champion/).first()).toBeVisible();

    // The shell gained the Postseason tab with the stage.
    await page.getByRole('link', { name: 'Postseason' }).first().click();
    await expect(page.locator('[data-season-bracket-champion]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-season-series-card]').first()).toBeVisible();

    // --- Completed history: list -> result -> export affordance -> delete ---
    await page.getByRole('link', { name: 'Season history' }).first().click();
    await expect(page.getByRole('heading', { name: 'Completed seasons' })).toBeVisible({
      timeout: 15_000,
    });
    const entry = page.locator('[data-season-history-entry]').first();
    await expect(entry).toBeVisible();
    await entry.click();

    await expect(page.locator('[data-season-champion]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-season-series-card]').first()).toBeVisible();
    const exportButton = page.locator('[data-season-history-export]').first();
    await expect(exportButton).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await exportButton.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^hoop-rush-replay-.*\.json$/);

    await page.locator('[data-season-history-delete]').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete season' }).click();

    await expect(page.getByRole('heading', { name: 'Completed seasons' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('No completed seasons yet')).toBeVisible();
  });

  test('bracket route outside the postseason shows the not-started state', async ({ page }) => {
    await page.addInitScript(() => {
      window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
      window.__HOOP_RUSH_E2E_FAKE_POSTSEASON_RUNNER__ = true;
    });
    await reachLeagueHub(page, planner, { runShell: true });
    await page.goto('/season/run/postseason');
    await expect(page.getByRole('heading', { name: "The postseason hasn't started" })).toBeVisible({
      timeout: 15_000,
    });
  });
});

/**
 * Locks and simulates one regular-season block through the fake runner,
 * then waits until the checkpoint is accepted (the hub returns to idle and
 * the accepted-checkpoint count advances). The final block flips the hub
 * into the regular-season-complete panel.
 */
async function submitBlockAndSettle(page: Page, blockNumber: number): Promise<void> {
  await selectFirstObjective(page);
  await page.getByRole('button', { name: 'Lock rotation and simulate block' }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  if (blockNumber === 9) {
    await expect(page.getByRole('heading', { name: 'Regular season complete' })).toBeVisible({
      timeout: 30_000,
    });
  } else {
    await expect(page.getByText(`${String(blockNumber)} of 9 checkpoints accepted.`)).toBeVisible({
      timeout: 30_000,
    });
  }
}

/**
 * Drives the tournament from the current matchup to the champion: submits
 * the human rotation when the lineup panel is up (recovering from the
 * deterministic fake-runner injury through risky rehab or a starter swap),
 * advances to the next human decision, spectates once eliminated, and
 * fast-forwards to the champion.
 */
async function driveToChampion(page: Page): Promise<void> {
  let guard = 0;
  while (guard < 400) {
    guard += 1;
    if (
      await page
        .locator('[data-season-champion]')
        .isVisible()
        .catch(() => false)
    )
      return;

    const submit = page.locator('[data-season-postseason-submit]');
    const advance = page.locator('[data-season-advance-button]');
    const spectate = page.locator('[data-season-spectate-next]');
    const fastForward = page.locator('[data-season-fast-forward]');

    if (await submit.isVisible().catch(() => false)) {
      if (await submit.isDisabled()) {
        await settlePostseason(page);
        continue;
      }
      await submit.click();
      await page.waitForTimeout(600);
      const alert = page.locator('[data-season-postseason-lineup] [role="alert"]');
      if (await alert.isVisible().catch(() => false)) {
        await recoverFromRotationRejection(page);
        continue;
      }
      continue;
    }
    if (await advance.isVisible().catch(() => false)) {
      await advance.click();
      await settlePostseason(page);
      continue;
    }
    if (await spectate.isVisible().catch(() => false)) {
      await spectate.click();
      await settlePostseason(page);
      continue;
    }
    if (await fastForward.isVisible().catch(() => false)) {
      await fastForward.click();
      await settlePostseason(page);
      continue;
    }
    await page.waitForTimeout(400);
  }
  throw new Error('the tournament did not reach a champion');
}

/**
 * Recovers from an unavailable-player rejection: spend the risky-rehab roll
 * when a fresh option exists; otherwise swap the injured starter out of
 * their slot (the fake runner's deterministic injury outlives one failed
 * roll).
 */
async function recoverFromRotationRejection(page: Page): Promise<void> {
  const freshRehab = page.locator('[data-season-rehab-option]:not([disabled])').first();
  if (await freshRehab.isVisible().catch(() => false)) {
    await freshRehab.click();
    await page.locator('[data-season-postseason-submit]').click();
    await page.waitForTimeout(600);
    const alert = page.locator('[data-season-postseason-lineup] [role="alert"]');
    if (!(await alert.isVisible().catch(() => false))) return;
  }
  // The roll failed or was already spent: pull the injured player from the
  // lineup through the starter slot pickers.
  const option = page.locator('[data-season-rehab-option]').first();
  const labelText = await option
    .locator('..')
    .textContent()
    .catch(() => '');
  const injuredName =
    (labelText ?? '')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? '';
  const selects = page.locator('[data-season-postseason-lineup] select');
  const count = await selects.count();
  let swapped = false;
  for (let index = 0; index < count; index += 1) {
    const selectedText = await selects.nth(index).locator('option:checked').textContent();
    if (selectedText?.includes(injuredName) === true) {
      const options = selects.nth(index).locator('option');
      const optionCount = await options.count();
      const currentIndex = await selects
        .nth(index)
        .evaluate((select) => (select as HTMLSelectElement).selectedIndex);
      const nextIndex = (currentIndex + 1) % Math.max(1, optionCount);
      await selects.nth(index).selectOption({ index: nextIndex });
      swapped = true;
      break;
    }
  }
  if (!swapped && injuredName.length > 0) {
    // Fall back: swap the first starter slot (bench players follow).
    await selects.first().selectOption({ index: 5 });
  }
  await page.locator('[data-season-postseason-submit]').click();
  await page.waitForTimeout(600);
}

/** Waits until an in-flight postseason session settles (committed or done). */
async function settlePostseason(page: Page): Promise<void> {
  const progress = page.locator('[data-season-postseason-progress]');
  for (let index = 0; index < 60; index += 1) {
    if (!(await progress.isVisible().catch(() => false))) return;
    const text = await progress.textContent().catch(() => '');
    if ((text ?? '').includes('simulation complete')) return;
    await page.waitForTimeout(500);
  }
}
