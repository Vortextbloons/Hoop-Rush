import { expect, test, type Page } from '@playwright/test';
import {
  DraftPlanner,
  loadDraftCatalog,
  reachLeagueHub,
  submitBlockAndComplete,
} from './season-helpers';

/**
 * M2.4 stamina/chemistry journeys (spec/2.0/05, M2.4): the "Season rules
 * changed" discard-and-restart screen for legacy runs, the fatigue bands +
 * chemistry panels on the Team tab, the Hub fatigue-risk projections, and
 * (through the real worker) the checkpoint mechanism-evidence section.
 *
 * The recovery journey injects a legacy stored run row directly into
 * IndexedDB and asserts the two-step discard flow never auto-deletes.
 */

const planner = new DraftPlanner();

/** Injects a minimal legacy stored run row (save-schema v1, schema-4 run). */
async function injectLegacyRun(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('hoop-rush-saves');
      request.onupgradeneeded = () => {
        const d = request.result;
        if (!d.objectStoreNames.contains('seasonRuns')) {
          d.createObjectStore('seasonRuns', { keyPath: 'recordId' });
        }
        if (!d.objectStoreNames.contains('seasonRunIndex')) {
          d.createObjectStore('seasonRunIndex', { keyPath: 'recordId' });
        }
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('opening hoop-rush-saves failed'));
      };
    });
    const legacyRow = {
      recordId: 'season-run',
      saveSchemaVersion: 1,
      run: {
        runId: 'legacy-m23-run-1',
        schemaVersion: 4,
        versions: { runSchemaVersion: 4 },
      },
    };
    const tx = db.transaction(['seasonRuns'], 'readwrite');
    tx.objectStore('seasonRuns').put(legacyRow);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = () => {
        reject(tx.error ?? new Error('legacy row injection failed'));
      };
    });
    db.close();
  });
}

/** Reads whether the stored season-run row still exists. */
async function legacyRowCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('hoop-rush-saves');
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('opening hoop-rush-saves failed'));
      };
    });
    const count = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(['seasonRuns'], 'readonly');
      const request = tx.objectStore('seasonRuns').count();
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('count failed'));
      };
    });
    db.close();
    return count;
  });
}

