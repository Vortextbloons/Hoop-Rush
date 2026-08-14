import {
  SEASON_RUN_SCHEMA_VERSION,
  canonicalJson,
  seasonDigestHex,
  seasonPostseasonWorkerStartRequestSchema,
  type EraSimulationProfile,
  type SeasonAdvancePostseasonCommand,
  type SeasonAdvancePostseasonRejection,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonGameSummary,
  type SeasonPostseasonSummary,
  type SeasonRun,
  type SeasonRunStage,
  type SeasonScoreline,
  type SeasonPostseasonWorkerStartRequest,
} from '@hoop-rush/data-contracts';
import {
  handleSeasonRunCommand,
  SeasonPostseasonInvariantError,
  type SeasonPostseasonGameResolver,
} from '@hoop-rush/engine';

/**
 * The shared engine-advance core of the postseason orchestration (M2.6).
 * One pure function folds a validated simulation request into ONE
 * `advance-postseason` engine command and returns the accepted commit facts
 * (run, summaries, advanced game ids, next-decision facts) or the typed
 * engine rejection. The basketball rules live ONLY in the engine's
 * `handleSeasonRunCommand`; this module never re-implements simulation.
 *
 * Used by:
 * - the postseason worker (`season-postseason-worker.ts`) — the wire
 *   boundary over this core (progress + error mapping),
 * - the direct simulator seam (`fake-season-postseason-runner.ts`) — the
 *   deterministic e2e/test path that runs the SAME core without a worker,
 * - the runner's commit-side facts (result digest, transaction ids).
 *
 * Invariants (frozen for this wave): one request == one engine command ==
 * one atomic commit on the main thread. The worker never touches IndexedDB;
 * the commit-side digest helpers are pure functions of the accepted facts so
 * the worker, the direct simulator, and the CLI produce identical result
 * digests for identical accepted outputs.
 */

/** The per-request simulation facts (subset of the wire request). */
export interface SeasonPostseasonSimulationRequest {
  commandId: string;
  runId: string;
  expectedStateRevision: number;
  expectedStateDigest: string;
  targetGameId: string;
  humanFranchiseId: string | null;
  catalog: SeasonDraftCatalog;
  profile: EraSimulationProfile;
  run: SeasonRun;
  effects: SeasonEffectsState;
  /**
   * The recorded regular-season compact summaries: the engine derives the
   * season awards from them when an advance reaches the playoffs or
   * completes (the state digest and command log cover the awards).
   */
  regularSeasonSummaries: readonly SeasonGameSummary[];
  /**
   * Test/CLI seam: the per-game simulation resolver. The production worker
   * path never carries one (functions do not cross the worker wire) and the
   * engine defaults to the real Season game controller; the direct
   * simulator threads it so deterministic fixtures force winners.
   */
  resolver?: SeasonPostseasonGameResolver;
}

/** The accepted advance facts the commit side persists (one atomic commit). */
export interface SeasonPostseasonSimulationAccepted {
  run: SeasonRun;
  /** The advance's compact summaries, in play order. */
  summaries: SeasonPostseasonSummary[];
  /** Games advanced by the command, in play order. */
  advancedGameIds: string[];
  stage: SeasonRunStage;
  nextDecision: 'rotation' | 'none';
  nextGameId: string | null;
  aiNextGameId: string | null;
}

export type SeasonPostseasonSimulationOutcome =
  | { kind: 'accepted'; accepted: SeasonPostseasonSimulationAccepted }
  | { kind: 'rejected'; commandId: string; rejection: SeasonAdvancePostseasonRejection };

export { SeasonPostseasonInvariantError };
export type { SeasonPostseasonGameResolver };

/**
 * Folds one simulation request into the typed `advance-postseason` command
 * and runs it through the authoritative engine handler. Accepted outputs
 * carry the post-advance run (committed verbatim), the chunk summaries, and
 * the next-decision facts; rejected outputs carry the typed rejection.
 * Engine invariant failures throw (the caller decides the wire code).
 */
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

/** The compact scoreline of a postseason summary (progress payloads). */
export function seasonPostseasonScorelineOf(summary: SeasonPostseasonSummary): SeasonScoreline {
  return {
    gameId: summary.gameId,
    homeFranchiseId: summary.homeFranchiseId,
    homeScore: summary.homeScore,
    awayScore: summary.awayScore,
    awayFranchiseId: summary.awayFranchiseId,
  };
}

/**
 * The post-advance effects state when the engine attached it to the command
 * output run (an extra property beside the schema); falls back to the prior
 * state for zero-transition advances. Mirrors the hub's private helper so
 * the runner and the hub agree on one convention.
 */
export function postseasonPostCommandEffects(
  run: SeasonRun,
  prior: SeasonEffectsState,
): SeasonEffectsState {
  const withEffects = run as SeasonRun & { effects?: SeasonEffectsState };
  return withEffects.effects ?? prior;
}

/**
 * The canonical result digest of one accepted advancement (frozen shape:
 * the persistence cross-track test's `commit` helper digest — commandId +
 * sorted game ids + sorted summary digests). A pure function of the accepted
 * facts, so worker, direct simulator, and CLI agree.
 */
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

/** Transaction ids a command produced (submit-with-rehab records one). */
export function seasonPostseasonTransactionIdsOf(run: SeasonRun, commandId: string): string[] {
  return run.transactions
    .filter((entry) => entry.commandId === commandId)
    .map((entry) => entry.transactionId);
}

/**
 * Builds the schema-validated wire start request the worker boundary
 * parses. The run and effects ride the wire as the authoritative snapshot
 * slices; the worker re-validates them with `seasonRunSchema` at its side.
 * The packaged catalog/profile ride as URLs only (the worker fetches and
 * hash-verifies them itself).
 */
export function seasonPostseasonWireRequestOf(
  request: Omit<SeasonPostseasonSimulationRequest, 'catalog' | 'profile'> & {
    requestId: string;
    rootSeed: string;
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
