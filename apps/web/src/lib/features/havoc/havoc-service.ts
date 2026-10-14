import {
  HavocSession,
  type HavocRunnerPort,
  type HavocRunRepositoryPort,
  type HavocService,
} from '@hoop-rush/application/havoc';
import {
  idSchema,
  type EraSimulationProfile,
  type HoopRushManifest,
  type OpponentBracket,
  type SeasonDraftCatalog,
} from '@hoop-rush/data-contracts';
import { getManifest } from '#lib/data.js';
import { newRequestId, newSeasonId, seasonRootSeed } from '#lib/ids.js';
import { getPersistence } from '#lib/persistence.js';
import { loadRunPreamble } from '#lib/run-preamble.js';
import { loadDraftCatalog } from '#lib/data-assets.js';
import { HavocRunner } from './havoc-runner';

export interface CreateHavocServiceOptions {
  repository?: HavocRunRepositoryPort;
  runner?: HavocRunnerPort;
  loadCatalog?: () => Promise<SeasonDraftCatalog>;
  loadPreamble?: () => Promise<{ profile: EraSimulationProfile; bracket: OpponentBracket }>;
  loadManifest?: () => Promise<HoopRushManifest>;
  newRunId?: () => string;
  newCommandId?: () => string;
}

export function createHavocService(options: CreateHavocServiceOptions = {}): HavocService {
  return new HavocSession({
    repository: options.repository ?? getPersistence().havocRepository,
    runner: options.runner ?? new HavocRunner(),
    assets: {
      loadCatalog: options.loadCatalog ?? loadDraftCatalog,
      loadPreamble: options.loadPreamble ?? loadRunPreamble,
      loadManifest: options.loadManifest ?? getManifest,
    },
    ids: {
      newRunId: options.newRunId ?? (() => idSchema.parse(newSeasonId('havoc-run'))),
      newCommandId: options.newCommandId ?? (() => newSeasonId('havoc-cmd')),
      newRequestId: (prefix) => newRequestId(prefix),
      rootSeed: () => seasonRootSeed(),
    },
  });
}

let activeService: HavocService | null = null;

export function getHavocService(): HavocService {
  if (activeService === null) {
    activeService = createHavocService();
  }
  return activeService;
}
