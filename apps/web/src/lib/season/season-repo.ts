import type { SeasonPostseasonRepository, SeasonRunRepository } from '@hoop-rush/persistence';
import type { SeasonSchedule } from '@hoop-rush/data-contracts';
import { getPersistence } from '#lib/persistence.js';
import type { SeasonBlockRunner, SeasonBlockStartInput } from '#lib/season/season-block-runner.js';
import type { SeasonPostseasonJob } from '#lib/season/season-postseason-runner.js';
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
function createRepo(options: {
  schedule?: SeasonSchedule;
}): Promise<SeasonRunRepository & SeasonPostseasonRepository> {
  return Promise.resolve(getPersistence().seasonRunRepository(options));
}
let runnerPromise: Promise<SeasonBlockRunner> | null = null;
export function getSeasonBlockRunner(): Promise<SeasonBlockRunner> {
  if (runnerPromise === null) {
    runnerPromise = (async () => {
      const module = await import('#lib/season/season-block-runner.js');
      return module.createSeasonBlockRunner();
    })();
    runnerPromise.catch(() => {
      runnerPromise = null;
    });
  }
  return runnerPromise;
}
let postseasonJobPromise: Promise<SeasonPostseasonJob> | null = null;
export function getSeasonPostseasonJob(): Promise<SeasonPostseasonJob> {
  if (postseasonJobPromise === null) {
    postseasonJobPromise = import('#lib/season/season-postseason-runner.js').then((module) =>
      module.getSeasonPostseasonJob(),
    );
    postseasonJobPromise.catch(() => {
      postseasonJobPromise = null;
    });
  }
  return postseasonJobPromise;
}
export type { SeasonBlockStartInput };
