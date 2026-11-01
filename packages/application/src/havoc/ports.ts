import type {
  EraSimulationProfile,
  HavocCommandResult,
  HavocComparison,
  HavocComparisonStatus,
  HavocCompletionState,
  HavocGameResult,
  HavocReport,
  HavocRunState,
  HavocVariant,
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
import type { HavocApplyOutcomeInput } from '@hoop-rush/data-contracts';

export type { HavocApplyOutcomeInput, HavocCommandOutcome } from '@hoop-rush/data-contracts';

/** Completion states a Havoc run can carry once it appears in history. */
export type HavocHistoryCompletionState = Exclude<HavocCompletionState, 'draft'>;

/** One accepted Havoc command plus the state it produced. */

/** Everything a single Havoc save commit may write. */

/**
 * The save surface Havoc solo needs.
 *
 * Declared structurally so the application owns its use-case contract and does
 * not import `@hoop-rush/persistence`. `DexieHavocRepository` satisfies it
 * without modification.
 */
export interface HavocRunRepositoryPort {
  loadActiveRun(): Promise<HavocRunState | null>;
  clearActiveRun(): Promise<void>;
  loadCommandResult(commandId: string): Promise<HavocCommandResult | null>;
  applyOutcome(input: HavocApplyOutcomeInput): Promise<HavocCommandResult>;
  listRunGames(runId: string, variant: HavocVariant): Promise<HavocGameResult[]>;
  readRunGame(
    runId: string,
    variant: HavocVariant,
    gameNumber: number,
  ): Promise<{ result: HavocGameResult; resultDigest: string } | null>;
  readComparison(runId: string): Promise<HavocComparison | null>;
  readReport(runId: string): Promise<HavocReport | null>;
  listHistory(): Promise<HavocHistoryEntry[]>;
  readCompletedRun(
    runId: string,
  ): Promise<{ state: HavocRunState; report: HavocReport | null } | null>;
}

/** A completed Havoc run as listed in history. */
export interface HavocHistoryEntry {
  runId: string;
  createdAtIso: string;
  updatedAtIso: string;
  havocWins: number;
  havocLosses: number;
  perfectSeason: boolean;
  comparisonStatus: HavocComparisonStatus;
  completionState: HavocHistoryCompletionState;
}

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
