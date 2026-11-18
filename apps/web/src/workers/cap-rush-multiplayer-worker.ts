import {
  CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
  capRushMultiplayerWorkerMessageSchema,
  capRushMultiplayerWorkerRequestSchema,
  type CapRushMultiplayerState,
  type CapRushMultiplayerWorkerRequest,
  type CapRushPlayoffGameSummary,
} from '@hoop-rush/data-contracts';
import {
  replayCapRushMultiplayerLog,
  capRushMultiplayerSimulateGame,
  capRushMultiplayerStateDigest,
  applyCapRushMultiplayerCommand,
  adaptCapRushCatalog,
  buildCapRushCatalogIndex,
  createEngineContext,
  simulateCapRushMultiplayerPlayoffGame,
  simulateCapRushMultiplayerSlot,
  type CapRushCatalogIndex,
  type CapRushMultiplayerEnvironment,
} from '@hoop-rush/engine';
import {
  applyCapRushMultiplayerStatePatchUnchecked,
  createCapRushMultiplayerStatePatch,
} from '#lib/features/cap-rush-multiplayer/cap-rush-multiplayer-patch.js';

const context = createEngineContext();

let catalogCache: { readonly key: string; readonly index: CapRushCatalogIndex } | null = null;
let hydratedEnvironment: CapRushMultiplayerEnvironment | null = null;
let cachedState: {
  state: CapRushMultiplayerState;
  digest: string;
} | null = null;

/**
 * The packaged catalog is static and content-addressed, so the adapted index only changes when the
 * catalog version or hash changes. Building it costs several hundred milliseconds for ~8k
 * candidates; every projection request would otherwise pay that cost again.
 */
function catalogIndexOf(
  environment: Omit<CapRushMultiplayerEnvironment, 'index'>,
): CapRushCatalogIndex {
  const key = `${environment.catalogSource.catalogVersion}:${environment.catalogSource.catalogHash}`;
  if (catalogCache?.key === key) return catalogCache.index;
  const index = buildCapRushCatalogIndex(
    adaptCapRushCatalog(environment.seasonCatalog, environment.catalogSource),
  );
  catalogCache = { key, index };
  return index;
}

function post(message: unknown): void {
  self.postMessage(capRushMultiplayerWorkerMessageSchema.parse(message));
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown cap rush multiplayer worker failure';
}

type ProjectionRequest = Extract<
  CapRushMultiplayerWorkerRequest,
  { kind: 'cap-rush-multiplayer-project' }
>;

/**
 * Resolves the projection base from the warm cache by digest. A cold or restarted worker accepts
 * the full state instead, validates any supplied digest, and caches the input for the next call.
 */
function projectionBase(request: ProjectionRequest): {
  readonly state: CapRushMultiplayerState;
  readonly digest: string;
} {
  if (request.baseDigest !== undefined && cachedState?.digest === request.baseDigest) {
    if (request.state !== undefined && request.state !== cachedState.state) {
      const suppliedDigest = capRushMultiplayerStateDigest(request.state);
      if (suppliedDigest !== request.baseDigest)
        throw new Error('cap rush multiplayer projection base digest does not match its state');
    }
    return cachedState;
  }
  if (request.state !== undefined) {
    const digest = capRushMultiplayerStateDigest(request.state);
    if (request.baseDigest !== undefined && request.baseDigest !== digest)
      throw new Error('cap rush multiplayer projection base digest does not match its state');
    cachedState = { state: request.state, digest };
    return cachedState;
  }
  if (request.baseDigest !== undefined)
    throw new Error('cap rush multiplayer worker has no cached base state');
  throw new Error('cap rush multiplayer worker has no base state');
}

function snapshotMessage(
  request: ProjectionRequest,
  state: CapRushMultiplayerState,
  stateDigest: string,
  baseDigest?: string,
): unknown {
  return {
    schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
    kind: 'cap-rush-multiplayer-projection',
    requestId: request.requestId,
    state,
    ...(baseDigest === undefined ? {} : { baseDigest }),
    stateDigest,
  };
}

