import type {
  CapRushHistoryEntry,
  CapRushLeagueGame,
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
  listRunGames(runId: string): Promise<CapRushStoredGame[]>;
  listHistory(): Promise<CapRushHistoryEntry[]>;
  readReport(runId: string): Promise<CapRushReport | null>;
  listLeagueGames(runId: string): Promise<CapRushLeagueGame[]>;
}
export interface CapRushAssetPort {
  loadCatalog(): Promise<SeasonDraftCatalog>;
  loadBracket?(hash: string): Promise<OpponentBracket>;
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
