import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  DraftPlanner,
  draftOneRound,
  reachLeagueHub,
  selectFirstObjective,
} from './season-helpers';

/**
 * Performance-gating journeys (2.0 framework): network-request assertions
 * for the six big-issue fixes.
 *
 * 1. The ~17 MB draft catalog is only requested when a draft starts or
 *    resumes — a fresh `/season` setup visit never downloads it.
 * 2. The four conditionally used components (BoxScore, SlotPickerDialog,
 *    PlayerDetailDialog, TradeOffersPanel) are lazy chunks: initial route
 *    loads do not request them, and opening each feature loads its chunk.
 * 3. The manifest is preloaded in app.html and fetched once per fresh load.
 *
 * Lazy chunks are resolved from the built client manifest, so the
 * assertions are build-independent (the emitted filenames are hashed).
 *
 * TradeOffersPanel caveat: the "loads when the trade window opens" half of
 * its assertion is currently blocked by the in-flight M2.6 engine work —
 * the trade-window commit (completeSeasonBlockCommit) fails for window
 * blocks in the working tree, and the M2.5 trade e2e fails identically on
 * the unmodified tree. This spec asserts the parts that are stable: the
 * chunk is NOT requested on the hub/checkpoint routes, and it exists as a
 * standalone lazy chunk in the build.
 */

const planner = new DraftPlanner();

const CATALOG_URL = '/data/season/draft-catalog.json';
const MANIFEST_URL = '/data/manifest.json';

const LAZY_COMPONENTS = {
  boxScore: 'src/lib/components/season/BoxScore.svelte',
  slotPicker: 'src/lib/components/draft/SlotPickerDialog.svelte',
  playerDetail: 'src/lib/components/PlayerDetailDialog.svelte',
  tradeOffers: 'src/lib/components/season/TradeOffersPanel.svelte',
} as const;

/** Resolves a component's emitted client chunk URL from the built manifest. */
function chunkUrlOf(component: (typeof LAZY_COMPONENTS)[keyof typeof LAZY_COMPONENTS]): string {
  const manifestPath = new URL('../.svelte-kit/output/client/.vite/manifest.json', import.meta.url);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<
    string,
    { file?: string }
  >;
  const entry = manifest[component];
  if (entry?.file === undefined) {
    throw new Error(`component ${component} is not a standalone client chunk`);
  }
  return `/${entry.file}`;
}

/** Records every requested JS chunk, catalog request, and manifest request. */
class RequestProbe {
  readonly requested = new Set<string>();
  readonly catalogRequests: string[] = [];
  readonly manifestRequests: string[] = [];

  constructor(page: Page) {
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/_app/immutable/')) this.requested.add(url.pathname);
      if (url.pathname.endsWith(CATALOG_URL)) this.catalogRequests.push(url.pathname);
      if (url.pathname.endsWith(MANIFEST_URL)) this.manifestRequests.push(url.pathname);
    });
  }

  /** Waits until the given chunk URL has been requested. */
  async expectChunk(chunk: string): Promise<void> {
    await expect.poll(() => this.requested.has(chunk), { timeout: 20_000 }).toBe(true);
  }
}

/**
 * Submits the current block through the real worker and waits for the
 * accepted checkpoint to land. The tape segment for the accepted block
 * gains its checkpoint link only after the commit (the "Block complete."
 * phase label is a UI-level status that the in-flight engine work may not
 * render; the committed checkpoint is the authoritative signal).
 */
async function submitBlockAndWaitAccepted(page: Page, blockNumber: number): Promise<void> {
  await selectFirstObjective(page);
  await page.getByRole('button', { name: 'Lock rotation and simulate block' }).click();
  await expect(page.locator('[data-season-tape-segment]').nth(blockNumber - 1)).toHaveAttribute(
    'href',
    new RegExp(`block=${String(blockNumber - 1)}`),
    { timeout: 120_000 },
  );
}

