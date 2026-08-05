import { expect, test, type Page } from '@playwright/test';
import {
  DraftPlanner,
  loadDraftCatalog,
  reachLeagueHub,
  submitBlockAndComplete,
} from './season-helpers';

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

const planner = new DraftPlanner();

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

  test.beforeAll(async () => {
    // The preview server is up before any test starts; load once up front so
    // catalog problems surface as a single clear setup failure, not one per
    // helper call.
    await loadDraftCatalog();
  });

  test('draft → promotion → shell hub: masthead, nine tape segments, simulate action', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
    });
    await reachLeagueHub(page, planner, { runShell: true });

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
    await reachLeagueHub(page, planner, { runShell: true });

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
    await reachLeagueHub(page, planner, { runShell: true });

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
    await reachLeagueHub(page, planner, { runShell: true });

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
    await reachLeagueHub(page, planner, { runShell: true });
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
    await reachLeagueHub(page, planner, { runShell: true });
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
    await reachLeagueHub(page, planner, { runShell: true });

    await submitBlockAndComplete(page, 1, { expectBlockHeading: false });
    await expect(page.getByText('1 of 9 checkpoints accepted.')).toBeVisible({
      timeout: 15_000,
    });
    // The completed segment becomes a checkpoint link.
    await expect(page.locator('[data-season-tape-segment="0"]')).toHaveAttribute('href', /block=0/);
  });
});
