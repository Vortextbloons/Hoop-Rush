import {
  SEASON_RUN_SCHEMA_VERSION,
  canonicalJson,
  seasonAlmanacDigest,
  seasonCommandLogDigest,
  seasonDigestHex,
  seasonPostseasonWorkerCancelRequestSchema,
  seasonPostseasonWorkerMessageSchema,
  seasonPostseasonWorkerWarmRequestSchema,
  seasonTradeGradeLogDigest,
  type SeasonAdvancePostseasonRejection,
  type SeasonAlmanac,
  type SeasonRun,
  type SeasonRunCommand,
  type SeasonRunStage,
  type SeasonScoreline,
  type SeasonSchedule,
  type SeasonPostseasonWorkerCompleteMessage,
  type SeasonPostseasonWorkerErrorMessage,
  type SeasonPostseasonWorkerProgressMessage,
  type SeasonPostseasonWorkerStartRequest,
} from '@hoop-rush/data-contracts';
import {
  POSTSEASON_ALMANAC_DIGEST_PLACEHOLDER,
  deriveSeasonTradeGrades,
  seasonPostseasonHumanEliminated,
  seasonPostseasonNextGame,
  seasonPostseasonUpcomingGames,
} from '@hoop-rush/engine';
import {
  SeasonRunCommandDuplicateError,
  SeasonRunCommandRunMismatchError,
  SeasonRunCommandStaleStateError,
  type SeasonPostseasonRepository,
  type SeasonRunRepository,
  type SeasonRunSnapshot,
} from '@hoop-rush/persistence';
import type { CommitPostseasonAdvancementInput } from '@hoop-rush/persistence';
import type { SeasonArtifactUrls } from './season-assets';
import { newSeasonId } from './season-ids';
import {
  postseasonPostCommandEffects,
  seasonPostseasonCommitResultDigest,
  seasonPostseasonScorelineOf as scorelineOf,
  seasonPostseasonTransactionIdsOf,
  seasonPostseasonWireRequestOf,
} from './season-postseason-simulation';
export type SeasonPostseasonMode = 'advance' | 'spectate' | 'fast-forward';
export type SeasonPostseasonEvent =
  | {
      type: 'started';
      requestId: string;
      mode: SeasonPostseasonMode;
      targetGameId: string | null;
      gamesTotal: number;
    }
  | {
      type: 'progress';
      requestId: string;
      gamesCompleted: number;
      gamesTotal: number;
      latestGameId: string | null;
      latestResult: SeasonScoreline | null;
    }
  | {
      type: 'committed';
      requestId: string;
      runId: string;
      gameIds: string[];
      snapshot: SeasonRunSnapshot;
    }
  | {
      type: 'complete';
      requestId: string;
      runId: string;
      snapshot: SeasonRunSnapshot | null;
      stage: SeasonRunStage;
      nextDecision: 'rotation' | 'none';
      nextGameId: string | null;
      aiNextGameId: string | null;
      promoted: boolean;
    }
  | {
      type: 'rejected';
      requestId: string;
      command: SeasonRunCommand['command'];
      rejection: SeasonAdvancePostseasonRejection;
      message: string;
    }
  | {
      type: 'cancelled';
      requestId: string;
    }
  | {
      type: 'error';
      requestId: string;
      code: 'invariant-failure' | 'cancelled' | 'internal';
      message: string;
      seed: string | null;
      gameId: string | null;
    };
