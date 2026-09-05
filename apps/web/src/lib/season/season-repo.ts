import type { SeasonPostseasonRepository, SeasonRunRepository } from '@hoop-rush/persistence';
import type { SeasonSchedule } from '@hoop-rush/data-contracts';
import type { SeasonBlockRunner, SeasonBlockStartInput } from '$lib/season/season-block-runner';
import type { SeasonPostseasonRunner } from '$lib/season/season-postseason-runner';
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
export function getSeasonBlockRunner(): Promise<SeasonBlockRunner> {
  if (typeof window !== 'undefined' && window.__HOOP_RUSH_SEASON_BLOCK_RUNNER__) {
    return Promise.resolve(window.__HOOP_RUSH_SEASON_BLOCK_RUNNER__);
  }
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
