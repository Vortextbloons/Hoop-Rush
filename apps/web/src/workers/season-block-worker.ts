import {
  blockIndexForRound,
  blockRoundRange,
  loadEraSimulationProfile,
  loadSeasonDraftCatalog,
  seasonWorkerMessageSchema,
  seasonWorkerRequestSchema,
  SEASON_HEALTH_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  type EraSimulationProfile,
  type SeasonBlockRunContext,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonGamePlayerInput,
  type SeasonGameSummary,
  type SeasonHealthState,
  type SeasonHomeCourtProfile,
  type SeasonInfluenceState,
  type SeasonInvalidRosterInterruption,
  type SeasonRetainedGameDetail,
  type SeasonSchedule,
  type SeasonWorkerCompleteMessage,
  type SeasonWorkerContinueRequest,
  type SeasonWorkerErrorMessage,
  type SeasonWorkerProgressMessage,
  type SeasonWorkerStartRequest,
  type SeasonWorkerWarmAckMessage,
} from '@hoop-rush/data-contracts';
import {
  assembleSeasonBlockCandidate,
  assembleSeasonPendingBlock,
  auditSeasonBlock,
  createInitialSeasonInfluenceState,
  createSeasonEffectsState,
  expandSeasonRunRosters,
  rosterPlayerIdsOf,
  seasonBlockGamesOf,
  seasonBlockRejection,
  SeasonBlockInvariantError,
  simulateSeasonBlockGame,
  type SeasonBlockSimulationInput,
} from '@hoop-rush/engine';
import { sleep } from '../lib/sleep';

const PROGRESS_MIN_INTERVAL_MS = 250;

let currentRequestId: string | null = null;
let cancelled = false;

let accumulatedRunId: string | null = null;
let accumulatedSummaries: SeasonGameSummary[] = [];
let accumulatedEffects: SeasonEffectsState | null = null;
let accumulatedHealth: SeasonHealthState | null = null;

interface WorkerRunContext {
  run: SeasonBlockRunContext;
  schedule: SeasonSchedule;
  homeCourt: SeasonHomeCourtProfile;
  humanFranchiseId: string | null;
}
const contextByRunId = new Map<string, WorkerRunContext>();

function synthesizeStart(request: SeasonWorkerContinueRequest): SeasonWorkerStartRequest | null {
  const context = contextByRunId.get(request.runId);
  if (context === undefined) return null;
  const { fromRound } = blockRoundRange(request.blockIndex);
  return {
    ...request,
    type: 'season-block-start',

    run: {
      ...context.run,
      rotations: request.rotations,
      cursor: {
        ...context.run.cursor,
        completedRounds: fromRound - 1,
      },
    },
    schedule: context.schedule,
    homeCourt: context.homeCourt,
    humanFranchiseId: context.humanFranchiseId,
  };
}

function post(
  message:
    | SeasonWorkerProgressMessage
    | SeasonWorkerCompleteMessage
    | SeasonWorkerErrorMessage
    | SeasonWorkerWarmAckMessage,
): void {
  self.postMessage(message);
}

function postError(
  requestId: string,
  code: 'invariant-failure' | 'cancelled' | 'internal',
  message: string,
  diagnostics: { seed?: string | null; gameId?: string | null; blockIndex?: number | null } = {},
): void {
  const payload: SeasonWorkerErrorMessage = {
    schemaVersion: 7,
    type: 'season-block-error',
    requestId,
    code,
    message: message.slice(0, 512),
    seed: diagnostics.seed ?? null,
    gameId: diagnostics.gameId ?? null,
    blockIndex: diagnostics.blockIndex ?? null,
  };
  seasonWorkerMessageSchema.parse(payload);
  self.postMessage(payload);
}

const catalogCache = new Map<string, SeasonDraftCatalog>();
async function loadCatalogCached(url: string, contentHash: string): Promise<SeasonDraftCatalog> {
  const memo = catalogCache.get(contentHash);
  if (memo !== undefined) return memo;
  const catalog = await loadSeasonDraftCatalog(url, contentHash);
  catalogCache.set(contentHash, catalog);
  return catalog;
}

