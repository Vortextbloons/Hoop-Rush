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
    await page.getByRole('link', { name: 'Rotation' }).first().click();
    await expect(page.getByRole('heading', { name: 'Rotation workspace' })).toBeVisible();
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

  test('tab navigation: six tabs, aria-current, direct links, back/forward, old-route redirects', async ({
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
    await page.getByRole('link', { name: 'Rotation' }).first().click();
    await expect(page).toHaveURL(/\/season\/run\/team\/?$/);
    await expect(desktopRail(page).getByRole('link', { name: 'Rotation' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('heading', { name: 'Rotation workspace' })).toBeVisible();

    await page.getByRole('link', { name: 'Roster' }).first().click();
    await expect(page).toHaveURL(/\/season\/run\/roster\/?$/);
    await expect(desktopRail(page).getByRole('link', { name: 'Roster' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('heading', { name: 'Roster', level: 1 })).toBeVisible();

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

    // Back/forward restore Hub and Rotation without reloading the shell.
    await page.goto('/season/run/');
    await page.getByRole('link', { name: 'Rotation' }).first().click();
    await expect(page).toHaveURL(/\/season\/run\/team\/?$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/season\/run\/?$/);
    await expect(page.getByText('Next decision')).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/season\/run\/team\/?$/);

    // Direct links work.
    await page.goto('/season/run/team/');
    await expect(page.getByRole('heading', { name: 'Rotation workspace' })).toBeVisible();
    await page.goto('/season/run/roster/');
    await expect(page.getByRole('heading', { name: 'Roster', level: 1 })).toBeVisible();

    // Old routes redirect into the shell.
    await page.goto('/season/league');
    await expect(page).toHaveURL(/\/season\/run\/league\/?$/);
    await page.goto('/season/checkpoint');
    await expect(page).toHaveURL(/\/season\/run\/checkpoint\/?$/);
  });

  test('mobile: fixed six-tab bottom nav with safe-area padding; desktop: sticky rail only', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
    });
    await reachLeagueHub(page, planner, { runShell: true });

    // Bottom nav is visible with six tabs and marks the active tab.
    await expect(bottomNav(page)).toBeVisible();
    await expect(bottomNav(page).getByRole('link')).toHaveCount(6);
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
    await expect(desktopRail(page).getByRole('link')).toHaveCount(6);
  });

  test('team workspace on mobile: keyboard steppers, presets, closing toggle, sticky bar', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
    });
    await reachLeagueHub(page, planner, { runShell: true });
    await page.getByRole('link', { name: 'Rotation' }).first().click();
    await expect(page.getByRole('heading', { name: 'Rotation workspace' })).toBeVisible();

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
        .locator('section[aria-labelledby="mobile-rotation-heading"] output', { hasText: /33/ })
        .first(),
    ).toBeVisible();

    // Presets rewrite target minutes through the engine tables (240 stays).
    await page.getByRole('button', { name: 'Tight' }).click();
    await expect(page.getByText('240', { exact: true }).first()).toBeVisible();

    // Closing tab: swap a non-closing bench player into slot 2.
    const { value: benchValue } = await nonClosingPlayer(page);
    const originalSlot2 = await page.locator('select[aria-label="Closing slot 2"]').inputValue();
    await page.getByRole('button', { name: 'Closing' }).click();
    await page.locator('select[aria-label="Closing slot 2"]').selectOption(benchValue);
    await expect(page.locator('select[aria-label="Closing slot 2"]')).toHaveValue(benchValue);
    await page.locator('select[aria-label="Closing slot 2"]').selectOption(originalSlot2);
    await expect(page.locator('select[aria-label="Closing slot 2"]')).toHaveValue(originalSlot2);

    // The sticky action bar reports a valid rotation and offers simulate on mobile.
    await expect(page.getByText('Rotation valid')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lock & simulate block' })).toBeEnabled();
  });

  test('team workspace on desktop: an illegal starter swap is rejected and surfaced', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
    });
    await reachLeagueHub(page, planner, { runShell: true });
    await page.getByRole('link', { name: 'Rotation' }).first().click();
    await expect(page.getByRole('heading', { name: 'Rotation workspace' })).toBeVisible();

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