export interface SeasonPostseasonRunInput {
  runId: string;
  commandId: string;
  targetGameId?: string;
  humanFranchiseId: string | null;
}
export type SeasonPostseasonSimulatorFn = (
  request: SeasonPostseasonWorkerStartRequest,
  onProgress: (progress: SeasonPostseasonWorkerProgressMessage) => void,
) => Promise<SeasonPostseasonWorkerCompleteMessage | SeasonPostseasonWorkerErrorMessage>;
export interface SeasonPostseasonRunner {
  advancePostseason(input: SeasonPostseasonRunInput): string;
  spectatePostseasonGame(
    input: SeasonPostseasonRunInput & {
      targetGameId: string;
    },
  ): string;
  fastForwardPostseason(input: SeasonPostseasonRunInput): string;
  cancel(requestId: string): void;
  terminate(): void;
  prewarm(): void;
  subscribe(listener: (event: SeasonPostseasonEvent) => void): () => void;
}
export interface SeasonPostseasonRunnerDeps {
  repository?: SeasonRunRepository & SeasonPostseasonRepository;
  schedule?: SeasonSchedule;
  workerUrl?: string;
  artifacts?: () => Promise<SeasonArtifactUrls>;
  simulate?: SeasonPostseasonSimulatorFn;
}
export const SEASON_POSTSEASON_CHUNK_MAX_GAMES = 8;
export function createSeasonPostseasonRunner(
  deps: SeasonPostseasonRunnerDeps = {},
): SeasonPostseasonRunner {
  const listeners = new Set<(event: SeasonPostseasonEvent) => void>();
  let worker: Worker | null = null;
  let currentRequestId: string | null = null;
  const requestActive = () => currentRequestId !== null;
  let currentWireRequestId: string | null = null;
  let cancelled = false;
  let warmRequestId: string | null = null;
  let warmed = false;
  const pending = new Map<
    string,
    (message: SeasonPostseasonWorkerCompleteMessage | SeasonPostseasonWorkerErrorMessage) => void
  >();
  const repositoryPromise = deps.repository !== undefined ? Promise.resolve(deps.repository) : null;
  const schedulePromise = deps.schedule !== undefined ? Promise.resolve(deps.schedule) : null;
  function resolveSchedule(): Promise<SeasonSchedule> {
    if (schedulePromise !== null) return schedulePromise;
    return import('./season-assets').then((module) => module.loadSeasonSchedule());
  }
  async function resolveRepository(): Promise<SeasonRunRepository & SeasonPostseasonRepository> {
    if (repositoryPromise !== null) return repositoryPromise;
    const schedule = await resolveSchedule();
    const module = await import('@hoop-rush/persistence');
    return new module.DexieSeasonRunRepository(undefined, { schedule });
  }
  function emit(event: SeasonPostseasonEvent): void {
    for (const listener of [...listeners]) listener(event);
  }
  function createWorker(): Worker {
    if (worker !== null) return worker;
    worker =
      deps.workerUrl !== undefined
        ? new Worker(deps.workerUrl, { type: 'module' })
        : new Worker(new URL('../../workers/season-postseason-worker.ts', import.meta.url), {
            type: 'module',
          });
    worker.addEventListener('error', (event) => {
      const failure: SeasonPostseasonWorkerErrorMessage = {
        schemaVersion: 1,
        type: 'season-postseason-error',
        requestId: currentWireRequestId ?? '',
        code: 'internal',
        message: event.message.slice(0, 512),
        seed: null,
        gameId: null,
      };
      for (const resolve of [...pending.values()]) resolve(failure);
      pending.clear();
    });
    worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      const parsed = seasonPostseasonWorkerMessageSchema.safeParse(event.data);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.type === 'season-postseason-warm-ack') {
        if (message.requestId === warmRequestId) warmRequestId = null;
        return;
      }
      if (message.type === 'season-postseason-progress') {
        if (currentRequestId === null) return;
        emit({
          type: 'progress',
          requestId: currentRequestId,
          gamesCompleted: message.gamesCompleted,
          gamesTotal: message.gamesTotal,
          latestGameId: message.latestGameId,
          latestResult: message.latestResult,
        });
        return;
      }
      if (message.type === 'season-postseason-complete') {
        const resolve = pending.get(message.requestId);
        if (resolve === undefined) return;
        pending.delete(message.requestId);
        resolve(message);
        return;
      }
      const resolve = pending.get(message.requestId);
      if (resolve === undefined) return;
      pending.delete(message.requestId);
      resolve(message);
    });
    return worker;
  }
  function simulate(
    request: SeasonPostseasonWorkerStartRequest,
  ): Promise<SeasonPostseasonWorkerCompleteMessage | SeasonPostseasonWorkerErrorMessage> {
    if (deps.simulate !== undefined) {
      return deps.simulate(request, (progress) => {
        if (currentRequestId === null) return;
        emit({
          type: 'progress',
          requestId: currentRequestId,
          gamesCompleted: progress.gamesCompleted,
          gamesTotal: progress.gamesTotal,
          latestGameId: progress.latestGameId,
          latestResult: progress.latestResult,
        });
      });
    }
    const target = createWorker();
    return new Promise((resolve) => {
      pending.set(request.requestId, resolve);
      target.postMessage(request);
    });
  }
  async function orchestrate(
    requestId: string,
    input: SeasonPostseasonRunInput,
    mode: SeasonPostseasonMode,
  ): Promise<void> {
    let commitCount = 0;
    try {
      const [repository, artifacts] = await Promise.all([
        resolveRepository(),
        deps.artifacts !== undefined
          ? deps.artifacts()
          : import('./season-assets').then((module) => module.seasonArtifactUrls()),
      ]);
      if (requestAborted(requestId)) return;
      emit({
        type: 'started',
        requestId,
        mode,
        targetGameId: input.targetGameId ?? null,
        gamesTotal: 0,
      });
      let firstCommandId: string | null = input.commandId;
      let terminalTarget: string | null = input.targetGameId ?? null;
      let estimatedGamesTotal = 0;
      for (;;) {
        if (requestAborted(requestId)) return;
        const snapshot = await repository.loadActiveRun();
        if (snapshot === null) {
          fail(requestId, 'internal', 'no active season run to advance', null);
          return;
        }
        if (snapshot.run.runId !== input.runId) {
          fail(
            requestId,
            'internal',
            'the active run does not match the submitted run',
            snapshot.run.rootSeed,
          );
          return;
        }
        const run = snapshot.run;
        estimatedGamesTotal = seasonPostseasonUpcomingGames(run.postseason).length;
        if (mode === 'fast-forward') {
          const humanFranchiseId = input.humanFranchiseId;
          if (
            humanFranchiseId !== null &&
            !seasonPostseasonHumanEliminated(run.postseason, humanFranchiseId)
          ) {
            fail(
              requestId,
              'internal',
              `the human franchise ${humanFranchiseId} still has postseason decisions; fast-forward requires elimination`,
              run.rootSeed,
            );
            return;
          }
        }
        const decision = seasonPostseasonNextGame(run.postseason);
        if (decision.kind === 'integrity-failure') {
          fail(requestId, 'invariant-failure', decision.reason, run.rootSeed);
          return;
        }
        if (decision.kind === 'complete') {
          if (run.stage === 'completed') {
            await promoteAndComplete(requestId, repository, run, snapshot);
          } else {
            fail(
              requestId,
              'invariant-failure',
              'the postseason ended without a champion',
              run.rootSeed,
            );
          }
          return;
        }
        const nextGameId = decision.gameId;
        let targetGameId: string;
        if (mode === 'spectate') {
          targetGameId = terminalTarget ?? nextGameId;
        } else if (mode === 'fast-forward') {
          const upcoming = seasonPostseasonUpcomingGames(run.postseason);
          if (terminalTarget !== null) {
            const position = upcoming.indexOf(terminalTarget);
            if (position < 0) {
              fail(
                requestId,
                'internal',
                `the fast-forward target ${terminalTarget} is not an upcoming postseason game`,
                run.rootSeed,
              );
              return;
            }
            if (position >= SEASON_POSTSEASON_CHUNK_MAX_GAMES) {
              fail(
                requestId,
                'internal',
                `the fast-forward target is beyond the ${String(SEASON_POSTSEASON_CHUNK_MAX_GAMES)}-game chunk bound`,
                run.rootSeed,
              );
              return;
            }
            targetGameId = terminalTarget;
            terminalTarget = null;
          } else {
            const count = Math.min(SEASON_POSTSEASON_CHUNK_MAX_GAMES, upcoming.length);
            targetGameId = upcoming[count - 1] ?? nextGameId;
          }
        } else {
          targetGameId = nextGameId;
        }
        const commandId =
          firstCommandId !== null
            ? firstCommandId
            : newSeasonId(mode === 'fast-forward' ? 'ff' : 'adv');
        firstCommandId = null;
        const wireRequestId = `${requestId}-${String(commitCount)}`;
        commitCount += 1;
        const request = seasonPostseasonWireRequestOf({
          requestId: wireRequestId,
          runId: run.runId,
          rootSeed: run.rootSeed,
          commandId,
          expectedStateRevision: run.stateRevision,
          expectedStateDigest: run.stateDigest,
          humanFranchiseId: input.humanFranchiseId,
          targetGameId,
          catalogUrl: artifacts.catalogUrl,
          catalogHash: artifacts.catalogHash,
          profileUrl: artifacts.profileUrl,
          profileHash: artifacts.profileHash,
          run: deepClonePlain(run),
          effects: deepClonePlain(snapshot.effects),
          regularSeasonSummaries: snapshot.summaries,
        });
        currentWireRequestId = wireRequestId;
        const outcome = await simulate(request);
        if (requestAborted(requestId)) return;
        if (outcome.type === 'season-postseason-error') {
          if (outcome.code === 'cancelled') {
            emit({ type: 'cancelled', requestId });
          } else {
            emit({
              type: 'error',
              requestId,
              code: outcome.code,
              message: outcome.message,
              seed: outcome.seed,
              gameId: outcome.gameId,
            });
          }
          return;
        }
        if (outcome.result.status === 'rejected') {
          const rejection = outcome.result.rejection;
          emit({
            type: 'rejected',
            requestId,
            command: 'advance-postseason',
            rejection,
            message: describeAdvanceRejection(rejection),
          });
          return;
        }
        const accepted = outcome.result;
        const command: SeasonRunCommand = {
          schemaVersion: SEASON_RUN_SCHEMA_VERSION,
          command: 'advance-postseason',
          commandId,
          runId: run.runId,
          expectedStateRevision: run.stateRevision,
          expectedStateDigest: run.stateDigest,
          targetGameId,
        };
        const commitInput: CommitPostseasonAdvancementInput = {
          runId: run.runId,
          run: accepted.run,
          summaries: accepted.summaries,
          effects: postseasonPostCommandEffects(accepted.run, snapshot.effects),
          command,
          preStateRevision: command.expectedStateRevision,
          preStateDigest: command.expectedStateDigest,
          resultDigest: seasonPostseasonCommitResultDigest(
            commandId,
            accepted.advancedGameIds,
            accepted.summaries,
          ),
          relatedGameIds: [...accepted.advancedGameIds],
          transactionIds: seasonPostseasonTransactionIdsOf(accepted.run, commandId),
        };
        try {
          await repository.commitPostseasonAdvancement(commitInput);
        } catch (error) {
          if (error instanceof SeasonRunCommandDuplicateError) {
            continue;
          }
          if (
            error instanceof SeasonRunCommandStaleStateError ||
            error instanceof SeasonRunCommandRunMismatchError
          ) {
            fail(
              requestId,
              'internal',
              `the run moved before the commit could apply: ${error instanceof Error ? error.message : String(error)}`,
              run.rootSeed,
            );
            return;
          }
          fail(
            requestId,
            'internal',
            `postseason commit failed: ${error instanceof Error ? error.message : String(error)}`,
            run.rootSeed,
          );
          return;
        }
        const after = await repository.loadActiveRun();
        if (after === null) {
          fail(requestId, 'internal', 'the active run disappeared after the commit', run.rootSeed);
          return;
        }
        if (after.run.runId !== run.runId) {
          fail(requestId, 'internal', 'the active run changed after the commit', run.rootSeed);
          return;
        }
        emit({
          type: 'committed',
          requestId,
          runId: run.runId,
          gameIds: [...accepted.advancedGameIds],
          snapshot: after,
        });
        const latest = accepted.summaries[accepted.summaries.length - 1];
        emit({
          type: 'progress',
          requestId,
          gamesCompleted: accepted.advancedGameIds.length,
          gamesTotal: estimatedGamesTotal,
          latestGameId: latest?.gameId ?? null,
          latestResult: latest !== undefined ? scorelineOf(latest) : null,
        });
        if (mode === 'spectate') {
          emitComplete(requestId, run.runId, after, false, {
            nextDecision: accepted.nextDecision,
            nextGameId: accepted.nextGameId,
            aiNextGameId: accepted.aiNextGameId,
          });
          return;
        }
        if (after.run.stage === 'completed') {
          await promoteAndComplete(requestId, repository, after.run, snapshot);
          return;
        }
        if (accepted.nextDecision === 'rotation') {
          emitComplete(requestId, run.runId, after, false, {
            nextDecision: accepted.nextDecision,
            nextGameId: accepted.nextGameId,
            aiNextGameId: accepted.aiNextGameId,
          });
          return;
        }
        if (accepted.aiNextGameId === null) {
          emitComplete(requestId, run.runId, after, false, {
            nextDecision: accepted.nextDecision,
            nextGameId: accepted.nextGameId,
            aiNextGameId: accepted.aiNextGameId,
          });
          return;
        }
        if (
          mode === 'advance' &&
          terminalTarget !== null &&
          accepted.advancedGameIds.includes(terminalTarget)
        ) {
          emitComplete(requestId, run.runId, after, false, {
            nextDecision: accepted.nextDecision,
            nextGameId: accepted.nextGameId,
            aiNextGameId: accepted.aiNextGameId,
          });
          return;
        }
      }
    } catch (error) {
      if (requestAborted(requestId)) return;
      fail(requestId, 'internal', error instanceof Error ? error.message : String(error), null);
    } finally {
      currentRequestId = null;
      currentWireRequestId = null;
    }
  }
  function requestAborted(requestId: string): boolean {
    return cancelled || currentRequestId !== requestId;
  }
  function fail(
    requestId: string,
    code: 'invariant-failure' | 'cancelled' | 'internal',
    message: string,
    seed: string | null,
  ): void {
    if (cancelled) return;
    emit({
      type: 'error',
      requestId,
      code,
      message,
      seed,
      gameId: null,
    });
  }
  function emitComplete(
    requestId: string,
    runId: string,
    snapshot: SeasonRunSnapshot,
    promoted: boolean,
    decision: {
      nextDecision: 'rotation' | 'none';
      nextGameId: string | null;
      aiNextGameId: string | null;
    },
  ): void {
    const run = snapshot.run;
    emit({
      type: 'complete',
      requestId,
      runId,
      snapshot: promoted ? null : snapshot,
      stage: run.stage,
      nextDecision: decision.nextDecision,
      nextGameId: decision.nextGameId,
      aiNextGameId: decision.aiNextGameId,
      promoted,
    });
  }
  async function promoteAndComplete(
    requestId: string,
    repository: SeasonPostseasonRepository,
    run: SeasonRun,
    snapshot: SeasonRunSnapshot,
  ): Promise<void> {
    try {
      await promoteSeasonChampion(repository, run, snapshot);
      emit({
        type: 'complete',
        requestId,
        runId: run.runId,
        snapshot: null,
        stage: 'completed',
        nextDecision: 'none',
        nextGameId: null,
        aiNextGameId: null,
        promoted: true,
      });
    } catch (error) {
      fail(
        requestId,
        'internal',
        `champion promotion failed: ${error instanceof Error ? error.message : String(error)}`,
        run.rootSeed,
      );
    }
  }
  return {
    advancePostseason(input: SeasonPostseasonRunInput): string {
      return startSession(input, 'advance');
    },
    spectatePostseasonGame(
      input: SeasonPostseasonRunInput & {
        targetGameId: string;
      },
    ): string {
      return startSession(input, 'spectate');
    },
    fastForwardPostseason(input: SeasonPostseasonRunInput): string {
      return startSession(input, 'fast-forward');
    },
    cancel(requestId: string): void {
      if (requestId !== currentRequestId || cancelled) return;
      cancelled = true;
      if (worker !== null && currentWireRequestId !== null) {
        worker.postMessage(
          seasonPostseasonWorkerCancelRequestSchema.parse({
            schemaVersion: 1,
            type: 'season-postseason-cancel',
            requestId: currentWireRequestId,
          }),
        );
      }
      emit({ type: 'cancelled', requestId });
    },
    terminate(): void {
      cancelled = true;
      worker?.terminate();
      worker = null;
      currentRequestId = null;
      currentWireRequestId = null;
      warmRequestId = null;
      warmed = false;
      const failure: SeasonPostseasonWorkerErrorMessage = {
        schemaVersion: 1,
        type: 'season-postseason-error',
        requestId: '',
        code: 'cancelled',
        message: 'postseason worker terminated',
        seed: null,
        gameId: null,
      };
      for (const resolve of [...pending.values()]) resolve(failure);
      pending.clear();
    },
    prewarm(): void {
      if (currentRequestId !== null || warmed) return;
      warmed = true;
      void (async () => {
        try {
          const artifacts =
            deps.artifacts !== undefined
              ? await deps.artifacts()
              : await import('./season-assets').then((module) => module.seasonArtifactUrls());
          if (requestActive()) return;
          const target = createWorker();
          const requestId = `warm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          warmRequestId = requestId;
          target.postMessage(
            seasonPostseasonWorkerWarmRequestSchema.parse({
              schemaVersion: 1,
              type: 'season-postseason-warm',
              requestId,
              catalogUrl: artifacts.catalogUrl,
              catalogHash: artifacts.catalogHash,
              profileUrl: artifacts.profileUrl,
              profileHash: artifacts.profileHash,
            }),
          );
        } catch {
          warmRequestId = null;
        }
      })();
    },
    subscribe(listener: (event: SeasonPostseasonEvent) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  function startSession(input: SeasonPostseasonRunInput, mode: SeasonPostseasonMode): string {
    if (currentRequestId !== null) {
      throw new Error('a postseason run is already in flight; cancel it first');
    }
    const requestId = `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    currentRequestId = requestId;
    cancelled = false;
    void orchestrate(requestId, input, mode);
    return requestId;
  }
}
export async function promoteSeasonChampion(
  repository: SeasonPostseasonRepository,
  run: SeasonRun,
  snapshot: SeasonRunSnapshot,
): Promise<SeasonAlmanac> {
  const championFranchiseId = run.postseason.championFranchiseId;
  if (championFranchiseId === null) {
    throw new Error('the completed run has no champion');
  }
  const commandLog = await repository.loadCommandLog(run.runId);
  if (commandLog === null) {
    throw new Error('the completed run has no command log');
  }
  const postseasonSummaries = await repository.loadPostseasonSummaries(run.runId);
  const tradeGrades = deriveSeasonTradeGrades({
    runId: run.runId,
    run,
    summaries: snapshot.summaries,
    postseasonSummaries,
  });
  const almanacFacts = {
    schemaVersion: 1 as const,
    almanacVersion: 'almanac-v1' as const,
    runId: run.runId,
    rootSeed: run.rootSeed,
    championFranchiseId,
    postseasonDigest: seasonDigestHex(canonicalJson(run.postseason)),
    commandLogDigest: seasonCommandLogDigest(commandLog.entries),
    awardsDigest: seasonDigestHex(canonicalJson(run.awards)),
    tradeGradesDigest: seasonTradeGradeLogDigest(tradeGrades),
    digest: POSTSEASON_ALMANAC_DIGEST_PLACEHOLDER,
  };
  const almanac: SeasonAlmanac = { ...almanacFacts, digest: seasonAlmanacDigest(almanacFacts) };
  const completion = run.completion;
  if (completion === null) {
    throw new Error('the completed run has no completion state');
  }
  await repository.promoteChampionToCompleted({
    runId: run.runId,
    run: { ...run, completion: { ...completion, almanacDigest: almanac.digest } },
    almanac,
    commandLog,
    postseasonSummaries,
  });
  return almanac;
}
function describeAdvanceRejection(rejection: SeasonAdvancePostseasonRejection): string {
  switch (rejection.code) {
    case 'invalid-stage':
      return `The run is in stage ${rejection.currentStage}; advancing requires ${rejection.requiredStage} or later.`;
    case 'wrong-game':
      return `The target game ${rejection.targetGameId} is not the next game (${rejection.nextGameId}).`;
    case 'invalid-series-state':
      return `Series ${rejection.seriesId} cannot advance: ${rejection.reason}.`;
    case 'integrity-failure':
      return `The postseason integrity check failed: ${rejection.reason}.`;
    case 'run-mismatch':
      return 'The command does not belong to the active run.';
    case 'stale-state':
      return `The run moved on (revision ${String(rejection.currentStateRevision)}); the command was based on stale state. Refresh and try again.`;
    case 'duplicate-command':
      return 'This command was already applied.';
    default:
      return 'The postseason advance was rejected.';
  }
}
function deepClonePlain<T>(value: T): T {
  if (Array.isArray(value)) {
    const items = value as unknown[];
    return items.map((item) => deepClonePlain(item)) as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      out[key] = deepClonePlain((value as Record<string, unknown>)[key]);
    }
    return out as T;
  }
  return value;
}
export function getSeasonPostseasonRunner(): SeasonPostseasonRunner {
  if (typeof window !== 'undefined' && window.__HOOP_RUSH_SEASON_POSTSEASON_RUNNER__) {
    return window.__HOOP_RUSH_SEASON_POSTSEASON_RUNNER__;
  }
  if (postseasonRunnerSingleton === null) {
    postseasonRunnerSingleton = createSeasonPostseasonRunner();
  }
  return postseasonRunnerSingleton;
}
let postseasonRunnerSingleton: SeasonPostseasonRunner | null = null;
declare global {
  interface Window {
    __HOOP_RUSH_SEASON_POSTSEASON_RUNNER__?: SeasonPostseasonRunner;
  }
}
