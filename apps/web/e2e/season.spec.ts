import { expect, test, type Page } from '@playwright/test';
import {
  seasonDraftCatalogSchema,
  type SeasonDraftCatalog,
  type SeasonDraftCandidate,
} from '@hoop-rush/data-contracts';
import { rosterFeasible, type SeasonRosterMemberInput } from '@hoop-rush/engine';

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
 * and the real IndexedDB repository.
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

  /** Chooses the first offer card the engine's feasibility probe accepts. */
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
    throw new Error('no feasibility-safe candidate in the drawn offer');
  }

  record(candidate: SeasonDraftCandidate): void {
    this.picked.push({
      playerVersionId: candidate.playerVersionId,
      playable: candidate.positions.playable,
    });
  }
}

const planner = new DraftPlanner();
/** The board's current-offer section (aria-labelledby="season-offer-heading"). */
function offerSection(page: Page) {
  return page.locator('section[aria-labelledby="season-offer-heading"]');
}

/**
 * Resolves the drawn offer cards to catalog candidates. Cards render the
 * displayName on one line and "<seasonKey> · <positions>" on the next, so
 * each card is matched by its own name + season pair (displayName alone is
 * ambiguous when several versions of one person share it).
 */
async function offerCardCandidates(page: Page): Promise<SeasonDraftCandidate[]> {
  const cards = offerSection(page).locator('li');
  const count = await cards.count();
  const candidates: SeasonDraftCandidate[] = [];
  for (let i = 0; i < count; i += 1) {
    const text = await cards.nth(i).innerText();
    const lines = text.split('\n').map((line) => line.trim());
    const name = lines.find((line) => CATALOG.candidates.some((c) => c.displayName === line));
    const season = lines
      .find((line) => /^\d{4}-\d{2}/.test(line))
      ?.split('·')[0]
      ?.trim();
    const candidate = CATALOG.candidates.find(
      (c) => c.displayName === name && c.seasonKey === season,
    );
    if (candidate !== undefined) candidates.push(candidate);
  }
  return candidates;
}

/** Drafts one round: draw the eight-card offer, then pick a safe card. */
async function draftOneRound(page: Page) {
  await page.getByRole('button', { name: /^Draw round \d+ offer$/ }).click();
  await expect(page.getByText(/^Offer · pick \d+$/)).toBeVisible();

  const candidates = await offerCardCandidates(page);
  expect(candidates.length).toBe(8);
  const target = planner.choose(candidates);

  await offerSection(page)
    .locator('li')
    .filter({ hasText: `${target.displayName} ${target.seasonKey}` })
    .getByRole('button', { name: 'Pick' })
    .click();
  await expect(page.getByText(/^Offer · pick \d+$/)).toHaveCount(0, { timeout: 5000 });
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

/** Runs the full setup journey: draft, AI generation, promotion, run shell. */
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
  await expect(page).toHaveURL(/\/season\/run\/?$/, { timeout: 30_000 });
  await expect(page.getByText('Next decision')).toBeVisible({ timeout: 30_000 });
}

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

      await reachRunShell(page);

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
    await draftOneRound(page);
    await draftOneRound(page);

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
      // with the league-v1 conference/division alignment.
      const alignment = [
        ['hawks', 'east', 'southeast'],
        ['celtics', 'east', 'atlantic'],
        ['nets', 'east', 'atlantic'],
        ['hornets', 'east', 'southeast'],
        ['bulls', 'east', 'central'],
        ['cavaliers', 'east', 'central'],
        ['pistons', 'east', 'central'],
        ['pacers', 'east', 'central'],
        ['heat', 'east', 'southeast'],
        ['bucks', 'east', 'central'],
        ['knicks', 'east', 'atlantic'],
        ['magic', 'east', 'southeast'],
        ['sixers', 'east', 'atlantic'],
        ['raptors', 'east', 'atlantic'],
        ['wizards', 'east', 'southeast'],
        ['mavericks', 'west', 'southwest'],
        ['nuggets', 'west', 'northwest'],
        ['warriors', 'west', 'pacific'],
        ['rockets', 'west', 'southwest'],
        ['clippers', 'west', 'pacific'],
        ['lakers', 'west', 'pacific'],
        ['grizzlies', 'west', 'southwest'],
        ['timberwolves', 'west', 'northwest'],
        ['pelicans', 'west', 'southwest'],
        ['thunder', 'west', 'northwest'],
        ['suns', 'west', 'pacific'],
        ['blazers', 'west', 'northwest'],
        ['kings', 'west', 'pacific'],
        ['spurs', 'west', 'southwest'],
        ['jazz', 'west', 'northwest'],
      ] as const;
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
    await reachRunShell(page);

    // Reloading the shell keeps the promoted run (draft record was consumed).
    await page.reload();
    await expect(page.getByText('Next decision')).toBeVisible({ timeout: 30_000 });
    const segments = page.locator('[data-season-tape-segment]');
    await expect(segments).toHaveCount(9);
  });
});
