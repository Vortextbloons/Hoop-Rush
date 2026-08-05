import { expect, test, type Page } from '@playwright/test';
import {
  seasonDraftCatalogSchema,
  type SeasonDraftCatalog,
  type SeasonDraftCandidate,
} from '@hoop-rush/data-contracts';
import { rosterFeasible, type SeasonRosterMemberInput } from '@hoop-rush/engine';

/**
 * Season Run M2.3 journeys: setup + ten-round draft, draft resume, promotion
 * to the league hub, rotation validation, the "What changed?" lock preview,
 * block progress with cancel/retry, checkpoint recaps, all nine blocks, the
 * final regular-season state, keyboard use, reduced motion, and a mobile
 * viewport.
 *
 * The block worker is not required for these journeys: block execution uses
 * the deterministic fake `SeasonBlockRunner` (commits through the
 * authoritative engine seam folds, so reload audits pass exactly like a real
 * checkpoint). The draft, AI generation, and promotion run the real engine
 * and the real IndexedDB repository.
 */

/**
 * The packaged draft catalog, fetched from the preview server to mirror the
 * engine's feasibility probe (typed like the app's own asset loading; the
 * preview server is up before any test starts).
 */
const CATALOG: SeasonDraftCatalog = seasonDraftCatalogSchema.parse(
  await fetch('http://localhost:4173/data/season/draft-catalog.json').then((response) =>
    response.json(),
  ),
);

/**
 * Mirrors the engine's pick feasibility probe so the e2e always selects a
 * candidate that keeps the 4G/4F/3C completion targets feasible — the engine
 * rejects picks that would dead-end the draft, and a dead end is permanent.
 */
class DraftPlanner {
  private picked: SeasonRosterMemberInput[] = [];

  reset(): void {
    this.picked = [];
  }

  /** Chooses the first pool candidate the engine's feasibility probe accepts. */
  choose(candidates: SeasonDraftCandidate[]): SeasonDraftCandidate {
    const pickedIds = new Set(this.picked.map((p) => p.playerVersionId));
    const available = CATALOG.candidates
      .filter((candidate) => !pickedIds.has(candidate.playerVersionId))
      .map((candidate): SeasonRosterMemberInput => ({
        playerVersionId: candidate.playerVersionId,
        playable: candidate.positions.playable,
      }));
    for (const candidate of candidates) {
      const probe: SeasonRosterMemberInput[] = [
        ...this.picked,
        {
          playerVersionId: candidate.playerVersionId,
          playable: candidate.positions.playable,
        },
      ];
      const remaining = 10 - probe.length;
      const stillAvailable = available.filter(
        (member) => member.playerVersionId !== candidate.playerVersionId,
      );
      if (rosterFeasible(probe, stillAvailable, remaining)) return candidate;
    }
    throw new Error('no feasibility-safe candidate in the revealed pool');
  }

  record(candidate: SeasonDraftCandidate): void {
    this.picked.push({
      playerVersionId: candidate.playerVersionId,
      playable: candidate.positions.playable,
    });
  }
}

const planner = new DraftPlanner();

/** Reads the revealed pool rows (name + season + positions) from the board. */
async function revealedPoolRows(page: Page): Promise<Array<{ name: string }>> {
  const section = page.locator('section', { has: page.getByText(/eligible versions/) });
  const rows = section.locator('li');
  const count = await rows.count();
  const result: Array<{ name: string }> = [];
  for (let i = 0; i < count; i += 1) {
    const text = await rows.nth(i).innerText();
    // The row renders initials (line 1), displayName (line 2), then meta.
    const lines = text.split('\n').map((line) => line.trim());
    const name =
      lines[1] ??
      lines.find((line) => CATALOG.candidates.some((c) => c.displayName === line)) ??
      '';
    result.push({ name });
  }
  return result;
}

