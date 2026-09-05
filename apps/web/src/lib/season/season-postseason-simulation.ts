import {
  SEASON_RUN_SCHEMA_VERSION,
  canonicalJson,
  seasonDigestHex,
  seasonPostseasonWorkerStartRequestSchema,
  type CommandId,
  type EraSimulationProfile,
  type FranchiseId,
  type Id,
  type SeasonAdvancePostseasonCommand,
  type SeasonAdvancePostseasonRejection,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonGameSummary,
  type SeasonPostseasonSummary,
  type SeasonRun,
  type SeasonRunStage,
  type PostseasonGameId,
  type Seed,
  type SeasonPostseasonScoreline,
  type SeasonPostseasonWorkerStartRequest,
} from '@hoop-rush/data-contracts';
import {
  handleSeasonRunCommand,
  SeasonPostseasonInvariantError,
  type SeasonPostseasonGameResolver,
} from '@hoop-rush/engine';
export interface SeasonPostseasonSimulationRequest {
  commandId: CommandId;
  runId: Id;
  expectedStateRevision: number;
  expectedStateDigest: string;
  targetGameId: PostseasonGameId;
  humanFranchiseId: FranchiseId | null;
  catalog: SeasonDraftCatalog;
  profile: EraSimulationProfile;
  run: SeasonRun;
  effects: SeasonEffectsState;
  regularSeasonSummaries: readonly SeasonGameSummary[];
  resolver?: SeasonPostseasonGameResolver;
}
export interface SeasonPostseasonSimulationAccepted {
  run: SeasonRun;
  summaries: SeasonPostseasonSummary[];
  advancedGameIds: PostseasonGameId[];
  stage: SeasonRunStage;
  nextDecision: 'rotation' | 'none';
  nextGameId: PostseasonGameId | null;
  aiNextGameId: PostseasonGameId | null;
}
export type SeasonPostseasonSimulationOutcome =
  | {
      kind: 'accepted';
      accepted: SeasonPostseasonSimulationAccepted;
    }
  | {
      kind: 'rejected';
      commandId: CommandId;
      rejection: SeasonAdvancePostseasonRejection;
    };
export { SeasonPostseasonInvariantError };
export type { SeasonPostseasonGameResolver };
export function simulateSeasonPostseasonCommand(
  request: SeasonPostseasonSimulationRequest,
): SeasonPostseasonSimulationOutcome {
  const command: SeasonAdvancePostseasonCommand = {
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    command: 'advance-postseason',
    commandId: request.commandId,
    runId: request.runId,
    expectedStateRevision: request.expectedStateRevision,
    expectedStateDigest: request.expectedStateDigest,
    targetGameId: request.targetGameId,
  };
  const output = handleSeasonRunCommand(command, {
    run: request.run,
    pending: null,
    humanFranchiseId: request.humanFranchiseId,
    catalog: request.catalog,
    profile: request.profile,
    effects: request.effects,
    regularSeasonSummaries: request.regularSeasonSummaries,
    ...(request.resolver !== undefined ? { postseasonGameResolver: request.resolver } : {}),
  });
  const envelope = output.result;
  if (envelope.command !== 'advance-postseason') {
    throw new Error(`postseason simulation dispatched an unexpected command: ${envelope.command}`);
  }
  if (envelope.result.status === 'rejected') {
    return { kind: 'rejected', commandId: request.commandId, rejection: envelope.result.rejection };
  }
  const accepted = envelope.result;
  return {
    kind: 'accepted',
    accepted: {
      run: output.run,
      summaries: output.postseasonSummaries ?? [],
      advancedGameIds: [...accepted.advancedGameIds],
      stage: accepted.stage,
      nextDecision: accepted.nextDecision,
      nextGameId: accepted.nextGameId,
      aiNextGameId: accepted.aiNextGameId,
    },
  };
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
export function postseasonPostCommandEffects(
  run: SeasonRun,
  prior: SeasonEffectsState,
): SeasonEffectsState {
  const withEffects = run as SeasonRun & {
    effects?: SeasonEffectsState;
  };
  return withEffects.effects ?? prior;
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
export function seasonPostseasonWireRequestOf(
  request: Omit<SeasonPostseasonSimulationRequest, 'catalog' | 'profile'> & {
    requestId: string;
    rootSeed: Seed;
    catalogUrl: string;
    catalogHash: string;
    profileUrl: string;
    profileHash: string;
  },
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