const profileCache = new Map<string, EraSimulationProfile>();
async function loadProfileCached(url: string, contentHash: string): Promise<EraSimulationProfile> {
  const memo = profileCache.get(contentHash);
  if (memo !== undefined) return memo;
  const profile = await loadEraSimulationProfile(url, contentHash);
  profileCache.set(contentHash, profile);
  return profile;
}

function rosterFingerprint(run: SeasonBlockRunContext): string {
  return run.rosters
    .map(
      (roster) =>
        `${roster.franchiseId}:${roster.players.map((player) => player.playerVersionId).join(',')}`,
    )
    .join('|');
}

const expandedCache = new Map<string, Map<string, SeasonGamePlayerInput>>();
function expandRostersCached(
  run: SeasonBlockRunContext,
  catalog: SeasonDraftCatalog,
): Map<string, SeasonGamePlayerInput> {
  const key = rosterFingerprint(run);
  const memo = expandedCache.get(key);
  if (memo !== undefined) return memo;
  const expanded = expandSeasonRunRosters(run, catalog);
  expandedCache.set(key, expanded);
  return expanded;
}

async function yieldToEventLoop(): Promise<void> {
  await sleep(0);
}

function throwIfCancelled(): void {
  if (cancelled) {
    throw new SeasonWorkerCancelled();
  }
}

function initialHealth(): SeasonHealthState {
  return {
    schemaVersion: 1,
    healthVersion: SEASON_HEALTH_VERSION,
    injuries: [],
  };
}

function initialInfluence(run: SeasonBlockRunContext): SeasonInfluenceState {
  return createInitialSeasonInfluenceState(run.league.teams.map((team) => team.franchiseId));
}

function isInterruption(
  outcome: unknown,
): outcome is { interruption: SeasonInvalidRosterInterruption } {
  return (
    typeof outcome === 'object' &&
    outcome !== null &&
    (outcome as { interruption?: unknown }).interruption !== undefined
  );
}

