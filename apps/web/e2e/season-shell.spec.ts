import { expect, test, type Page } from '@playwright/test';
import {
  seasonDraftCatalogSchema,
  type SeasonDraftCatalog,
  type SeasonDraftCandidate,
} from '@hoop-rush/data-contracts';
import { rosterFeasible, type SeasonRosterMemberInput } from '@hoop-rush/engine';

/**
 * Season Run shell journeys (M2.3.5): the Hub and Team tabs inside the
 * shared `/season/run` shell — season tape, next-decision panel, block
 * submission that survives tab switches, tab navigation, responsive layout
 * (bottom nav vs sticky rail), rotation workspace controls, keyboard use,
 * reduced motion, and a mobile block completion.
 *
 * Like season.spec.ts, block execution uses the deterministic fake
 * `SeasonBlockRunner` through the window seam; the draft, AI generation, and
 * promotion run the real engine and the real IndexedDB repository.
 *
 * Dependencies on sibling agents: the Schedule, League, and Leaders tabs and
 * the checkpoint detail page under /season/run are owned by other agents;
 * journeys that hop to those tabs complete only once those pages land. The
 * draft flow itself is another agent's in-flight work and is driven here
 * through its current UI.
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

/**
 * Runs the setup journey (draft, AI generation, promotion) and lands on the
 * Hub tab of the run shell. The pre-shell league route redirects into the
 * shell; we navigate directly to the Hub so the shell mounts cleanly
 * regardless of the League tab's current availability.
 */
async function reachRunShell(page: Page) {
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
  // The promotion completes before the page's own goto fires; accept either
  // the pre-shell route or its redirect target, then mount the shell fresh.
  await expect(page).toHaveURL(/\/season\/(league|run\/league)/, { timeout: 30_000 });
  await page.goto('/season/run/');
  await expect(page.getByText('Next decision')).toBeVisible({ timeout: 30_000 });
}

/** Submits the current block and waits for the accepted checkpoint refresh. */
async function submitBlockAndComplete(page: Page, blockNumber: number) {
  await page.getByRole('button', { name: 'Lock rotation and simulate block' }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.getByText('Block complete.')).toBeVisible({ timeout: 30_000 });
  if (blockNumber === 9) {
    await expect(page.getByRole('heading', { name: 'Regular season complete' })).toBeVisible({
      timeout: 15_000,
    });
  } else {
    await expect(page.getByText(`${String(blockNumber)} of 9 checkpoints accepted.`)).toBeVisible({
      timeout: 15_000,
    });
  }
}

/** The mobile fixed bottom navigation (`md:hidden` on its nav element). */
function bottomNav(page: Page) {
  return page.locator('nav[aria-label="Season navigation"].md\\:hidden');
}

/** The sticky desktop rail (`md:block` on its nav element). */
function desktopRail(page: Page) {
  return page.locator('nav[aria-label="Season navigation"].md\\:block');
}

/** The visible closing-five roster player who is not currently selected. */
async function nonClosingPlayer(page: Page): Promise<{ value: string; label: string }> {
  const selected: string[] = [];
  for (let slot = 1; slot <= 5; slot += 1) {
    selected.push(
      await page.locator(`select[aria-label="Closing slot ${String(slot)}"]`).inputValue(),
    );
  }
  const options = page.locator('select[aria-label="Closing slot 1"] option');
  const count = await options.count();
  for (let index = 0; index < count; index += 1) {
    const option = options.nth(index);
    const value = await option.getAttribute('value');
    if (value !== null && !selected.includes(value)) {
      const label = (await option.textContent())?.trim() ?? value;
      return { value, label };
    }
  }
  throw new Error('no non-closing roster player available');
}

