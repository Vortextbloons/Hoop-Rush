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
import { getManifest } from '$lib/data';
import { newRequestId, newSeasonId, seasonRootSeed } from '$lib/ids';
import { getPersistence } from '$lib/persistence';
import { loadRunPreamble } from '$lib/run-preamble';
import { loadSeasonDraftCatalog } from '$lib/season/season-assets';
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
      loadCatalog: options.loadCatalog ?? loadSeasonDraftCatalog,
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

export function setHavocService(service: HavocService | null): void {
  activeService = service;
}

export function getHavocService(): HavocService {
  if (activeService === null) {
    activeService = createHavocService();
  }
  return activeService;
}