async function runBlock(request: SeasonWorkerStartRequest): Promise<void> {
  const run: SeasonBlockRunContext = request.run;
  contextByRunId.set(request.runId, {
    run: request.run,
    schedule: request.schedule,
    homeCourt: request.homeCourt,
    humanFranchiseId: request.humanFranchiseId,
  });

  if (request.priorSummaries !== undefined) {
    accumulatedRunId = request.runId;
    accumulatedSummaries = request.priorSummaries;
  } else if (request.newSummaries !== undefined) {
    if (accumulatedRunId !== request.runId) {
      postError(
        request.requestId,
        'internal',
        'summary delta received for a run the worker has no state for',
      );
      return;
    }
    accumulatedSummaries = [...accumulatedSummaries, ...request.newSummaries];
  }

  if (request.priorEffects !== undefined && request.priorEffects !== null) {
    accumulatedEffects = request.priorEffects;
  } else if (accumulatedRunId === null) {
    postError(
      request.requestId,
      'internal',
      'effects state missing for a run the worker has no state for',
    );
    return;
  }

  if (request.priorHealth !== undefined && request.priorHealth !== null) {
    accumulatedHealth = request.priorHealth;
  } else if (accumulatedHealth === null) {
    accumulatedHealth = initialHealth();
  }

  let catalog;
  let profile;
  try {
    [catalog, profile] = await Promise.all([
      loadCatalogCached(request.catalogUrl, request.catalogHash),
      loadProfileCached(request.profileUrl, request.profileHash),
    ]);
  } catch (error) {
    postError(request.requestId, 'internal', errorMessage(error));
    return;
  }

  const expectedStateRevision = request.expectedStateRevision;
  const expectedStateDigest = request.expectedStateDigest;

  const expanded = expandRostersCached(run, catalog);
  const input: SeasonBlockSimulationInput = {
    command: {
      schemaVersion: SEASON_RUN_SCHEMA_VERSION,
      blockVersion: run.versions.blockVersion,
      command: 'submit-season-block',
      commandId: request.commandId,
      runId: run.runId,
      expectedRevision: request.expectedRevision,
      blockIndex: request.blockIndex,
      rotationDigest: request.rotationDigest,
      objectiveId: request.objectiveId ?? null,
      campaignOpportunityId: (request as unknown as { campaignOpportunityId?: string | null }).campaignOpportunityId ?? null,
      expectedStateRevision,
      expectedStateDigest,
    },
    run,
    expanded,
    schedule: request.schedule,
    catalog,
    profile,
    humanFranchiseId: request.humanFranchiseId,
    rosterPlayerIds: rosterPlayerIdsOf(run),
    priorSummaries: accumulatedSummaries,
    effects: accumulatedEffects ?? initialEffects(expanded),
    health: accumulatedHealth,
    influence: request.priorInfluence ?? initialInfluence(run),
    transactions: request.priorTransactions ?? [],
    objectiveId: request.objectiveId ?? null,
    campaignOpportunityId: (request as unknown as { campaignOpportunityId?: string | null }).campaignOpportunityId ?? null,
    objectives: (run as unknown as { objectives?: import('@hoop-rush/data-contracts').SeasonObjectiveState }).objectives,
    campaignState: (run as unknown as { campaign?: import('@hoop-rush/data-contracts').SeasonCampaignState }).campaign,
  };

  const rejection = seasonBlockRejection(input);
  if (rejection !== null) {
    postError(
      request.requestId,
      'internal',
      `block submission rejected by the engine: ${rejection.code}`,
    );
    return;
  }

  const games = seasonBlockGamesOf(request.schedule, request.blockIndex);

  let summaries: SeasonGameSummary[];
  let retainedDetails: SeasonRetainedGameDetail[];
  if (request.startGameId !== null) {
    summaries = accumulatedSummaries.filter(
      (summary) => blockIndexForRound(summary.round) === request.blockIndex,
    );
    retainedDetails = [];
  } else {
    summaries = [];
    retainedDetails = [];
  }
  const startIndex =
    request.startGameId === null
      ? 0
      : games.findIndex((game) => game.gameId === request.startGameId);
  if (startIndex < 0) {
    postError(
      request.requestId,
      'internal',
      `startGameId ${String(request.startGameId)} is not a game of block ${String(request.blockIndex)}`,
    );
    return;
  }
  const remainingGames = games.slice(startIndex);

  const { fromRound } = blockRoundRange(request.blockIndex);
  const precedingRound =
    startIndex > 0 ? (games[startIndex - 1]?.round ?? fromRound) : fromRound - 1;
  let previousRound = precedingRound;
  let effects = accumulatedEffects ?? initialEffects(expanded);
  let health = accumulatedHealth;
  let lastProgressAt = 0;
  let latestSummary: SeasonGameSummary | null = null;
  let interruption: SeasonInvalidRosterInterruption | null = null;

  const gameNumberById = new Map(
    input.schedule.games.map((game, index) => [game.gameId, index + 1]),
  );
  const rotationByFranchise = new Map(
    input.run.rotations.map((rotation) => [rotation.franchiseId, rotation]),
  );
  const rosterByFranchise = new Map(
    input.run.rosters.map((roster) => [roster.franchiseId, roster]),
  );

  for (const game of remainingGames) {
    if (cancelled) {
      throw new SeasonWorkerCancelled();
    }
    await yieldToEventLoop();
    throwIfCancelled();

    const outcome = simulateSeasonBlockGame(input, game, effects, health, {
      skipRecoveryTick: !(previousRound !== 0 && game.round > previousRound),
      gameNumberById,
      rotationByFranchise,
      rosterByFranchise,
    });
    if (isInterruption(outcome)) {
      interruption = outcome.interruption;
      break;
    }
    effects = outcome.effects;
    health = outcome.health;
    previousRound = game.round;
    summaries.push(outcome.summary);
    latestSummary = outcome.summary;
    if (outcome.retainedDetail !== null) retainedDetails.push(outcome.retainedDetail);

    const now = Date.now();
    const isLast = summaries.length === games.length;
    if (isLast || now - lastProgressAt >= PROGRESS_MIN_INTERVAL_MS) {
      lastProgressAt = now;
      post({
        schemaVersion: 7,
        type: 'season-block-progress',
        requestId: request.requestId,
        blockIndex: request.blockIndex,
        gamesCompleted: summaries.length,
        gamesTotal: games.length,
        latestGameId: latestSummary.gameId,

        latestResult: {
          gameId: latestSummary.gameId,
          homeFranchiseId: latestSummary.homeFranchiseId,
          homeScore: latestSummary.homeScore,
          awayScore: latestSummary.awayScore,
          awayFranchiseId: latestSummary.awayFranchiseId,
        },
      });
    }
  }

  if (interruption !== null) {
    const pending = assembleSeasonPendingBlock({
      run,
      commandId: request.commandId,
      blockIndex: request.blockIndex,
      expectedRevision: request.expectedRevision,
      expectedStateRevision,
      expectedStateDigest,
      objectiveId: request.objectiveId ?? null,
      campaignOpportunityId: (request as unknown as { campaignOpportunityId?: string | null }).campaignOpportunityId ?? null,
      nextGameId: interruption.nextGameId,
      summaries,
      retainedDetails,
      effects,
      health,
      rotationDigest: request.rotationDigest,
    });
    post({
      schemaVersion: 7,
      type: 'season-block-complete',
      requestId: request.requestId,
      result: { status: 'interrupted', pending },
    });
    return;
  }

  accumulatedEffects = effects;
  accumulatedHealth = health;
  const candidate = assembleSeasonBlockCandidate(
    input,
    summaries,
    retainedDetails,
    effects,
    health,
  );
  const auditFailures = auditSeasonBlock(candidate, input);
  if (auditFailures.length > 0) {
    throw new EngineInvariantFailure(auditFailures.join('; '));
  }

  accumulatedSummaries = [
    ...accumulatedSummaries.filter(
      (summary) => blockIndexForRound(summary.round) !== request.blockIndex,
    ),
    ...summaries,
  ];
  post({
    schemaVersion: 7,
    type: 'season-block-complete',
    requestId: request.requestId,
    result: { status: 'committed', checkpoint: candidate },
  });
}

