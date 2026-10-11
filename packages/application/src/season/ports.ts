import type {
  EraSimulationProfile,
  SeasonDraftCatalog,
  SeasonFreeAgencyIndex,
  SeasonHomeCourtProfile,
  SeasonRosterTargets,
  SeasonSchedule,
} from '@hoop-rush/data-contracts';
import type { SeasonPostseasonRepository, SeasonRunRepository } from '@hoop-rush/persistence';
import type { SeasonArtifactUrls, SeasonBlockRunner } from './block-wire.ts';
import type { SeasonPostseasonRunner } from './postseason-wire.ts';

export type SeasonRunRepositoryPort = SeasonRunRepository & SeasonPostseasonRepository;

export type SeasonBlockRunnerPort = SeasonBlockRunner;

export type SeasonPostseasonRunnerPort = SeasonPostseasonRunner;

export type SeasonPostseasonRunnerFactory = () => Promise<SeasonPostseasonRunnerPort>;

export type SeasonRunAnnouncement =
  | {
      kind: 'commit';
      runId: string;
      revision: number;
      committedAt: number;
    }
  | {
      kind: 'clear';
      runId: string | null;
      committedAt: number;
    }
  | {
      kind: 'replace';
      runId: string;
      committedAt: number;
    };

export type SeasonRunMutation = SeasonRunAnnouncement & {
  sourceId: string;
};

export interface SeasonNotifierPort {
  announce(mutation: SeasonRunAnnouncement): void;
  onMutation(listener: (mutation: SeasonRunMutation) => void): () => void;
  close(): void;
}

export interface SeasonAssetPort {
  loadEraProfile(): Promise<EraSimulationProfile>;
  loadDraftCatalog(): Promise<SeasonDraftCatalog>;
  loadFreeAgencyIndex(): Promise<SeasonFreeAgencyIndex>;
  loadFreeAgencyTargets(): Promise<SeasonRosterTargets>;
  loadHomeCourtProfile(): Promise<SeasonHomeCourtProfile>;
  loadArtifactUrls(): Promise<SeasonArtifactUrls>;
  loadSchedule(): Promise<SeasonSchedule>;
}

export interface SeasonClockPort {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface SeasonIdPort {
  id(prefix: string): string;
}

export interface SeasonDraftCleanerPort {
  clearDraftSave(): Promise<void>;
}
