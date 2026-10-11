import {
  canonicalJson,
  seasonDigestHex,
  seasonPostseasonWorkerStartRequestSchema,
  type CommandId,
  type FranchiseId,
  type Id,
  type PostseasonGameId,
  type SeasonAdvancePostseasonRejection,
  type SeasonEffectsState,
  type SeasonGameSummary,
  type SeasonPostseasonScoreline,
  type SeasonPostseasonSummary,
  type SeasonPostseasonWorkerErrorCode,
  type SeasonPostseasonWorkerProgressMessage,
  type SeasonPostseasonWorkerStartRequest,
  type SeasonPostseasonWorkerAcceptedResult,
  type SeasonRun,
  type Seed,
} from '@hoop-rush/data-contracts';

export type SeasonPostseasonMode = 'advance' | 'spectate' | 'fast-forward';

export interface SeasonPostseasonRunInput {
  runId: Id;
  commandId: CommandId;
  targetGameId?: PostseasonGameId;
  humanFranchiseId: FranchiseId | null;
}

export type SeasonPostseasonJobOutcome =
  | { kind: 'accepted'; result: SeasonPostseasonWorkerAcceptedResult }
  | { kind: 'rejected'; commandId: CommandId; rejection: SeasonAdvancePostseasonRejection }
  | {
      kind: 'error';
      code: SeasonPostseasonWorkerErrorCode;
      message: string;
      seed: Seed | null;
      gameId: PostseasonGameId | null;
    };

export interface SeasonPostseasonJob {
  simulate(
    request: SeasonPostseasonWorkerStartRequest,
    onProgress?: (progress: SeasonPostseasonWorkerProgressMessage) => void,
  ): Promise<SeasonPostseasonJobOutcome>;
  cancel(requestId: string): void;
  prewarm(): void;
  terminate(): void;
}

export interface SeasonPostseasonWireRequestInput {
  requestId: string;
  runId: Id;
  rootSeed: Seed;
  commandId: CommandId;
  expectedStateRevision: number;
  expectedStateDigest: string;
  humanFranchiseId: FranchiseId | null;
  targetGameId: PostseasonGameId;
  catalogUrl: string;
  catalogHash: string;
  profileUrl: string;
  profileHash: string;
  run: SeasonRun;
  effects: SeasonEffectsState;
  regularSeasonSummaries: readonly SeasonGameSummary[];
}

export function seasonPostseasonWireRequestOf(
  request: SeasonPostseasonWireRequestInput,
): SeasonPostseasonWorkerStartRequest {
  return seasonPostseasonWorkerStartRequestSchema.parse({
    schemaVersion: 1,
    type: 'season-postseason-start',
    requestId: request.requestId,
    runId: request.runId,
    rootSeed: request.rootSeed,
    commandId: request.commandId,
    expectedStateRevision: request.expectedStateRevision,
    expectedStateDigest: request.expectedStateDigest,
    humanFranchiseId: request.humanFranchiseId,
    targetGameId: request.targetGameId,
    catalogUrl: request.catalogUrl,
    catalogHash: request.catalogHash,
    profileUrl: request.profileUrl,
    profileHash: request.profileHash,
    run: request.run,
    effects: request.effects,
    regularSeasonSummaries: [...request.regularSeasonSummaries],
  });
}

export function seasonPostseasonScorelineOf(
  summary: SeasonPostseasonSummary,
): SeasonPostseasonScoreline {
  return {
    gameId: summary.gameId,
    homeFranchiseId: summary.homeFranchiseId,
    homeScore: summary.homeScore,
    awayScore: summary.awayScore,
    awayFranchiseId: summary.awayFranchiseId,
  };
}

export function seasonPostseasonCommitResultDigest(
  commandId: string,
  relatedGameIds: readonly string[],
  summaries: readonly SeasonPostseasonSummary[],
): string {
  return seasonDigestHex(
    canonicalJson({
      commandId,
      gameIds: [...relatedGameIds].sort(),
      summaryDigests: summaries.map((summary) => summary.resultDigest).sort(),
    }),
  );
}

export function seasonPostseasonTransactionIdsOf(run: SeasonRun, commandId: string): string[] {
  return run.transactions
    .filter((entry) => entry.commandId === commandId)
    .map((entry) => entry.transactionId);
}