/** Drafts one round: roll, claim, then pick a feasibility-safe candidate. */
async function draftOneRound(page: Page) {
  await page.getByRole('button', { name: /^Roll round \d+$/ }).click();
  await expect(page.getByText('Rolled options · pick')).toBeVisible();
  await page.getByRole('button', { name: 'Claim this pool' }).click();
  await expect(page.getByText(/eligible versions/)).toBeVisible();

  const rows = await revealedPoolRows(page);
  // Match the displayed names against the packaged catalog (per-pool names).
  const candidates = rows
    .map((row) => CATALOG.candidates.find((c) => c.displayName === row.name))
    .filter((c): c is SeasonDraftCandidate => c !== undefined);
  expect(candidates.length).toBeGreaterThan(0);
  const target = planner.choose(candidates);

  const section = page.locator('section', { has: page.getByText(/eligible versions/) });
  await section
    .locator('li')
    .filter({ hasText: target.displayName })
    .getByRole('button', { name: 'Pick' })
    .click();
  await expect(page.getByText(/eligible versions/)).toHaveCount(0, { timeout: 5000 });
  planner.record(target);
}

/** Drafts all ten rounds. */
async function draftTenRounds(page: Page) {
  for (let round = 1; round <= 10; round += 1) {
    await expect(
      page.locator('[data-season-round-heading]', { hasText: `Round ${String(round)} of 10` }),
    ).toBeVisible();
    await draftOneRound(page);
  }
  await page.getByRole('button', { name: 'Finalize my roster' }).click();
}

/** Runs the full setup journey: draft, AI generation, promotion, league hub. */
async function reachLeagueHub(page: Page) {
  planner.reset();
  await page.goto('/season');
  await page.getByRole('button', { name: 'Start draft' }).click();
  await expect(page.locator('[data-season-round-heading]')).toBeVisible();
  await draftTenRounds(page);

  await page.getByRole('button', { name: 'Generate AI league' }).click();
  await expect(page.getByRole('heading', { name: 'League generated' })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Open the league hub' }).click();
  await expect(page).toHaveURL(/\/season\/league\/?$/, { timeout: 30_000 });
  await expect(page.getByText('Conference position')).toBeVisible();
  await expect(page.getByText('Standings', { exact: true })).toBeVisible();
}

/** Submits the current block and waits for the accepted checkpoint refresh. */
async function submitBlockAndComplete(page: Page, blockNumber: number) {
  await page.getByRole('button', { name: 'Lock rotation and simulate block' }).click();
  await expect(
    page.getByRole('heading', { name: `Block ${String(blockNumber)} of 9` }),
  ).toBeVisible();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.getByText('Block complete.')).toBeVisible({ timeout: 30_000 });
  if (blockNumber === 9) {
    // The final block flips the hub into the completed-season card.
    await expect(page.getByRole('heading', { name: 'Regular season complete' })).toBeVisible({
      timeout: 15_000,
    });
  } else {
    await expect(page.getByText(`${String(blockNumber)} of 9 checkpoints accepted.`)).toBeVisible({
      timeout: 15_000,
    });
  }
}

