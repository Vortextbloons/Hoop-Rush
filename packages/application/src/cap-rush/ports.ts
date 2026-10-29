import type {
  CapRushHistoryEntry,
  CapRushReport,
  CapRushStoredGame,
  EraSimulationProfile,
  HoopRushManifest,
  OpponentBracket,
  SeasonDraftCatalog,
  Seed,
} from '@hoop-rush/data-contracts';
import type { CapRushRepository } from '@hoop-rush/persistence';

export interface CapRushDraftRepositoryPort extends CapRushRepository {
  saveGame(runId: string, game: CapRushStoredGame): Promise<void>;
  listRunGames(runId: string): Promise<readonly CapRushStoredGame[]>;
  listHistory(): Promise<readonly CapRushHistoryEntry[]>;
  readReport(runId: string): Promise<CapRushReport | null>;
  saveReport(report: CapRushReport): Promise<void>;
}

export interface CapRushAssetPort {
  loadCatalog(): Promise<SeasonDraftCatalog>;
  loadPreamble(): Promise<{
    manifest: HoopRushManifest;
    profile: EraSimulationProfile;
    bracket: OpponentBracket;
  }>;
}

export interface CapRushIdPort {
  newRunId(): string;
  newCommandId(): string;
  rootSeed(): Seed;
}
