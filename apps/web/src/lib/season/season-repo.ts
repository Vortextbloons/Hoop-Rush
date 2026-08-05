import type { SeasonRunRepository } from '@hoop-rush/persistence';
import type { SeasonSchedule } from '@hoop-rush/data-contracts';
import type { SeasonBlockRunner, SeasonBlockStartInput } from '$lib/season/season-block-runner';

/**
 * Application singletons for the Season Run repository and block runner.
 *
 * Both implementations land from sibling agents in parallel with this UI:
 * - The persistence agent implements `DexieSeasonRunRepository` (frozen
 *   contract in `packages/persistence/src/repositories/season-run.ts`). The
 *   repository needs the packaged schedule artifact to reconstruct finalized
 *   games, so callers that load full snapshots supply it.
 * - The lead implements the `SeasonBlockRunner` in
 *   `apps/web/src/lib/season/season-block-runner.ts` (the frozen interface
 *   file already declares the contract).
 *
 * Imports are dynamic so the M2.3 screens build and test before those
 * implementations land. A window seam (`__HOOP_RUSH_SEASON_BLOCK_RUNNER__`)
 * lets e2e inject a deterministic fake runner through the frozen interface.
 */

declare global {
  interface Window {
    __HOOP_RUSH_SEASON_BLOCK_RUNNER__?: SeasonBlockRunner;
    __HOOP_RUSH_E2E_FAKE_RUNNER__?: boolean;
  }
}

let repoPlainPromise: Promise<SeasonRunRepository> | null = null;
let repoSchedulePromise: Promise<SeasonRunRepository> | null = null;

/**
 * The concrete IndexedDB Season Run repository (lazy, once per schedule
 * supply). `loadActiveRun()` requires the schedule; index-only callers
 * (home resume) may omit it.
 */
export function getSeasonRunRepository(schedule?: SeasonSchedule): Promise<SeasonRunRepository> {
  if (schedule) {
    if (repoSchedulePromise === null) {
      repoSchedulePromise = createRepo({ schedule });
      repoSchedulePromise.catch(() => {
        repoSchedulePromise = null;
      });
    }
    return repoSchedulePromise;
  }
  if (repoPlainPromise === null) {
    repoPlainPromise = createRepo({});
    repoPlainPromise.catch(() => {
      repoPlainPromise = null;
    });
  }
  return repoPlainPromise;
}

async function createRepo(options: { schedule?: SeasonSchedule }): Promise<SeasonRunRepository> {
  const module = (await import('@hoop-rush/persistence')) as unknown as {
    DexieSeasonRunRepository?: new (db?: unknown, options?: unknown) => SeasonRunRepository;
  };
  if (!module.DexieSeasonRunRepository) {
    throw new Error('Season Run persistence is not wired yet');
  }
  return new module.DexieSeasonRunRepository(undefined, options);
}

let runnerPromise: Promise<SeasonBlockRunner> | null = null;

/** The main-thread block runner (lead-owned), or the injected e2e fake. */
export function getSeasonBlockRunner(): Promise<SeasonBlockRunner> {
  if (typeof window !== 'undefined' && window.__HOOP_RUSH_SEASON_BLOCK_RUNNER__) {
    return Promise.resolve(window.__HOOP_RUSH_SEASON_BLOCK_RUNNER__);
  }
  // e2e seam: the deterministic fake runner commits through the authoritative
  // engine seam folds, so the whole block loop is testable before the lead's
  // worker lands. Never active in production builds.
  if (typeof window !== 'undefined' && window.__HOOP_RUSH_E2E_FAKE_RUNNER__) {
    return import('./fake-season-block-runner').then((module) =>
      module.createFakeSeasonBlockRunner(),
    );
  }
  if (runnerPromise === null) {
    runnerPromise = (async () => {
      const module = (await import('$lib/season/season-block-runner')) as unknown as {
        createSeasonBlockRunner?: () => SeasonBlockRunner;
      };
      if (!module.createSeasonBlockRunner) {
        throw new Error('The season block runner is not wired yet');
      }
      return module.createSeasonBlockRunner();
    })();
    runnerPromise.catch(() => {
      runnerPromise = null;
    });
  }
  return runnerPromise;
}

export type { SeasonBlockStartInput };