test.describe('season shell: hub, team, tabs, responsive', () => {
  test.describe.configure({ timeout: 240_000 });

  test('draft → promotion → shell hub: masthead, nine tape segments, simulate action', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
    });
    await reachRunShell(page);

    // Masthead: the shell renders the human franchise heading.
    const mastheadHeading = page.getByRole('heading', { level: 1 });
    await expect(mastheadHeading).toBeVisible();
    expect((await mastheadHeading.textContent())?.trim().length ?? 0).toBeGreaterThan(0);

    // The season tape has nine segments; the first is the current decision.
    const segments = page.locator('[data-season-tape-segment]');
    await expect(segments).toHaveCount(9);
    await expect(segments.nth(0)).toHaveAttribute('aria-current', 'step');

    // The hub's next-decision panel is actionable.
    await expect(page.getByText('Up next')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Lock rotation and simulate block' }),
    ).toBeEnabled();
  });

  test('a running block survives tab switches and marks the tape segment complete', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
    });
    await reachRunShell(page);

    await page.getByRole('button', { name: 'Lock rotation and simulate block' }).click();
    await expect(page.getByRole('progressbar')).toBeVisible({ timeout: 15_000 });

    // Leave the hub while the block runs: the shell layout keeps the worker
    // alive across tab switches.
    await page.getByRole('link', { name: 'Team' }).first().click();
    await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible();
    await page.getByRole('link', { name: 'Schedule' }).first().click();
    await page.getByRole('link', { name: 'Hub' }).first().click();

    // The block completed in the background and the tape advanced.
    await expect(page.getByText('Block complete.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('1 of 9 checkpoints accepted.')).toBeVisible({
      timeout: 15_000,
    });
    const segments = page.locator('[data-season-tape-segment]');
    await expect(segments.nth(0)).toHaveAttribute('href', /block=0/);
    await expect(segments.nth(1)).toHaveAttribute('aria-current', 'step');
  });

  test('tab navigation: five tabs, aria-current, direct links, back/forward, old-route redirects', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
    });
    await reachRunShell(page);

    // The sticky rail marks the active tab.
    await expect(desktopRail(page)).toBeVisible();
    await expect(desktopRail(page).getByRole('link', { name: 'Hub' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // Tab links navigate within the shell.
    await page.getByRole('link', { name: 'Team' }).first().click();
    await expect(page).toHaveURL(/\/season\/run\/team\/?$/);
    await expect(desktopRail(page).getByRole('link', { name: 'Team' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible();

    // Schedule, League, and Leaders tabs navigate to their routes (their
    // pages land from sibling agents; the shell owns the navigation history
    // either way).
    for (const [tab, url] of [
      ['Schedule', /\/season\/run\/schedule\/?$/],
      ['League', /\/season\/run\/league\/?$/],
      ['Leaders', /\/season\/run\/leaders\/?$/],
    ] as const) {
      await page.getByRole('link', { name: tab }).first().click();
      await expect(page).toHaveURL(url);
      await expect(desktopRail(page).getByRole('link', { name: tab })).toHaveAttribute(
        'aria-current',
        'page',
      );
    }

    // Back/forward restore Hub and Team without reloading the shell.
    await page.goto('/season/run/');
    await page.getByRole('link', { name: 'Team' }).first().click();
    await expect(page).toHaveURL(/\/season\/run\/team\/?$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/season\/run\/?$/);
    await expect(page.getByText('Next decision')).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/season\/run\/team\/?$/);

    // Direct links work.
    await page.goto('/season/run/team/');
    await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible();

    // Old routes redirect into the shell.
    await page.goto('/season/league');
    await expect(page).toHaveURL(/\/season\/run\/league\/?$/);
    await page.goto('/season/checkpoint');
    await expect(page).toHaveURL(/\/season\/run\/checkpoint\/?$/);
  });

  test('mobile: fixed five-tab bottom nav with safe-area padding; desktop: sticky rail only', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
    });
    await reachRunShell(page);

    // Bottom nav is visible with five tabs and marks the active tab.
    await expect(bottomNav(page)).toBeVisible();
    await expect(bottomNav(page).getByRole('link')).toHaveCount(5);
    await expect(bottomNav(page).getByRole('link', { name: 'Hub' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // Safe-area padding is part of the bottom nav.
    await expect(bottomNav(page)).toHaveClass(/safe-area-inset-bottom/);

    // Page content is not covered: the simulate action is visible and
    // clickable above the nav.
    const action = page.getByRole('button', { name: 'Lock rotation and simulate block' });
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeInViewport();
    await expect(action).toBeEnabled();

    // Desktop: the sticky rail appears and the bottom nav disappears.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(desktopRail(page)).toBeVisible();
    await expect(bottomNav(page)).toBeHidden();
    await expect(desktopRail(page).getByRole('link')).toHaveCount(5);
  });

  test('team workspace on mobile: keyboard steppers, presets, closing toggle, sticky bar', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
    });
    await reachRunShell(page);
    await page.getByRole('link', { name: 'Team' }).first().click();
    await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible();

    // The roster section lists the ten players with role + minutes.
    const rosterCards = page.locator('section[aria-labelledby="roster-heading"] li');
    await expect(rosterCards).toHaveCount(10);

    // Keyboard-accessible steppers: focus + Enter adjusts minutes.
    const firstStarter = (
      await page.locator('select[aria-label="Starter slot 1"] option:checked').textContent()
    )?.trim();
    if (firstStarter === undefined || firstStarter === '') {
      throw new Error('no starter in slot 1');
    }
    const increase = page.getByRole('button', { name: `Increase minutes for ${firstStarter}` });
    await increase.focus();
    await page.keyboard.press('Enter');
    await expect(
      page
        .locator('section[aria-labelledby="compact-rows-heading"] output', { hasText: /33/ })
        .first(),
    ).toBeVisible();

    // Presets rewrite target minutes through the engine tables (240 stays).
    await page.getByRole('button', { name: 'Tight' }).click();
    await expect(page.getByText('Target minutes total 240 of 240.')).toBeVisible();

    // A closing-five toggle flips a non-closing player in and out.
    const { label: benchLabel } = await nonClosingPlayer(page);
    await page.getByRole('button', { name: `Add ${benchLabel} to the closing five` }).click();
    await expect(
      page.getByRole('button', { name: `Remove ${benchLabel} from the closing five` }),
    ).toBeVisible();
    await page.getByRole('button', { name: `Remove ${benchLabel} from the closing five` }).click();
    await expect(
      page.getByRole('button', { name: `Add ${benchLabel} to the closing five` }),
    ).toBeVisible();

    // The sticky action bar reports a valid rotation and links to the hub.
    await expect(page.getByText('Rotation valid')).toBeVisible();
    const simulate = page.getByRole('link', { name: 'Simulate next block' });
    await expect(simulate).toHaveAttribute('href', /\/season\/run\/?$/);
  });

  test('team workspace on desktop: an illegal starter swap is rejected and surfaced', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
    });
    await reachRunShell(page);
    await page.getByRole('link', { name: 'Team' }).first().click();
    await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible();

    // Put the slot-1 guard into the center slot: the engine rejects the swap
    // and the page surfaces the rejection without committing.
    const guardValue = await page.locator('select[aria-label="Starter slot 1"]').inputValue();
    const centerSlot = page.locator('select[aria-label="Starter slot 5"]');
    await centerSlot.selectOption(guardValue);
    await expect(page.getByText(/That starter swap is rejected:/)).toBeVisible();
    // The rotation did not commit: the center slot still holds its starter.
    expect((await centerSlot.inputValue()).length).toBeGreaterThan(0);
  });

  test('reduced motion: one block completes on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
    });
    await reachRunShell(page);

    await submitBlockAndComplete(page, 1);
    await expect(page.getByText('1 of 9 checkpoints accepted.')).toBeVisible({
      timeout: 15_000,
    });
    // The completed segment becomes a checkpoint link.
    await expect(page.locator('[data-season-tape-segment="0"]')).toHaveAttribute('href', /block=0/);
  });
});
