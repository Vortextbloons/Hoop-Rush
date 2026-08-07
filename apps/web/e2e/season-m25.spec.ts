import { expect, test } from '@playwright/test';
import {
  DraftPlanner,
  loadDraftCatalog,
  reachLeagueHub,
  selectFirstObjective,
  submitBlockAndComplete,
} from './season-helpers';

/**
 * M2.5 injuries / trades / Influence journeys (spec/2.0 M2.5): the
 * checkpoint health strip, the objective picker + lock preview, the
 * Influence panel (spend affordances with confirm dialogs), the trade
 * offer accept/decline flow (through the real worker at integration), the
 * interruption/resume journey (fake runner emits one typed interruption),
 * and the mobile 390×844 + reduced-motion pass with basic a11y roles.
 *
 * The fake-runner journeys run pre-integration for the health/influence
 * surfaces; the objective selection, trade, and influence SPEND flows route
 * through the engine command handler and pass at integration.
 */

const planner = new DraftPlanner();

test.describe('season M2.5: health, objectives, Influence, trades, interruption', () => {
  test.describe.configure({ timeout: 900_000 });

  test.beforeAll(async () => {
    await loadDraftCatalog();
  });

  test('health strip, objective picker, and Influence panel after a block (fake runner)', async ({
    page,
  }) => {
    page.on('pageerror', (error) => {
      console.log('PAGE ERROR:', error.message);
    });
    await page.addInitScript(() => {
      window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
    });
    await reachLeagueHub(page, planner, { runShell: true });

    // M2.5 objective picker: three deterministic choices with aria-pressed.
    const picker = page.locator('[data-season-objective-picker]');
    await expect(picker).toBeVisible();
    const choices = picker.locator('button');
    await expect(choices).toHaveCount(3);
    await expect(choices.nth(0)).toHaveAttribute('aria-pressed', 'false');

    // Select the first objective: the picker marks it and "What locks"
    // shows it locks into the block.
    await choices.nth(0).click();
    await expect(picker.getByText('Selected').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/locks into this block/)).toBeVisible();

    await submitBlockAndComplete(page, 1, { expectBlockHeading: false });

    // M2.5 Influence panel: the fake block grant leaves the human at +3 with
    // the deterministic active injury rehab affordance.
    const influence = page.locator('[data-season-influence-panel]');
    await expect(influence).toBeVisible();
    await expect(influence.getByText('cap 8 · floor -3')).toBeVisible();
    await expect(influence.getByText('Risky rehab')).toBeVisible();
    await expect(influence.getByRole('button', { name: /Spend 2/ })).toBeEnabled();

    // M2.5 checkpoint health strip: one active injury + one returned injury
    // with an open recurrence window (fake-runner health data).
    await page.goto('/season/run/checkpoint');
    await expect(page.getByText('1 player out, 1 returning from injury').first()).toBeVisible();
    await expect(page.getByText('Out', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Recurrence risk').first()).toBeVisible();
    // The strip is a plain list with a polite live-region announcement.
    await expect(page.locator('section[aria-labelledby="health-strip-heading"]')).toBeVisible();
    await expect(
      page.locator('section[aria-labelledby="health-strip-heading"] [role="status"]'),
    ).toHaveCount(1);
  });

  test('an invalid-roster interruption pauses the block and resumes without replay (fake runner)', async ({
    page,
  }) => {
    page.on('pageerror', (error) => {
      console.log('PAGE ERROR:', error.message);
    });
    await page.addInitScript(() => {
      window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
      window.__HOOP_RUSH_E2E_INTERRUPT_ONCE__ = true;
    });
    await reachLeagueHub(page, planner, { runShell: true });
    await selectFirstObjective(page);
    await page.getByRole('button', { name: 'Lock rotation and simulate block' }).click();
    await expect(page.getByRole('progressbar')).toBeVisible();

    // The fake runner emits one typed interruption: the block pauses with
    // the invalid-roster panel and the pending candidate preserved.
    const panel = page.locator('[data-season-interruption-panel]');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByRole('heading', { name: /Block paused/ })).toBeVisible();
    await expect(panel.getByText(/Unavailable at the next tipoff/)).toBeVisible();
    await expect(panel.getByText(/1 · Repair the rotation/)).toBeVisible();
    await expect(panel.getByRole('link', { name: /Open Rotation/ })).toBeVisible();
    await expect(panel.getByText(/2 · Risky rehab/)).toBeVisible();
    await expect(panel.getByText(/3 · Forfeit the next game/)).toBeVisible();
    // The panel is a live alert region (a11y).
    await expect(panel).toHaveAttribute('role', 'alert');

    // The forfeit path is explicit (confirm dialog) — cancel keeps the pause.
    await panel.getByRole('button', { name: /Forfeit game s\d+/ }).click();
    await expect(page.getByRole('heading', { name: /Forfeit game s\d+\?/ })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Resume re-validates the pending candidate and simulates the rest of
    // the block; nothing was replayed from before the interruption.
    await panel.getByRole('button', { name: 'Resume block' }).click();
    await expect(page.getByText('Block complete.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('1 of 9 checkpoints accepted.')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-season-interruption-panel]')).toHaveCount(0);
  });

  test('trade offers accept/decline and the Influence extra-offer spend (real worker, integration)', async ({
    page,
  }) => {
    page.on('pageerror', (error) => {
      console.log('PAGE ERROR:', error.message);
    });
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('cdn.nba.com')) {
        console.log('CONSOLE ERROR:', message.text());
      }
    });
    // No fake-runner seam: the real worker simulates blocks 0-2; the engine
    // opens the first trade window after block 2's checkpoint commits.
    await reachLeagueHub(page, planner, { runShell: true });
    await submitBlockAndComplete(page, 1, { expectBlockHeading: false });
    await submitBlockAndComplete(page, 2, { expectBlockHeading: false });
    await submitBlockAndComplete(page, 3, { expectBlockHeading: false });

    const panel = page.locator('[data-season-trade-panel]');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText(/Window 1 of 3/)).toBeVisible();
    // Three base human offers render with their rationale.
    const offers = panel.locator('li').filter({ has: panel.getByText('You give') });
    await expect(offers).toHaveCount(3);
    await expect(panel.getByText(/% of outgoing/).first()).toBeVisible();
    await expect(panel.getByText(/Role fit/).first()).toBeVisible();

    // Decline the first offer through the explicit confirm dialog.
    const firstOffer = offers.nth(0);
    await firstOffer.getByRole('button', { name: 'Decline' }).click();
    await expect(page.getByRole('heading', { name: 'Decline this trade?' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(panel.getByText('Declined').first()).toBeVisible({ timeout: 15_000 });

    // M2.5 Influence spend: buy the extra trade offer (cost 1) — the
    // confirm dialog is explicit and the generated offer #4 appears.
    const influence = page.locator('[data-season-influence-panel]');
    await expect(influence).toBeVisible();
    await influence
      .getByRole('button', { name: /Spend 1/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Buy the extra trade offer?' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm spend' }).click();
    // Three base offers, one declined, one extra bought: 3 still open.
    await expect(panel.getByText(/open offers/).last()).toContainText('3 open offers', {
      timeout: 15_000,
    });

    // Accept one of the remaining open offers; the roster + ownership move
    // atomically and the offer records as accepted.
    const openOffer = panel
      .locator('li')
      .filter({ has: panel.getByText('Open') })
      .first();
    await openOffer.getByRole('button', { name: 'Accept' }).click();
    await expect(page.getByRole('heading', { name: 'Accept this trade?' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(panel.getByText('Accepted').first()).toBeVisible({ timeout: 15_000 });
  });

  test('mobile 390×844 with reduced motion renders the M2.5 surfaces (fake runner)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
    });
    await reachLeagueHub(page, planner, { runShell: true });

    // The objective picker and the bottom nav render on the mobile viewport.
    await expect(page.locator('[data-season-objective-picker]')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Season navigation' })).toBeVisible();
    // No horizontal overflow on the narrow viewport.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await submitBlockAndComplete(page, 1, { expectBlockHeading: false });
    await page.goto('/season/run/checkpoint');
    await expect(
      page.locator('section[aria-labelledby="health-strip-heading"]').first(),
    ).toBeVisible();
    await expect(page.getByText('Recurrence risk').first()).toBeVisible();
  });
});
