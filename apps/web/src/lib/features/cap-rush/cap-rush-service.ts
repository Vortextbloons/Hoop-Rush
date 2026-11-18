import { CapRushSession, type CapRushService } from '@hoop-rush/application/cap-rush';
import type { CapRushDraftRepositoryPort } from '@hoop-rush/application/cap-rush';
import { idSchema } from '@hoop-rush/data-contracts';
import type {
  EraSimulationProfile,
  HoopRushManifest,
  OpponentBracket,
  SeasonDraftCatalog,
} from '@hoop-rush/data-contracts';
import { newSeasonId, seasonRootSeed } from '#lib/ids.js';
import { getPersistence } from '#lib/persistence.js';
import { capRushBracketWithRosterMetadata } from './cap-rush-opponent-metadata.js';
import {
  loadCapRushRosterMetadata,
  loadDraftCatalog,
  loadPlayoffProfiles,
} from '#lib/data-assets.js';
import { loadRunPreamble } from '#lib/run-preamble.js';
import {
  profileRepository,
  selectedProfile,
  withRepositoryHooks,
} from '#lib/features/profile/profile.js';

export interface CreateCapRushServiceOptions {
  repository?: CapRushDraftRepositoryPort;
  loadCatalog?: () => Promise<SeasonDraftCatalog>;
  loadPreamble?: () => Promise<{
    manifest: HoopRushManifest;
    profile: EraSimulationProfile;
    bracket: OpponentBracket;
  }>;
  newRunId?: () => string;
  newCommandId?: () => string;
}

export function createCapRushService(options: CreateCapRushServiceOptions = {}): CapRushService {
  const baseRepository = options.repository ?? getPersistence().capRushRepository;
  const repository = options.repository
    ? baseRepository
    : withRepositoryHooks<CapRushDraftRepositoryPort>(baseRepository, {
        applyOutcome: async (input) => {
          if (input.command.command === 'create-cap-rush-draft') {
            await selectedProfile();
            await profileRepository().bind(`cap-rush:${input.outcome.state.runId}`);
          }
          return baseRepository.applyOutcome(input);
        },
        loadActiveDraft: async () => {
          const run = await baseRepository.loadActiveDraft();
          if (run) {
            await selectedProfile();
            await profileRepository().bind(`cap-rush:${run.runId}`);
          }
          return run;
        },
      });
  return new CapRushSession({
    repository,
    assets: {
      loadCatalog: options.loadCatalog ?? loadDraftCatalog,
      loadPlayoffProfiles,
      loadPreamble:
        options.loadPreamble ??
        (async () => {
          const [preamble, metadata] = await Promise.all([
            loadRunPreamble((manifest) => manifest.capRushBracket),
            loadCapRushRosterMetadata(),
          ]);
          const entry = preamble.manifest.capRushBracket;
          if (entry === undefined) throw new Error('The Cap Rush opponent field is unavailable.');
          return {
            ...preamble,
            manifest: { ...preamble.manifest, bracket: entry },
            bracket: capRushBracketWithRosterMetadata(
              preamble.bracket,
              metadata,
              entry.contentHash,
            ),
          };
        }),
    },
    ids: {
      newRunId: options.newRunId ?? (() => idSchema.parse(newSeasonId('cap-rush-run'))),
      newCommandId: options.newCommandId ?? (() => newSeasonId('cap-rush-cmd')),
      rootSeed: () => seasonRootSeed(),
    },
  });
}

let activeService: CapRushService | null = null;

export function getCapRushService(): CapRushService {
  if (activeService === null) activeService = createCapRushService();
  return activeService;
}
