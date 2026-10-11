import type { SeasonSessionOptions } from '@hoop-rush/application/season';
import type { SeasonSchedule } from '@hoop-rush/data-contracts';
import { DexieSeasonDraftRepository } from '@hoop-rush/persistence';
import { newSeasonId } from '$lib/ids';
import { sleep } from '$lib/sleep';
import {
  loadSeasonDraftCatalog,
  loadSeasonEraProfile,
  loadSeasonFreeAgencyIndex,
  loadSeasonFreeAgencyTargets,
  loadSeasonHomeCourtProfile,
  loadSeasonSchedule,
  seasonArtifactUrls,
} from './season-assets';
import { createSeasonRunChannel } from './season-cross-tab';
import {
  getSeasonBlockRunner,
  getSeasonPostseasonJob,
  getSeasonRunRepository,
} from './season-repo';

export async function createSeasonSessionPorts(options: {
  schedule?: SeasonSchedule;
}): Promise<SeasonSessionOptions> {
  const [repository, blockRunner] = await Promise.all([
    options.schedule === undefined
      ? getSeasonRunRepository()
      : getSeasonRunRepository(options.schedule),
    getSeasonBlockRunner(),
  ]);
  const channel = createSeasonRunChannel();
  return {
    repository,
    blockRunner,
    postseasonJobFactory: () => getSeasonPostseasonJob(),
    assets: {
      loadEraProfile: () => loadSeasonEraProfile(),
      loadDraftCatalog: () => loadSeasonDraftCatalog(),
      loadFreeAgencyIndex: () => loadSeasonFreeAgencyIndex(),
      loadFreeAgencyTargets: () => loadSeasonFreeAgencyTargets(),
      loadHomeCourtProfile: () => loadSeasonHomeCourtProfile(),
      loadArtifactUrls: () => seasonArtifactUrls(),
      loadSchedule: async () => options.schedule ?? loadSeasonSchedule(),
    },
    notifier: {
      announce: (mutation) => {
        channel.announce(mutation);
      },
      onMutation: (listener) => channel.subscribe(listener),
      close: () => {
        channel.close();
      },
    },
    clock: {
      now: () => Date.now(),
      sleep: (ms) => sleep(ms),
    },
    ids: {
      id: (prefix) => newSeasonId(prefix),
    },
    draftCleaner: {
      clearDraftSave: () => new DexieSeasonDraftRepository().clearSeasonDraft(),
    },
  };
}