self.onmessage = (event: MessageEvent<unknown>) => {
  const parsed = capRushMultiplayerWorkerRequestSchema.safeParse(event.data);
  if (!parsed.success) return;
  const request = parsed.data;
  if (request.kind === 'cap-rush-multiplayer-cancel') return;
  try {
    if (request.kind === 'cap-rush-multiplayer-hydrate') {
      hydratedEnvironment = {
        ...request.environment,
        index: catalogIndexOf(request.environment),
      };
      cachedState = null;
      post({
        schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
        kind: 'cap-rush-multiplayer-hydrated',
        requestId: request.requestId,
      });
      return;
    }
    if (request.kind === 'cap-rush-multiplayer-project') {
      let environment: CapRushMultiplayerEnvironment;
      if (request.environment === undefined) {
        if (hydratedEnvironment === null)
          throw new Error('cap rush multiplayer worker is not hydrated');
        environment = hydratedEnvironment;
      } else {
        environment = { ...request.environment, index: catalogIndexOf(request.environment) };
        hydratedEnvironment = environment;
      }
      if (request.verifyLog) {
        if (request.state === undefined) throw new Error('verification needs the root state');
        if (request.state.rootSeed === null) throw new Error('the room has no root seed');
        const replayed = replayCapRushMultiplayerLog({
          rootSeed: request.state.rootSeed,
          commands: request.commands,
          environment,
          variant: request.variant,
        });
        cachedState = {
          state: replayed.state,
          digest: capRushMultiplayerStateDigest(replayed.state),
        };
        // Replay is the divergence check, so it always returns the authoritative full snapshot.
        post(snapshotMessage(request, replayed.state, cachedState.digest));
        return;
      }
      const base = projectionBase(request);
      let state = base.state;
      for (const command of request.commands) {
        const outcome = applyCapRushMultiplayerCommand(
          state,
          command,
          environment,
          request.variant,
        );
        if (!outcome.ok) {
          post({
            schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
            kind: 'cap-rush-multiplayer-rejection',
            requestId: request.requestId,
            code: outcome.code,
            message: outcome.message,
          });
          return;
        }
        state = outcome.state;
      }
      const digest = capRushMultiplayerStateDigest(state);
      cachedState = { state, digest };
      if (request.response === 'snapshot') {
        post(snapshotMessage(request, state, digest, base.digest));
        return;
      }
      let patch;
      try {
        patch = createCapRushMultiplayerStatePatch(base.state, state);
        const reconstructed = applyCapRushMultiplayerStatePatchUnchecked(base.state, patch);
        if (capRushMultiplayerStateDigest(reconstructed) !== digest)
          throw new Error('cap rush multiplayer projection patch digest diverged');
      } catch {
        // A patch that cannot reproduce the result is never sent; fall back to the snapshot.
        post(snapshotMessage(request, state, digest, base.digest));
        return;
      }
      post({
        schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
        kind: 'cap-rush-multiplayer-projection',
        requestId: request.requestId,
        patch,
        baseDigest: base.digest,
        stateDigest: digest,
      });
      return;
    }
    if (request.kind === 'cap-rush-multiplayer-slot') {
      const games = [];
      const tapes = [];
      const through = request.throughSlot ?? request.slot;
      if (through < request.slot || through - request.slot > 4)
        throw new Error('invalid simulation range');
      for (let slot = request.slot; slot <= through; slot += 1) {
        const simulated = simulateCapRushMultiplayerSlot({
          locked: request.locked,
          slot,
          context,
          tapeGameIds: request.tapeGameIds,
          partition: request.partition,
        });
        games.push(...simulated.games);
        tapes.push(...[...simulated.tapes].map(([gameId, tape]) => ({ gameId, tape })));
      }
      post({
        schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
        kind: 'cap-rush-multiplayer-slot',
        requestId: request.requestId,
        slot: request.slot,
        games,
        tapes,
      });
      return;
    }
    if (request.kind === 'cap-rush-multiplayer-playoff-games') {
      const tapeIds = new Set(request.tapeGameIds);
      const games: CapRushPlayoffGameSummary[] = [];
      const tapes: { gameId: string; tape: unknown }[] = [];
      for (const plan of request.plans) {
        const simulated = simulateCapRushMultiplayerPlayoffGame({
          locked: request.locked,
          plan,
          context,
        });
        games.push(simulated.game);
        if (tapeIds.has(simulated.game.gameId)) {
          tapes.push({ gameId: simulated.game.gameId, tape: simulated.tape });
        }
      }
      post({
        schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
        kind: 'cap-rush-multiplayer-playoff-games',
        requestId: request.requestId,
        games,
        tapes,
      });
      return;
    }
    {
      if (request.entry !== undefined) {
        const simulated = capRushMultiplayerSimulateGame({
          locked: request.locked,
          entry: request.entry,
          context,
        });
        post({
          schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
          kind: 'cap-rush-multiplayer-tape',
          requestId: request.requestId,
          gameId: simulated.game.gameId,
          input: simulated.input,
          result: simulated.result,
          tape: simulated.tape,
        });
        return;
      }
      if (request.plan !== undefined) {
        const simulated = simulateCapRushMultiplayerPlayoffGame({
          locked: request.locked,
          plan: request.plan,
          context,
        });
        post({
          schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
          kind: 'cap-rush-multiplayer-tape',
          requestId: request.requestId,
          gameId: simulated.game.gameId,
          input: simulated.input,
          result: simulated.result,
          tape: simulated.tape,
        });
        return;
      }
    }
  } catch (error) {
    post({
      schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
      kind: 'cap-rush-multiplayer-error',
      requestId: request.requestId,
      code: 'internal',
      message: failureMessage(error).slice(0, 400),
    });
  }
};