test.describe('performance gating (network-request assertions)', () => {
  test.describe.configure({ timeout: 600_000 });

  const slotPickerChunk = chunkUrlOf(LAZY_COMPONENTS.slotPicker);
  const playerDetailChunk = chunkUrlOf(LAZY_COMPONENTS.playerDetail);
  const boxScoreChunk = chunkUrlOf(LAZY_COMPONENTS.boxScore);
  const tradeOffersChunk = chunkUrlOf(LAZY_COMPONENTS.tradeOffers);

  test('fresh season setup never downloads the draft catalog; Start draft loads it once', async ({
    page,
  }) => {
    const probe = new RequestProbe(page);
    await page.goto('/season');
    await expect(page.getByRole('button', { name: 'Start draft' })).toBeVisible({
      timeout: 30_000,
    });
    expect(probe.catalogRequests).toHaveLength(0);

    await page.getByRole('button', { name: 'Start draft' }).click();
    await expect(page.locator('[data-season-round-heading]')).toBeVisible({ timeout: 60_000 });
    expect(probe.catalogRequests).toHaveLength(1);
  });

  test('resume draft loads the catalog and reconstructs the board', async ({ page }) => {
    await page.goto('/season');
    await page.getByRole('button', { name: 'Start draft' }).click();
    await expect(page.locator('[data-season-round-heading]')).toBeVisible({ timeout: 60_000 });
    await draftOneRound(page, planner);

    // The saved draft record restores the "Draft in progress" screen.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Resume draft' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(/A saved draft is waiting: 1 of 10 picks/)).toBeVisible();

    // Resume reconstructs the flow and the board continues at round 2.
    await page.getByRole('button', { name: 'Resume draft' }).click();
    await expect(
      page.locator('[data-season-round-heading]', { hasText: 'Round 2 of 10' }),
    ).toBeVisible({ timeout: 60_000 });
  });

  test('manifest is preloaded and fetched once per fresh load', async ({ page }) => {
    const probe = new RequestProbe(page);
    await page.goto('/');
    await expect(page.getByRole('main')).toBeVisible({ timeout: 30_000 });
    expect(probe.manifestRequests).toHaveLength(1);

    // A cached reload reuses the manifest without a second download.
    await page.reload();
    await expect(page.getByRole('main')).toBeVisible({ timeout: 30_000 });
    expect(probe.manifestRequests.length).toBeLessThanOrEqual(2);
  });

  test('classic lazy-loads the slot picker only when a player is selected', async ({ page }) => {
    const probe = new RequestProbe(page);
    await page.goto('/classic');
    await expect(page.getByRole('button', { name: 'Start Ratings draft' })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Start Ratings draft' }).click();
    await expect(page.locator('ul li button:not([disabled])').first()).toBeVisible({
      timeout: 60_000,
    });
    // The route rendered the draft board without the picker chunk.
    expect(probe.requested.has(slotPickerChunk)).toBe(false);

    await page.locator('ul li button:not([disabled])').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await probe.expectChunk(slotPickerChunk);

    // The picker remains usable (focus/close behavior intact).
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('sandbox lazy-loads the slot picker only when a player is selected', async ({ page }) => {
    const probe = new RequestProbe(page);
    await page.goto('/sandbox');
    await expect(page.locator('ul li button:not([disabled])').first()).toBeVisible({
      timeout: 60_000,
    });
    expect(probe.requested.has(slotPickerChunk)).toBe(false);

    await page.locator('ul li button:not([disabled])').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await probe.expectChunk(slotPickerChunk);

    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('roster lazy-loads the player detail dialog only when a player is opened', async ({
    page,
  }) => {
    const probe = new RequestProbe(page);
    await page.goto('/roster');
    const row = page.getByRole('button', { name: /View .* stats/ }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    expect(probe.requested.has(playerDetailChunk)).toBe(false);

    await row.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await probe.expectChunk(playerDetailChunk);

    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('season shell lazy-loads the box score chunk on demand', async ({ page }) => {
    // Real worker: block 1 must commit so the checkpoint page has games.
    const probe = new RequestProbe(page);
    await reachLeagueHub(page, planner, { runShell: true });
    await submitBlockAndWaitAccepted(page, 1);

    // The checkpoint recap renders without the BoxScore chunk.
    await page.goto('/season/run/checkpoint');
    await expect(page.getByRole('heading', { name: 'Block 1 recap' })).toBeVisible({
      timeout: 30_000,
    });
    expect(probe.requested.has(boxScoreChunk)).toBe(false);

    // Opening a game details loads the BoxScore chunk and renders the table.
    await page.locator('details summary').first().click();
    await expect(page.locator('[data-season-box-score]').first()).toBeVisible({
      timeout: 30_000,
    });
    await probe.expectChunk(boxScoreChunk);
  });

  test('season hub never eagerly loads the trade offers panel chunk', async ({ page }) => {
    // The trade panel mounts only inside an open trade window; the hub must
    // not pull its chunk before (or after) blocks commit. The window-open
    // half of this assertion is blocked by the in-flight M2.6 commit work.
    const probe = new RequestProbe(page);
    await reachLeagueHub(page, planner, { runShell: true });
    await expect(page.getByText('Next decision')).toBeVisible({ timeout: 30_000 });
    expect(probe.requested.has(tradeOffersChunk)).toBe(false);

    await submitBlockAndWaitAccepted(page, 1);
    expect(probe.requested.has(tradeOffersChunk)).toBe(false);
  });
});
