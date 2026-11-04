import type {
  HavocCommandResult,
  HavocComparison,
  HavocDraftCard,
  HavocDraftState,
  HavocGameResult,
  HavocGameSummary,
  HavocGameTape,
  HavocMutationEntry,
  HavocReport,
  HavocVariant,
  Position,
} from '@hoop-rush/data-contracts';

export interface HavocHistoryView {
  runId: string;
  createdAtIso: string;
  updatedAtIso: string;
  havocWins: number;
  havocLosses: number;
  perfectSeason: boolean;
  comparisonStatus: 'not-started' | 'running' | 'complete' | 'unsupported';
  completionState: 'season' | 'comparison' | 'complete' | 'abandoned';
}

export interface HavocLineupSlotView {
  slot: Position;
  playerId?: string;
  franchiseId?: string | null;
  seasonKey?: string | null;
  displayName: string;
  nickname: string;
  playerVersionId: string | null;
  tier: 1 | 2 | 3;
  overall: number;
  mutations: readonly HavocMutationEntry[];
}

/** Projects draft picks from either Havoc draft shape onto the lineup card view. */
export function havocLineupSlotsFromPicks(
  picks: readonly { readonly slot: Position; readonly card: HavocDraftCard }[],
): HavocLineupSlotView[] {
  return picks.map((pick) => ({
    slot: pick.slot,
    displayName: pick.card.source.displayName,
    nickname: pick.card.nickname,
    playerVersionId: pick.card.source.playerVersionId,
    playerId: pick.card.source.playerId,
    franchiseId: pick.card.source.franchiseId,
    seasonKey: pick.card.source.seasonKey,
    tier: pick.card.tier,
    overall: pick.card.source.originalOverall,
    mutations: pick.card.mutations,
  }));
}

export interface HavocRunView {
  runId: string;
  revision: number;
  phase: 'draft' | 'run';
  havocCursor: number;
  normalCursor: number;
  havocWins: number;
  havocLosses: number;
  normalWins: number;
  normalLosses: number;
  perfectSeason: boolean;
  comparisonStatus: 'not-started' | 'running' | 'complete' | 'unsupported';
  completionState: 'draft' | 'season' | 'comparison' | 'complete' | 'abandoned';
  lineup: readonly HavocLineupSlotView[];
  nextGameNumber: number | null;
  nextOpponentDisplayName: string | null;
  nextHumanHome: boolean | null;
}

export interface HavocActiveSnapshot {
  run: HavocRunView | null;
  draft: HavocDraftState | null;
}

export interface HavocSimulationProgress {
  variant: HavocVariant;
  gamesCompleted: number;
  gamesTotal: number;
  latestGameNumber: number | null;
}

export type HavocServiceEvent =
  | { type: 'progress'; progress: HavocSimulationProgress }
  | { type: 'game-accepted'; summary: HavocGameSummary }
  | { type: 'comparison-updated'; comparison: HavocComparison }
  | { type: 'error'; code: HavocServiceErrorCode; message: string };

export interface HavocBatchResult {
  accepted: number;
  cancelled: boolean;
  nextCursor: number;
}

export interface HavocWatchSession {
  gameNumber: number;
  variant: HavocVariant;
  seed: string;
  tape: HavocGameTape;
  summary: HavocGameSummary;
  result: HavocGameResult;
}

export type HavocServiceErrorCode =
  | 'no-active-run'
  | 'invalid-phase'
  | 'storage'
  | 'simulation'
  | 'cancelled'
  | 'unsupported-version'
  | 'internal';

export class HavocServiceError extends Error {
  readonly code: HavocServiceErrorCode;

  constructor(code: HavocServiceErrorCode, message: string) {
    super(message);
    this.name = 'HavocServiceError';
    this.code = code;
  }
}

export interface HavocService {
  subscribe(listener: (event: HavocServiceEvent) => void): () => void;
  getSnapshot(): HavocActiveSnapshot;
  loadActive(): Promise<HavocActiveSnapshot>;
  listHistory(): Promise<HavocHistoryView[]>;
  readCompletedRun(runId: string): Promise<{
    run: HavocRunView;
    report: HavocReport | null;
    comparison: HavocComparison | null;
  } | null>;
  createDraft(): Promise<HavocCommandResult>;
  rerollOffer(): Promise<HavocCommandResult>;
  pickCard(cardId: string): Promise<HavocCommandResult>;
  lockLineup(): Promise<HavocCommandResult>;
  simulateRange(input: {
    variant: HavocVariant;
    count: number | 'remaining';
  }): Promise<HavocBatchResult>;
  cancelSimulation(): Promise<void>;
  watchGame(input: { gameNumber: number; variant: HavocVariant }): Promise<HavocWatchSession>;
  acceptGame(input: { gameNumber: number; variant: HavocVariant }): Promise<HavocCommandResult>;
  listGames(variant: HavocVariant): Promise<HavocGameSummary[]>;
  readGame(input: { gameNumber: number; variant: HavocVariant }): Promise<HavocGameResult | null>;
  startNormalSeason(): Promise<HavocBatchResult>;
  finalizeComparison(): Promise<HavocComparison>;
  readComparison(): Promise<HavocComparison | null>;
  readReport(): Promise<HavocReport | null>;
  abandon(): Promise<HavocCommandResult>;
  discardStaleActiveRun(): Promise<void>;
  dispose(): void;
}
