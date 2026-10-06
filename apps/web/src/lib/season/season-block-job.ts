import {
  blockIndexForRound,
  blockRoundRange,
  loadEraSimulationProfile,
  loadSeasonDraftCatalog,
  SEASON_RUN_SCHEMA_VERSION,
  SEASON_WORKER_WIRE_SCHEMA_VERSION,
  seasonGameIdSchema,
  seedSchema,
  type EraSimulationProfile,
  type SeasonBlockRunContext,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonGameId,
  type SeasonGamePlayerInput,
  type SeasonGameSummary,
  type SeasonHealthState,
  type SeasonInfluenceState,
  type SeasonInvalidRosterInterruption,
  type SeasonRetainedGameDetail,
  type SeasonScoreline,
  type SeasonWorkerCompleteMessage,
  type SeasonWorkerErrorMessage,
  type SeasonWorkerProgressMessage,
  type SeasonWorkerStartRequest,
  type SeasonWorkerWarmAckMessage,
  type SeasonWorkerWarmRequest,
  type Seed,
} from '@hoop-rush/data-contracts';
import {
  assembleSeasonBlockCandidate,
  assembleSeasonPendingBlock,
  auditSeasonBlock,
  createInitialSeasonInfluenceState,
  expandSeasonRunRosters,
  rosterPlayerIdsOf,
  seasonBlockGamesOf,
  seasonBlockRejection,
  SeasonBlockInvariantError,
  simulateSeasonBlockGame,
  type SeasonBlockSimulationInput,
} from '@hoop-rush/engine';
const PROGRESS_MIN_INTERVAL_MS = 250;
const YIELD_GAME_BATCH = 4;
const YIELD_TIME_BUDGET_MS = 12;
export interface SeasonBlockJobIo {
  post(
    message:
      | SeasonWorkerProgressMessage
      | SeasonWorkerCompleteMessage
      | SeasonWorkerErrorMessage
      | SeasonWorkerWarmAckMessage,
  ): void;
  now(): number;
  perfNow(): number;
  isCancelled(): boolean;
  yield(): Promise<void>;
}
export interface SeasonBlockJobAssetOverrides {
  catalog?: SeasonDraftCatalog;
  profile?: EraSimulationProfile;
}
export class SeasonWorkerCancelled extends Error {
  constructor() {
    super('season block cancelled');
    this.name = 'SeasonWorkerCancelled';
  }
}
export class EngineInvariantFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineInvariantFailure';
  }
}
const catalogCache = new Map<string, SeasonDraftCatalog>();
function evictIfNeeded<K, V>(cache: Map<K, V>, limit = 4): void {
  while (cache.size > limit) {
    const first = cache.keys().next().value;
    if (first === undefined) break;
    cache.delete(first);
  }
}
async function loadCatalogCached(url: string, contentHash: string): Promise<SeasonDraftCatalog> {
  const memo = catalogCache.get(contentHash);
  if (memo !== undefined) return memo;
  const catalog = await loadSeasonDraftCatalog(url, contentHash);
  catalogCache.set(contentHash, catalog);
  evictIfNeeded(catalogCache);
  return catalog;
}
const profileCache = new Map<string, EraSimulationProfile>();
async function loadProfileCached(url: string, contentHash: string): Promise<EraSimulationProfile> {
  const memo = profileCache.get(contentHash);
  if (memo !== undefined) return memo;
  const profile = await loadEraSimulationProfile(url, contentHash);
  profileCache.set(contentHash, profile);
  evictIfNeeded(profileCache);
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
function sponsorSlotsFingerprint(run: SeasonBlockRunContext): string {
  const slots = run.sponsors?.players.slots;
  if (slots === undefined) return 'no-sponsors';
  const ids = Object.keys(slots).sort();
  if (ids.length === 0) return 'empty-slots';
  return ids
    .map((id) => {
      const entry = (slots as Record<string, unknown>)[id] as {
        shoe: {
          instanceId: string;
          entryId: string;
          boosts: readonly { key: string; points: number }[];
        } | null;
        apparel: {
          instanceId: string;
          entryId: string;
          boosts: readonly { key: string; points: number }[];
        } | null;
        fuel: {
          instanceId: string;
          entryId: string;
          boosts: readonly { key: string; points: number }[];
        } | null;
      };
      const part = (
        snapshot: {
          instanceId: string;
          entryId: string;
          boosts: readonly { key: string; points: number }[];
        } | null,
      ) =>
        snapshot === null
          ? 'null'
          : `${snapshot.instanceId}:${snapshot.entryId}:${snapshot.boosts.map((boost) => `${boost.key}+${String(boost.points)}`).join(',')}`;
      return `${id}|${part(entry.shoe)}|${part(entry.apparel)}|${part(entry.fuel)}`;
    })
    .join(';');
}
const expandedCache = new Map<string, Map<string, SeasonGamePlayerInput>>();
function expandRostersCached(
  run: SeasonBlockRunContext,
  catalog: SeasonDraftCatalog,
  catalogHash: string,
): Map<string, SeasonGamePlayerInput> {
  const key = `${catalogHash}|${rosterFingerprint(run)}|${sponsorSlotsFingerprint(run)}`;
  const memo = expandedCache.get(key);
  if (memo !== undefined) return memo;
  const expanded = expandSeasonRunRosters(run, catalog);
  expandedCache.set(key, expanded);
  evictIfNeeded(expandedCache);
  return expanded;
}
async function yieldToEventLoop(io: SeasonBlockJobIo): Promise<void> {
  await io.yield();
}
function throwIfCancelled(io: SeasonBlockJobIo): void {
  if (io.isCancelled()) {
    throw new SeasonWorkerCancelled();
  }
}
function initialInfluence(run: SeasonBlockRunContext): SeasonInfluenceState {
  return createInitialSeasonInfluenceState(run.league.teams.map((team) => team.franchiseId));
}
export function scorelineOfSummary(summary: SeasonGameSummary): SeasonScoreline {
  return {
    gameId: summary.gameId,
    homeFranchiseId: summary.homeFranchiseId,
    homeScore: summary.homeScore,
    awayScore: summary.awayScore,
    awayFranchiseId: summary.awayFranchiseId,
  };
}
export function isHumanSummary(
  summary: SeasonGameSummary,
  humanFranchiseId: string | null,
): boolean {
  return (
    humanFranchiseId !== null &&
    (summary.homeFranchiseId === humanFranchiseId || summary.awayFranchiseId === humanFranchiseId)
  );
}
export function blockLiveFactsOf(
  summaries: readonly SeasonGameSummary[],
  humanFranchiseId: string | null,
  orderByGameId: ReadonlyMap<string, number>,
): {
  humanResults: SeasonScoreline[];
  humanRecord: { wins: number; losses: number };
  leaguePulse: {
    closest: SeasonScoreline | null;
    blowout: SeasonScoreline | null;
    highestScoring: SeasonScoreline | null;
  };
} {
  const humanResults: SeasonScoreline[] = [];
  let wins = 0;
  let losses = 0;
  let closest: SeasonScoreline | null = null;
  let closestMargin = Number.POSITIVE_INFINITY;
  let closestOrder = Number.POSITIVE_INFINITY;
  let closestId = '';
  let blowout: SeasonScoreline | null = null;
  let blowoutMargin = -1;
  let blowoutOrder = Number.POSITIVE_INFINITY;
  let blowoutId = '';
  let highest: SeasonScoreline | null = null;
  let highestCombined = -1;
  let highestOrder = Number.POSITIVE_INFINITY;
  let highestId = '';
  for (const summary of summaries) {
    const line = scorelineOfSummary(summary);
    const margin = Math.abs(summary.homeScore - summary.awayScore);
    const combined = summary.homeScore + summary.awayScore;
    const order = orderByGameId.get(summary.gameId) ?? Number.MAX_SAFE_INTEGER;
    if (
      closest === null ||
      margin < closestMargin ||
      (margin === closestMargin &&
        (order < closestOrder || (order === closestOrder && summary.gameId < closestId)))
    ) {
      closest = line;
      closestMargin = margin;
      closestOrder = order;
      closestId = summary.gameId;
    }
    if (
      blowout === null ||
      margin > blowoutMargin ||
      (margin === blowoutMargin &&
        (order < blowoutOrder || (order === blowoutOrder && summary.gameId < blowoutId)))
    ) {
      blowout = line;
      blowoutMargin = margin;
      blowoutOrder = order;
      blowoutId = summary.gameId;
    }
    if (
      highest === null ||
      combined > highestCombined ||
      (combined === highestCombined &&
        (order < highestOrder || (order === highestOrder && summary.gameId < highestId)))
    ) {
      highest = line;
      highestCombined = combined;
      highestOrder = order;
      highestId = summary.gameId;
    }
    if (isHumanSummary(summary, humanFranchiseId)) {
      humanResults.push(line);
      const humanScore =
        summary.homeFranchiseId === humanFranchiseId ? summary.homeScore : summary.awayScore;
      const oppScore =
        summary.homeFranchiseId === humanFranchiseId ? summary.awayScore : summary.homeScore;
      if (humanScore > oppScore) wins += 1;
      else losses += 1;
    }
  }
  return {
    humanResults,
    humanRecord: { wins, losses },
    leaguePulse: { closest, blowout, highestScoring: highest },
  };
}
function isInterruption(outcome: unknown): outcome is {
  interruption: SeasonInvalidRosterInterruption;
} {
  return (
    typeof outcome === 'object' &&
    outcome !== null &&
    (
      outcome as {
        interruption?: unknown;
      }
    ).interruption !== undefined
  );
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function buildErrorMessage(
  requestId: string,
  code: 'invariant-failure' | 'cancelled' | 'internal',
  message: string,
  diagnostics: {
    seed?: Seed | null;
    gameId?: SeasonGameId | null;
    blockIndex?: number | null;
  } = {},
): SeasonWorkerErrorMessage {
  return {
    schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
    type: 'season-block-error',
    requestId,
    code,
    message: message.slice(0, 512),
    seed: diagnostics.seed ?? null,
    gameId: diagnostics.gameId ?? null,
    blockIndex: diagnostics.blockIndex ?? null,
  };
}
export function describeSeasonBlockJobError(
  error: unknown,
  request: SeasonWorkerStartRequest,
): SeasonWorkerErrorMessage {
  if (error instanceof SeasonWorkerCancelled) {
    return buildErrorMessage(request.requestId, 'cancelled', 'block cancelled between games');
  }
  if (error instanceof SeasonBlockInvariantError) {
    return buildErrorMessage(request.requestId, 'invariant-failure', error.message, {
      seed:
        error.diagnostics.seed !== undefined
          ? seedSchema.parse(error.diagnostics.seed)
          : request.rootSeed,
      gameId:
        error.diagnostics.gameId !== undefined
          ? seasonGameIdSchema.parse(error.diagnostics.gameId)
          : null,
      blockIndex: error.diagnostics.blockIndex ?? request.blockIndex,
    });
  }
  if (error instanceof EngineInvariantFailure) {
    return buildErrorMessage(request.requestId, 'invariant-failure', error.message, {
      seed: request.rootSeed,
      blockIndex: request.blockIndex,
    });
  }
  return buildErrorMessage(request.requestId, 'internal', errorMessage(error), {
    seed: request.rootSeed,
    blockIndex: request.blockIndex,
  });
}
export async function runSeasonBlockJob(
  request: SeasonWorkerStartRequest,
  io: SeasonBlockJobIo,
  overrides?: SeasonBlockJobAssetOverrides,
): Promise<void> {
  const run: SeasonBlockRunContext = request.run;
  const priorSummaries: SeasonGameSummary[] = request.priorSummaries;
  const blockEffects: SeasonEffectsState = request.priorEffects;
  const blockHealth: SeasonHealthState = request.priorHealth;
  let catalog: SeasonDraftCatalog;
  let profile: EraSimulationProfile;
  try {
    [catalog, profile] = await Promise.all([
      overrides?.catalog ?? loadCatalogCached(request.catalogUrl, request.catalogHash),
      overrides?.profile ?? loadProfileCached(request.profileUrl, request.profileHash),
    ]);
  } catch (error) {
    io.post(buildErrorMessage(request.requestId, 'internal', errorMessage(error)));
    return;
  }
  const expectedStateRevision = request.expectedStateRevision;
  const expectedStateDigest = request.expectedStateDigest;
  const expanded =
    overrides?.catalog !== undefined
      ? expandSeasonRunRosters(run, catalog)
      : expandRostersCached(run, catalog, request.catalogHash);
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
      challengeIds: request.challengeIds ?? undefined,
      campaignOpportunityId: request.campaignOpportunityId ?? null,
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
    priorSummaries,
    priorStandings: request.priorStandings,
    priorTeamAggregates: request.priorTeamAggregates,
    priorPlayerAggregates: request.priorPlayerAggregates,
    effects: blockEffects,
    health: blockHealth,
    influence: request.priorInfluence ?? initialInfluence(run),
    transactions: request.priorTransactions ?? [],
    objectiveId: request.objectiveId ?? null,
    challengeDeal: request.challengeDeal ?? null,
    campaignOpportunityId: request.campaignOpportunityId ?? null,
    objectives: (
      run as unknown as {
        objectives?: import('@hoop-rush/data-contracts').SeasonObjectiveState;
      }
    ).objectives,
    campaignState: (
      run as unknown as {
        campaign?: import('@hoop-rush/data-contracts').SeasonCampaignState;
      }
    ).campaign,
  };
  const rejection = seasonBlockRejection(input);
  if (rejection !== null) {
    io.post(
      buildErrorMessage(
        request.requestId,
        'internal',
        `block submission rejected by the engine: ${rejection.code}`,
      ),
    );
    return;
  }
  const games = seasonBlockGamesOf(request.schedule, request.blockIndex);
  let summaries: SeasonGameSummary[];
  let retainedDetails: SeasonRetainedGameDetail[];
  if (request.startGameId !== null) {
    summaries = priorSummaries.filter(
      (summary) => blockIndexForRound(summary.round) === request.blockIndex,
    );
    retainedDetails = [...(request.priorRetainedDetails ?? [])];
  } else {
    summaries = [];
    retainedDetails = [];
  }
  const startIndex =
    request.startGameId === null
      ? 0
      : games.findIndex((game) => game.gameId === request.startGameId);
  if (startIndex < 0) {
    io.post(
      buildErrorMessage(
        request.requestId,
        'internal',
        `startGameId ${String(request.startGameId)} is not a game of block ${String(request.blockIndex)}`,
      ),
    );
    return;
  }
  const remainingGames = games.slice(startIndex);
  const { fromRound } = blockRoundRange(request.blockIndex);
  const precedingRound =
    startIndex > 0 ? (games[startIndex - 1]?.round ?? fromRound) : fromRound - 1;
  let previousRound = precedingRound;
  let effects = blockEffects;
  let health = blockHealth;
  let lastProgressAt = 0;
  let latestSummary: SeasonGameSummary | null = null;
  let interruption: SeasonInvalidRosterInterruption | null = null;
  const orderByGameId = new Map(games.map((entry, index) => [entry.gameId, index]));
  const gameNumberById = new Map(
    input.schedule.games.map((game, index) => [game.gameId, index + 1]),
  );
  const rotationByFranchise = new Map(
    input.run.rotations.map((rotation) => [rotation.franchiseId, rotation]),
  );
  const rosterByFranchise = new Map(
    input.run.rosters.map((roster) => [roster.franchiseId, roster]),
  );
  let gamesSinceYield = 0;
  let yieldStartedAt = io.perfNow();
  for (const game of remainingGames) {
    if (io.isCancelled()) {
      throw new SeasonWorkerCancelled();
    }
    throwIfCancelled(io);
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
    gamesSinceYield += 1;
    const elapsed = io.perfNow() - yieldStartedAt;
    if (gamesSinceYield >= YIELD_GAME_BATCH || elapsed >= YIELD_TIME_BUDGET_MS) {
      await yieldToEventLoop(io);
      throwIfCancelled(io);
      gamesSinceYield = 0;
      yieldStartedAt = io.perfNow();
    }
    if (outcome.retainedDetail !== null) retainedDetails.push(outcome.retainedDetail);
    const now = io.now();
    const isLast = summaries.length === games.length;
    const latestIsHuman = isHumanSummary(latestSummary, request.humanFranchiseId);
    if (isLast || latestIsHuman || now - lastProgressAt >= PROGRESS_MIN_INTERVAL_MS) {
      lastProgressAt = now;
      const facts = blockLiveFactsOf(summaries, request.humanFranchiseId, orderByGameId);
      io.post({
        schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
        type: 'season-block-progress',
        requestId: request.requestId,
        blockIndex: request.blockIndex,
        gamesCompleted: summaries.length,
        gamesTotal: games.length,
        latestGameId: latestSummary.gameId,
        latestResult: scorelineOfSummary(latestSummary),
        isHumanGame: latestIsHuman,
        humanRecordInBlock: facts.humanRecord,
        humanResults: facts.humanResults,
        leaguePulse: facts.leaguePulse,
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
      challengeDeal: request.challengeDeal ?? null,
      challengeIds: request.challengeIds ?? null,
      campaignOpportunityId:
        (
          request as unknown as {
            campaignOpportunityId?: string | null;
          }
        ).campaignOpportunityId ?? null,
      nextGameId: interruption.nextGameId,
      summaries,
      retainedDetails,
      effects,
      health,
      rotationDigest: request.rotationDigest,
    });
    io.post({
      schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
      type: 'season-block-complete',
      requestId: request.requestId,
      result: { status: 'interrupted', pending },
    });
    return;
  }
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
  io.post({
    schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
    type: 'season-block-complete',
    requestId: request.requestId,
    result: { status: 'committed', checkpoint: candidate },
  });
}
export async function warmSeasonBlockJob(
  request: SeasonWorkerWarmRequest,
  overrides?: SeasonBlockJobAssetOverrides,
): Promise<void> {
  try {
    await Promise.all([
      overrides?.catalog ?? loadCatalogCached(request.catalogUrl, request.catalogHash),
      overrides?.profile ?? loadProfileCached(request.profileUrl, request.profileHash),
    ]);
  } catch (error) {
    throw new Error(`worker prewarm failed: ${errorMessage(error)}`);
  }
}
