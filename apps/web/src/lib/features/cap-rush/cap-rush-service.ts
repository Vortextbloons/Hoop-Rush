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
import { loadDraftCatalog } from '#lib/data-assets.js';
import { loadRunPreamble } from '#lib/run-preamble.js';

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
  return new CapRushSession({
    repository: options.repository ?? getPersistence().capRushRepository,
    assets: {
      loadCatalog: options.loadCatalog ?? loadDraftCatalog,
      loadPreamble: options.loadPreamble ?? loadRunPreamble,
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
