import type { SeasonPostseasonRepository, SeasonRunRepository } from '@hoop-rush/persistence';
import type { SeasonSchedule } from '@hoop-rush/data-contracts';
import type { SeasonBlockRunner, SeasonBlockStartInput } from '$lib/season/season-block-runner';
import type { SeasonPostseasonRunner } from '$lib/season/season-postseason-runner';

/**
 * Application singletons for the Season Run repositories and runners.
 *
 * Imports stay dynamic so the persistence and runner implementations load
 * lazily (the repository is only needed on the Season Run routes), but they
 * are typed directly against the exported module shapes — a renamed or
 * removed export fails at build time, not runtime. A window seam
 * (`__HOOP_RUSH_SEASON_BLOCK_RUNNER__`) lets e2e inject a deterministic fake
 * block runner through the frozen interface; the postseason runner has the
 * same seam (`__HOOP_RUSH_SEASON_POSTSEASON_RUNNER__`) plus the e2e direct-
 * engine fake (`__HOOP_RUSH_E2E_FAKE_POSTSEASON_RUNNER__`).
 */

declare global {
  interface Window {
    __HOOP_RUSH_SEASON_BLOCK_RUNNER__?: SeasonBlockRunner;
    __HOOP_RUSH_SEASON_POSTSEASON_RUNNER__?: SeasonPostseasonRunner;
    __HOOP_RUSH_E2E_FAKE_RUNNER__?: boolean;
    __HOOP_RUSH_E2E_FAKE_POSTSEASON_RUNNER__?: boolean;
  }
}

let repoPlainPromise: Promise<SeasonRunRepository & SeasonPostseasonRepository> | null = null;
let repoSchedulePromise: Promise<SeasonRunRepository & SeasonPostseasonRepository> | null = null;

export function resetSeasonRepositories(): void {
  repoPlainPromise = null;
  repoSchedulePromise = null;
}

/**
 * The concrete IndexedDB Season Run repository (lazy, once per schedule
 * supply). `loadActiveRun()` requires the schedule; index-only callers
 * (home resume) may omit it. The concrete class implements BOTH the Season
 * Run contract and the M2.6 postseason contract, so postseason repository
 * methods (advancement commits, command log, completed history, promotion)
 * are reachable through this accessor.
 */
export function getSeasonRunRepository(
  schedule?: SeasonSchedule,
): Promise<SeasonRunRepository & SeasonPostseasonRepository> {
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

async function createRepo(options: {
  schedule?: SeasonSchedule;
}): Promise<SeasonRunRepository & SeasonPostseasonRepository> {
  const module = await import('@hoop-rush/persistence');
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
      const module = await import('$lib/season/season-block-runner');
      return module.createSeasonBlockRunner();
    })();
    runnerPromise.catch(() => {
      runnerPromise = null;
    });
  }
  return runnerPromise;
}

let postseasonRunnerPromise: Promise<SeasonPostseasonRunner> | null = null;

/**
 * The main-thread postseason runner (M2.6), or the injected e2e fake. The
 * e2e fake is a REAL runner bound to the direct engine simulator, so the
 * per-game commits, chunking, re-reads, and promotion run exactly as in
 * production. Never active in production builds.
 */
export function getSeasonPostseasonRunner(): Promise<SeasonPostseasonRunner> {
  if (typeof window !== 'undefined' && window.__HOOP_RUSH_SEASON_POSTSEASON_RUNNER__) {
    return Promise.resolve(window.__HOOP_RUSH_SEASON_POSTSEASON_RUNNER__);
  }
  if (typeof window !== 'undefined' && window.__HOOP_RUSH_E2E_FAKE_POSTSEASON_RUNNER__) {
    return import('./fake-season-postseason-runner').then((module) =>
      module.createFakeSeasonPostseasonRunner(),
    );
  }
  if (postseasonRunnerPromise === null) {
    postseasonRunnerPromise = import('$lib/season/season-postseason-runner').then((module) =>
      module.getSeasonPostseasonRunner(),
    );
    postseasonRunnerPromise.catch(() => {
      postseasonRunnerPromise = null;
    });
  }
  return postseasonRunnerPromise;
}

export type { SeasonBlockStartInput };
