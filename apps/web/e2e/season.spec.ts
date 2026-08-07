import { expect, test } from '@playwright/test';
import { SEASON_ALIGNMENT } from '@hoop-rush/data-contracts';
import { DraftPlanner, draftOneRound, reachLeagueHub } from './season-helpers';

/**
 * Season Run M2.3.5 draft journeys (season-draft-v2): home -> /season -> ten
 * rounds of global eight-card offers (draw + pick), finalize, AI generation,
 * promotion into the /season/run shell (masthead + nine-segment season tape +
 * "Lock rotation and simulate block"), draft resume across a reload, and the
 * legacy season-draft-v1 recovery screen (a v1-shaped stored draft injected
 * into IndexedDB surfaces "Draft rules changed" and discards explicitly).
 *
 * The block worker is not required for these journeys: block execution uses
 * the deterministic fake `SeasonBlockRunner` (commits through the
 * authoritative engine seam folds, so reload audits pass exactly like a real
 * checkpoint). The draft, AI generation, and promotion run the real engine
 * and the real IndexedDB repository. Draft scaffolding (the lazy-loaded
 * catalog, feasibility-safe planner, and round helpers) lives in
 * season-helpers.ts.
 */

const planner = new DraftPlanner();

test.describe('season run: draft journey, resume, legacy recovery', () => {
  test.describe.configure({ timeout: 180_000 });

  test(
    'home card, ten-round draft, AI generation, promotion, and run shell',
    { tag: '@smoke' },
    async ({ page }) => {
      await page.addInitScript(() => {
        window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
      });
      await page.goto('/');
      await page.getByRole('link', { name: /Start season run/ }).click();
      await expect(page).toHaveURL(/\/season\/?$/);
      await expect(page.getByRole('heading', { name: 'Ten rounds. One league.' })).toBeVisible();

      await reachLeagueHub(page, planner);

      // The shell presents the masthead, nine tape segments, and the action.
      const mastheadHeading = page.getByRole('heading', { level: 1 });
      await expect(mastheadHeading).toBeVisible();
      expect((await mastheadHeading.textContent())?.trim().length ?? 0).toBeGreaterThan(0);
      const segments = page.locator('[data-season-tape-segment]');
      await expect(segments).toHaveCount(9);
      await expect(segments.nth(0)).toHaveAttribute('aria-current', 'step');
      await expect(
        page.getByRole('button', { name: 'Lock rotation and simulate block' }),
      ).toBeEnabled();

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
    await draftOneRound(page, planner);
    await draftOneRound(page, planner);

    await page.reload();
    await expect(page.getByRole('button', { name: 'Resume draft' })).toBeVisible();
    await page.getByRole('button', { name: 'Resume draft' }).click();
    await expect(
      page.locator('[data-season-round-heading]', { hasText: 'Round 3 of 10' }),
    ).toBeVisible();
    // The draft keeps its picks after resume.
    await expect(page.getByText('2 of 10 picked')).toBeVisible();
  });

  test('a stored legacy season-draft-v1 draft shows the recovery screen and discards explicitly', async ({
    page,
  }) => {
    // Land on the app origin first: IndexedDB is denied on about:blank.
    await page.goto('/');
    // Inject a v1-shaped stored draft (saveSchemaVersion 1) directly into
    // IndexedDB, mirroring a save left by the old franchise-era draft.
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('hoop-rush-saves');
        request.onupgradeneeded = () => {
          const d = request.result;
          if (!d.objectStoreNames.contains('seasonDrafts')) {
            d.createObjectStore('seasonDrafts', { keyPath: 'recordId' });
          }
        };
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(request.error ?? new Error('opening hoop-rush-saves failed'));
        };
      });
      // The stored v1 record must pass the frozen league schema: 30 teams
      // with the league-v1 conference/division alignment (canonical source:
      // SEASON_ALIGNMENT in @hoop-rush/data-contracts).
      const alignment = SEASON_ALIGNMENT.map(
        ({ franchiseId, conference, division }) => [franchiseId, conference, division] as const,
      );
      const legacy = {
        recordId: 'season-draft',
        saveSchemaVersion: 1,
        generation: null,
        draft: {
          schemaVersion: 1,
          draftVersion: 'season-draft-v1',
          runId: 'legacy-run-1',
          rootSeed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
          league: {
            schemaVersion: 1,
            leagueVersion: 'league-v1',
            teams: alignment.map(([franchiseId, conference, division], index) => ({
              franchiseId,
              control: index === 0 ? 'human' : 'ai',
              conference,
              division,
            })),
          },
          catalogVersion: 'season-draft-v1',
          participants: [{ participantId: 'human', franchiseId: 'lakers' }],
          firstPickParticipantId: 'human',
          round: 3,
          currentTurnParticipantId: 'human',
          status: 'drafting',
          revision: 5,
          currentReveal: {
            participantId: 'human',
            round: 3,
            pickOrdinal: 3,
            attempts: [{ franchiseId: 'lakers', eraId: '1990s', attemptIndex: 0, usable: true }],
          },
          rolls: [{ franchiseId: 'lakers', eraId: '1990s', attemptIndex: 0, usable: true }],
          claims: [],
          picks: [
            {
              participantId: 'human',
              round: 1,
              pickOrdinal: 1,
              playerVersionId: `pv-${'0'.repeat(32)}`,
              franchiseId: 'lakers',
              eraId: '1990s',
              rollAttempts: 1,
            },
          ],
          commandLog: [],
        },
      };
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('seasonDrafts', 'readwrite');
        tx.objectStore('seasonDrafts').put(legacy);
        tx.oncomplete = () => {
          resolve();
        };
        tx.onerror = () => {
          reject(tx.error ?? new Error('seasonDrafts transaction failed'));
        };
      });
      db.close();
    });

    // The injected record must be readable by the app's own storage boundary.
    // IndexedDB serializes opens against the app's Dexie upgrades, so retry
    // until the row reads back as the v1 record.
    let stored: unknown = null;
    for (let attempt = 0; attempt < 5 && stored === null; attempt += 1) {
      await page.waitForTimeout(200);
      stored = await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('hoop-rush-saves');
          request.onsuccess = () => {
            resolve(request.result);
          };
          request.onerror = () => {
            reject(request.error ?? new Error('opening hoop-rush-saves failed'));
          };
        });
        const row = await new Promise<unknown>((resolve, reject) => {
          const tx = db.transaction('seasonDrafts', 'readonly');
          const get = tx.objectStore('seasonDrafts').get('season-draft');
          get.onsuccess = () => {
            resolve(get.result);
          };
          get.onerror = () => {
            reject(get.error ?? new Error('reading season-draft failed'));
          };
        });
        db.close();
        return row;
      });
    }
    expect((stored as { saveSchemaVersion?: number } | null)?.saveSchemaVersion).toBe(1);

    await page.goto('/season');
    await expect(page.getByText('Draft rules changed')).toBeVisible();
    await expect(page.getByText(/was made with the old rules/)).toBeVisible();

    // The legacy draft is never auto-deleted: it stays until the user acts.
    await page.reload();
    await expect(page.getByText('Draft rules changed')).toBeVisible();

    // The explicit discard clears the legacy record and returns to setup.
    await page.getByRole('button', { name: 'Discard and restart' }).click();
    await expect(page.getByRole('button', { name: 'Start draft' })).toBeVisible();

    // A fresh v2 draft can then start normally.
    await page.getByRole('button', { name: 'Start draft' }).click();
    await expect(page.locator('[data-season-round-heading]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Draw round 1 offer' })).toBeVisible();
  });

  test('a completed draft promotes into the run shell after reload', async ({ page }) => {
    await page.addInitScript(() => {
      window.__HOOP_RUSH_E2E_FAKE_RUNNER__ = true;
    });
    await reachLeagueHub(page, planner);

    // Reloading the shell keeps the promoted run (draft record was consumed).
    await page.reload();
    await expect(page.getByText('Next decision')).toBeVisible({ timeout: 30_000 });
    const segments = page.locator('[data-season-tape-segment]');
    await expect(segments).toHaveCount(9);
  });
});