test.describe('season M2.4: legacy recovery, fatigue and chemistry surfaces', () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeAll(async () => {
    await loadDraftCatalog();
  });

  test('a stored legacy run shows the two-step discard screen and is never auto-deleted', async ({
    page,
  }) => {
    // Land on the app origin first: IndexedDB is denied on about:blank.
    await page.goto('/');
    await injectLegacyRun(page);

    await page.goto('/season/run');
    await expect(
      page.getByRole('heading', { name: 'This saved season was made with the old rules' }),
    ).toBeVisible();
    // The legacy row must survive the load attempt.
    expect(await legacyRowCount(page)).toBe(1);

    // Step 1: the screen explains and offers the destructive action.
    const discardButton = page.getByRole('button', { name: 'Discard run and restart' });
    await expect(discardButton).toBeVisible();
    await expect(page.getByText(/schema 4/i).first()).toBeVisible();

    // Step 2: the confirmation dialog must be explicit.
    await discardButton.click();
    const confirm = page.getByRole('button', { name: 'Yes, discard the season' });
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Discard this season?' })).toBeVisible();

    // Cancel first: nothing is deleted.
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(await legacyRowCount(page)).toBe(1);

    // Confirm: the run is discarded and the setup page opens.
    await discardButton.click();
    await confirm.click();
    await page.waitForURL(/\/season\/?$/);
    expect(await legacyRowCount(page)).toBe(0);
  });

  test('Team tab shows fatigue bands, last-game minutes, and unit chemistry after a block', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
    });
    await reachLeagueHub(page, planner, { runShell: true });
    await submitBlockAndComplete(page, 1, { expectBlockHeading: false });

    await page.goto('/season/run/team');
    // The chemistry panel (M2.4) renders with the recorded zero state.
    await expect(page.getByText('Unit chemistry', { exact: true })).toBeVisible();
    await expect(page.getByText('Active lineup')).toBeVisible();
    // Fatigue band pills on the rotation rows (band label and percent are
    // separate text nodes inside the pill span).
    await expect(page.getByText('Fresh').first()).toBeVisible();
    await expect(page.getByText('0%').first()).toBeVisible();
    // Shared-play evidence rows (pairs from the ten-player roster).
    await expect(page.getByText('Most shared play', { exact: true })).toBeVisible();
    await expect(page.getByText('Least shared play', { exact: true })).toBeVisible();
    // Last-game minutes render beside the rotation rows.
    await expect(page.getByText(/last game \d+ min/).first()).toBeVisible();
  });

  test('Hub shows the fatigue-risk projection for the pending rotation', async ({ page }) => {
    await page.addInitScript(() => {
      window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
    });
    await reachLeagueHub(page, planner, { runShell: true });
    await submitBlockAndComplete(page, 1, { expectBlockHeading: false });

    await expect(page.getByText(/Fatigue risk after 10 games/)).toBeVisible();
    // Projections are labeled as projections, not predictions.
    await expect(page.getByText(/Projected from the pending rotation/)).toBeVisible();
    // A band arrow renders for at least one pending starter.
    await expect(page.locator('text=Fresh').first()).toBeVisible();
  });

  test('checkpoint recap reports mechanism evidence through the real worker', async ({ page }) => {
    page.on('pageerror', (error) => {
      console.log('PAGE ERROR:', error.message);
    });
    page.on('console', (message) => {
      // External CDN logos are blocked in the sandboxed test environment.
      if (message.type() === 'error' && !message.text().includes('cdn.nba.com')) {
        console.log('CONSOLE ERROR:', message.text());
      }
    });
    await reachLeagueHub(page, planner, { runShell: true });
    // No fake-runner seam: the real block worker simulates the block with
    // the M2.4 effects seam and commits retained details with evidence.
    // Capture the runner events so a worker failure carries its message.
    await page.evaluate(() => {
      const runner = (window as { __HOOP_RUSH_SEASON_BLOCK_RUNNER__?: unknown })
        .__HOOP_RUSH_SEASON_BLOCK_RUNNER__ as {
        subscribe?: (listener: (event: unknown) => void) => () => void;
      } | null;
      (window as { __M24_EVENTS__?: unknown[] }).__M24_EVENTS__ = [];
      runner?.subscribe((event: unknown) => {
        (window as { __M24_EVENTS__?: unknown[] }).__M24_EVENTS__?.push(event);
      });
    });
    await page.getByRole('button', { name: 'Lock rotation and simulate block' }).click();
    await expect(page.getByRole('progressbar')).toBeVisible();
    // The real worker simulates the block; wait deterministically for the
    // runner's terminal event (complete or error) inside a single budget.
    // A failure carries the captured event stream in the assertion message.
    await expect(async () => {
      const events = await page.evaluate(() =>
        JSON.stringify((window as { __M24_EVENTS__?: unknown[] }).__M24_EVENTS__ ?? []),
      );
      if (!events.includes('"complete"') && !events.includes('"error"')) {
        throw new Error(`worker still running; latest events: ${events.slice(-200)}`);
      }
    }).toPass({ timeout: 150_000 });
    await expect(page.getByText('Block complete.')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('1 of 9 checkpoints accepted.')).toBeVisible({
      timeout: 15_000,
    });
    await page.goto('/season/run/checkpoint');

    await expect(page.getByRole('heading', { name: 'Stamina and chemistry' })).toBeVisible();
    // Mechanism rows carry opportunity counts and bounded movement.
    await expect(page.getByText(/opportunities/).first()).toBeVisible();
    await expect(page.getByText(/probability movement/).first()).toBeVisible();
  });
});