function initialEffects(
  expanded: ReadonlyMap<string, import('@hoop-rush/data-contracts').SeasonGamePlayerInput>,
): SeasonEffectsState {
  const staminaInputs = [...expanded.values()].map((player) => {
    if (player.stamina === undefined) {
      throw new Error(`expanded player ${player.playerVersionId} has no stamina profile`);
    }
    return player.stamina;
  });
  return createSeasonEffectsState(staminaInputs);
}

class SeasonWorkerCancelled extends Error {
  constructor() {
    super('season block cancelled');
    this.name = 'SeasonWorkerCancelled';
  }
}

class EngineInvariantFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineInvariantFailure';
  }
}

self.onmessage = (event: MessageEvent<unknown>): void => {
  const parsed = seasonWorkerRequestSchema.safeParse(event.data);
  if (!parsed.success) {
    return;
  }
  const request = parsed.data;
  if (request.type === 'season-block-warm') {
    void (async () => {
      try {
        await Promise.all([
          loadCatalogCached(request.catalogUrl, request.catalogHash),
          loadProfileCached(request.profileUrl, request.profileHash),
        ]);
        post({
          schemaVersion: 7,
          type: 'season-block-warm-ack',
          requestId: request.requestId,
        });
      } catch (error) {
        postError(request.requestId, 'internal', `worker prewarm failed: ${errorMessage(error)}`);
      }
    })();
    return;
  }
  if (request.type === 'season-block-cancel') {
    if (request.requestId === currentRequestId) {
      cancelled = true;
    }
    return;
  }

  currentRequestId = request.requestId;
  cancelled = false;

  const startRequest =
    request.type === 'season-block-continue' ? synthesizeStart(request) : request;
  if (startRequest === null) {
    postError(
      request.requestId,
      'internal',
      'continuation for a run the worker has no context for',
    );
    return;
  }
  void runBlock(startRequest).catch((error: unknown) => {
    if (error instanceof SeasonWorkerCancelled) {
      postError(request.requestId, 'cancelled', 'block cancelled between games');
      return;
    }
    if (error instanceof SeasonBlockInvariantError) {
      postError(request.requestId, 'invariant-failure', error.message, {
        seed: error.diagnostics.seed ?? request.rootSeed,
        gameId: error.diagnostics.gameId ?? null,
        blockIndex: error.diagnostics.blockIndex ?? request.blockIndex,
      });
      return;
    }
    if (error instanceof EngineInvariantFailure) {
      postError(request.requestId, 'invariant-failure', error.message, {
        seed: request.rootSeed,
        blockIndex: request.blockIndex,
      });
      return;
    }
    postError(request.requestId, 'internal', errorMessage(error), {
      seed: request.rootSeed,
      blockIndex: request.blockIndex,
    });
  });
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