test.describe('season run: setup, draft, resume, league, blocks', () => {
  test.describe.configure({ timeout: 180_000 });

  test(
    'home card, ten-round draft, AI generation, promotion, and league hub',
    { tag: '@smoke' },
    async ({ page }) => {
      // The league hub requires a block runner; e2e uses the deterministic
      // fake through the runner seam.
      await page.addInitScript(() => {
        window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
      });
      await page.goto('/');
      await page.getByRole('link', { name: /Start season run/ }).click();
      await expect(page).toHaveURL(/\/season\/?$/);
      await expect(page.getByRole('heading', { name: 'Ten rounds. One league.' })).toBeVisible();

      await reachLeagueHub(page);

      // The hub presents record, position, rotation editor, and preview.
      await expect(page.getByText('Record', { exact: true })).toBeVisible();
      await expect(page.getByText('0 of 9 checkpoints accepted.')).toBeVisible();
      await expect(page.getByText('What changed?')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Tight' })).toBeVisible();

      // Home offers the active-run resume affordance.
      await page.goto('/');
      await expect(page.getByRole('link', { name: /Continue season/ })).toBeVisible();
    },
  );

  test('draft resume survives a reload at the exact round', async ({ page }) => {
    planner.reset();
    await page.goto('/season');
    await page.getByRole('button', { name: 'Start draft' }).click();
    await expect(page.locator('[data-season-round-heading]')).toBeVisible();
    await draftOneRound(page);
    await draftOneRound(page);

    await page.reload();
    await expect(page.getByRole('button', { name: 'Resume draft' })).toBeVisible();
    await page.getByRole('button', { name: 'Resume draft' }).click();
    await expect(
      page.locator('[data-season-round-heading]', { hasText: 'Round 3 of 10' }),
    ).toBeVisible();
    // The draft keeps its claims and picks after resume.
    await expect(page.getByText('2 of 10 picked')).toBeVisible();
  });

  test('lock preview, keyboard submit, block progress, and checkpoint recap', async ({ page }) => {
    await page.addInitScript(() => {
      window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
    });
    await reachLeagueHub(page);

    // The "What changed?" surface states what will lock.
    await expect(page.getByText(/Submitting locks the rotation set/)).toBeVisible();
    await expect(page.getByText(/Upcoming human games in this block/)).toBeVisible();

    // A preset edit shows up in the preview before submission.
    await page.getByRole('button', { name: 'Tight' }).click();
    await expect(page.getByText(/rotation change/)).toBeVisible();
    await expect(page.getByText(/Tight/).first()).toBeVisible();

    // Keyboard activation of the submit button.
    const submit = page.getByRole('button', { name: 'Lock rotation and simulate block' });
    await submit.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('progressbar')).toBeVisible({ timeout: 15_000 });

    // Progress reaches the accepted checkpoint and the hub refreshes.
    await expect(page.getByText('Block complete.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('1 of 9 checkpoints accepted.')).toBeVisible({
      timeout: 15_000,
    });

    // The checkpoint page renders the factual recap.
    await page.goto('/season/checkpoint');
    await expect(page.getByRole('heading', { name: 'Block 1 recap' })).toBeVisible();
    await expect(page.getByText('Your block')).toBeVisible();
    await expect(page.getByText('Standings movement')).toBeVisible();
    await expect(page.getByText(/Box scores · your games/)).toBeVisible();
  });

  test('cancel between games, then retry completes the block', async ({ page }) => {
    await page.addInitScript(() => {
      window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
      window.__HOOP_RUSH_E2E_STALL_ONCE__ = true;
    });
    await reachLeagueHub(page);

    await page.getByRole('button', { name: 'Lock rotation and simulate block' }).click();
    await expect(page.getByRole('progressbar')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Block cancelled between games.')).toBeVisible();
    await expect(page.getByText('0 of 9 checkpoints accepted.')).toBeVisible();

    // Retry re-runs the same idempotent command and completes.
    await page.getByRole('button', { name: 'Retry block' }).click();
    await expect(page.getByText('Block complete.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('1 of 9 checkpoints accepted.')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('all nine blocks reach the final regular-season state', async ({ page }) => {
    await page.addInitScript(() => {
      window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
    });
    await reachLeagueHub(page);

    for (let block = 1; block <= 9; block += 1) {
      await submitBlockAndComplete(page, block);
    }

    await expect(page.getByRole('heading', { name: 'Regular season complete' })).toBeVisible();
    // All nine checkpoints are accepted (the hub footer shows the revision).
    await expect(page.getByText(/revision 9/)).toBeVisible();
    await page.getByRole('link', { name: 'Review final block recap' }).click();
    await expect(page.getByRole('heading', { name: 'Block 9 recap' })).toBeVisible({
      timeout: 30_000,
    });
  });

  test('mobile viewport with reduced motion still completes a block', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
    });
    await reachLeagueHub(page);

    await page.getByRole('button', { name: 'Lock rotation and simulate block' }).click();
    await expect(page.getByRole('progressbar')).toBeVisible();
    await expect(page.getByText('Block complete.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('1 of 9 checkpoints accepted.')).toBeVisible({
      timeout: 15_000,
    });
  });
});
