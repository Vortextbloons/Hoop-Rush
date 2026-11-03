import type {
  CapRushCommandResult,
  CapRushDraftState,
  CapRushHistoryEntry,
  CapRushLeagueGame,
  CapRushReport,
  CapRushStoredGame,
  CapRushStoredPlayoffGame,
  EraSimulationProfile,
  HoopRushManifest,
  OpponentBracket,
  SeasonDraftCatalog,
  Seed,
} from '@hoop-rush/data-contracts';
import type { CapRushApplyOutcomeInput } from '@hoop-rush/data-contracts';

export type { CapRushApplyOutcomeInput } from '@hoop-rush/data-contracts';

/** What a save commit returns to the Cap Rush session when it applies an outcome. */

export interface CapRushCompletedRun {
  readonly entry: CapRushHistoryEntry;
  readonly report: CapRushReport | null;
}

/**
 * The save surface Cap Rush solo needs.
 *
 * Declared structurally so the application owns its use-case contract and does
 * not import `@hoop-rush/persistence`. `DexieCapRushRepository` satisfies it
 * without modification.
 */
export interface CapRushDraftRepositoryPort {
  loadActiveDraft(): Promise<CapRushDraftState | null>;
  loadCommandResult(commandId: string): Promise<CapRushCommandResult | null>;
  applyOutcome(input: CapRushApplyOutcomeInput): Promise<CapRushCommandResult>;
  listRunGames(runId: string): Promise<CapRushStoredGame[]>;
  listPlayoffGames(runId: string): Promise<CapRushStoredPlayoffGame[]>;
  listLeagueGames(runId: string): Promise<CapRushLeagueGame[]>;
  listHistory(): Promise<CapRushHistoryEntry[]>;
  readReport(runId: string): Promise<CapRushReport | null>;
  updatePlayback(
    runId: string,
    game: number | string,
    cursor: number,
    resolved: boolean,
  ): Promise<void>;
  clearActiveDraft(): Promise<void>;
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
