import type {
  EraSimulationProfile,
  HoopRushManifest,
  OpponentBracket,
  SeasonDraftCatalog,
  Seed,
} from '@hoop-rush/data-contracts';
import type { CapRushRepository } from '@hoop-rush/persistence';

export type CapRushDraftRepositoryPort = Pick<
  CapRushRepository,
  | 'loadActiveDraft'
  | 'loadCommandResult'
  | 'applyOutcome'
  | 'listRunGames'
  | 'listPlayoffGames'
  | 'listLeagueGames'
  | 'listHistory'
  | 'readReport'
  | 'updatePlayback'
  | 'clearActiveDraft'
>;
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
