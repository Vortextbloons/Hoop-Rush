import {
  COLLECTION_GAME_WORKER_WIRE_VERSION,
  collectionGameWorkerMessageSchema,
  collectionGameWorkerRequestSchema,
  collectionGameWorkerVerifiedMessageSchema,
  loadCollectionCatalog,
  loadEraSimulationProfile,
  type CollectionCatalog,
  type CollectionGameWorkerCompleteMessage,
  type CollectionGameWorkerErrorCode,
  type CollectionGameWorkerErrorMessage,
  type CollectionGameWorkerSimulateRequest,
  type CollectionGameWorkerVerifyRequest,
  type CollectionGameWorkerVerifiedMessage,
  type EraSimulationProfile,
  type Seed,
} from '@hoop-rush/data-contracts';
import {
  applyCollectionGameCommand,
  checkCollectionGameResult,
  collectionGameEventDigest,
  collectionGameResultDigest,
  simulateCollectionGame,
} from '@hoop-rush/engine';

let currentRequestId: string | null = null;
let cancelled = false;

function isStale(requestId: string): boolean {
  return cancelled || currentRequestId !== requestId;
}

function postError(
  requestId: string,
  code: CollectionGameWorkerErrorCode,
  message: string,
  gameId: string | null,
  seed: Seed | null,
): void {
  const payload: CollectionGameWorkerErrorMessage = {
    wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
    type: 'collection-game-error',
    requestId,
    gameId,
    code,
    message: message.slice(0, 512),
    seed,
  };
  collectionGameWorkerMessageSchema.parse(payload);
  self.postMessage(payload);
}

const catalogCache = new Map<string, CollectionCatalog>();
const profileCache = new Map<string, EraSimulationProfile>();

async function loadCatalogCached(url: string, contentHash: string): Promise<CollectionCatalog> {
  const memo = catalogCache.get(contentHash);
  if (memo !== undefined) return memo;
  const catalog = await loadCollectionCatalog(url, contentHash);
  catalogCache.set(contentHash, catalog);
  return catalog;
}

async function loadProfileCached(url: string, contentHash: string): Promise<EraSimulationProfile> {
  const memo = profileCache.get(contentHash);
  if (memo !== undefined) return memo;
  const profile = await loadEraSimulationProfile(url, contentHash);
  profileCache.set(contentHash, profile);
  return profile;
}

async function handleSimulate(request: CollectionGameWorkerSimulateRequest): Promise<void> {
  const { requestId, prepared } = request;
  currentRequestId = requestId;
  cancelled = false;
  try {
    const [catalog, profile] = await Promise.all([
      loadCatalogCached(request.catalogUrl, request.catalogHash),
      loadProfileCached(request.profileUrl, request.profileHash),
    ]);
    if (isStale(requestId)) return;
    if (prepared.catalogHash !== request.catalogHash) {
      postError(
        requestId,
        'validation-failure',
        'prepared game catalog hash does not match the worker catalog',
        prepared.gameId,
        prepared.seed,
      );
      return;
    }
    if (prepared.profileHash !== request.profileHash) {
      postError(
        requestId,
        'validation-failure',
        'prepared game profile hash does not match the worker profile',
        prepared.gameId,
        prepared.seed,
      );
      return;
    }
    const simulated = simulateCollectionGame(prepared, catalog, profile);
    const { result, events } = simulated;
    if (isStale(requestId)) return;
    if (result.gameVersion !== prepared.gameVersion) {
      postError(
        requestId,
        'invariant-failure',
        'the simulated result version does not match the prepared game version',
        prepared.gameId,
        prepared.seed,
      );
      return;
    }
    const failures = checkCollectionGameResult(
      result,
      events,
      prepared,
      catalog,
      profile,
      simulated,
    );
    if (failures.length > 0) {
      postError(
        requestId,
        'invariant-failure',
        failures[0] ?? 'collection game audit failed',
        prepared.gameId,
        prepared.seed,
      );
      return;
    }
    const complete: CollectionGameWorkerCompleteMessage = {
      wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
      type: 'collection-game-complete',
      requestId,
      gameId: prepared.gameId,
      result,
      events,
      eventDigest: collectionGameEventDigest(events),
      resultDigest: collectionGameResultDigest(result),
    };
    collectionGameWorkerMessageSchema.parse(complete);
    self.postMessage(complete);
  } catch (error) {
    if (isStale(requestId)) return;
    postError(
      requestId,
      'internal',
      error instanceof Error ? error.message : 'unknown worker failure',
      prepared.gameId,
      prepared.seed,
    );
  }
}

async function handleVerify(request: CollectionGameWorkerVerifyRequest): Promise<void> {
  const { requestId } = request;
  currentRequestId = requestId;
  cancelled = false;
  try {
    const [catalog, profile] = await Promise.all([
      loadCatalogCached(request.catalogUrl, request.catalogHash),
      loadProfileCached(request.profileUrl, request.profileHash),
    ]);
    if (isStale(requestId)) return;
    const outcome = applyCollectionGameCommand(request.playState, request.command, {
      catalog,
      ownedCardIds: new Set(request.ownedCardIds),
      rootSeed: request.rootSeed,
      cpuWeights: request.cpuWeights,
      difficultyProfiles: request.difficultyProfiles,
      objectiveDefinitions: request.objectiveDefinitions,
      profile,
      profileHash: request.profileHash,
      catalogHash: request.catalogHash,
      rulesHash: request.rulesHash,
      balances: request.balances,
      priorCommands: request.priorCommands,
      progression: request.progression,
      progressionHash: request.progressionHash,
    });
    if (isStale(requestId)) return;
    const verified: CollectionGameWorkerVerifiedMessage = {
      wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
      type: 'collection-game-verified',
      requestId,
      outcome,
    };
    collectionGameWorkerVerifiedMessageSchema.parse(verified);
    self.postMessage(verified);
  } catch (error) {
    if (isStale(requestId)) return;
    postError(
      requestId,
      'internal',
      error instanceof Error ? error.message : 'unknown worker failure',
      null,
      null,
    );
  }
}

self.onmessage = (event: MessageEvent<unknown>): void => {
  const parsed = collectionGameWorkerRequestSchema.safeParse(event.data);
  if (!parsed.success) {
    return;
  }
  const request = parsed.data;
  if (request.type === 'collection-game-cancel') {
    if (request.requestId === currentRequestId) {
      cancelled = true;
      currentRequestId = null;
    }
    return;
  }
  if (request.type === 'collection-game-warm') {
    void Promise.all([
      loadCatalogCached(request.catalogUrl, request.catalogHash),
      loadProfileCached(request.profileUrl, request.profileHash),
    ]).then(() => {
      collectionGameWorkerMessageSchema.parse({
        wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
        type: 'collection-game-warm-ack',
        requestId: request.requestId,
      });
      self.postMessage({
        wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
        type: 'collection-game-warm-ack',
        requestId: request.requestId,
      });
    });
    return;
  }
  if (cancelled && request.requestId === currentRequestId) return;
  if (request.type === 'collection-game-verify') {
    void handleVerify(request);
    return;
  }
  void handleSimulate(request);
};
