import type {
  EraSimulationProfile,
  HavocWorkerCompleteMessage,
  HavocWorkerErrorMessage,
  HavocWorkerGameMessage,
  HavocWorkerProgressMessage,
  HavocWorkerSimulateRequest,
  HavocWorkerTapeMessage,
  HavocWorkerTapeRequest,
  HoopRushManifest,
  OpponentBracket,
  SeasonDraftCatalog,
  Seed,
} from '@hoop-rush/data-contracts';
import type { HavocRepository } from '@hoop-rush/persistence';

export type HavocRunRepositoryPort = HavocRepository;

export interface HavocBatchHandlers {
  onGame?: (message: HavocWorkerGameMessage) => void | Promise<void>;
  onProgress?: (message: HavocWorkerProgressMessage) => void;
  onError?: (message: HavocWorkerErrorMessage) => void;
}

export interface HavocAssetPort {
  loadCatalog(): Promise<SeasonDraftCatalog>;
  loadPreamble(): Promise<{ profile: EraSimulationProfile; bracket: OpponentBracket }>;
  loadManifest(): Promise<HoopRushManifest>;
}

export interface HavocIdPort {
  newRunId(): string;
  newCommandId(): string;
  newRequestId(prefix: string): string;
  rootSeed(): Seed;
}

export interface HavocRunnerPort {
  startBatch(
    request: HavocWorkerSimulateRequest,
    handlers: HavocBatchHandlers,
  ): Promise<HavocWorkerCompleteMessage>;
  runTape(request: HavocWorkerTapeRequest): Promise<HavocWorkerTapeMessage>;
  cancel(): void;
  dispose(): void;
}
