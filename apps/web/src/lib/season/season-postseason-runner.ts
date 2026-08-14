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

/**
 * Season Run postseason runner contract (spec/2.0/07, M2.6). The main-thread
 * runner owns request ids, stale-message rejection, cancellation, worker
 * lifecycle, atomic commits, and champion promotion. It simulates and
 * commits ONE game per atomic commit for the advance loop (target = the
 * current next game), continues AI-only games until the next human rotation
 * decision or stage completion, and chunks an eliminated-run fast-forward at
 * at most EIGHT games per atomic commit (target = the Nth upcoming game).
 * After EVERY commit the authoritative snapshot is re-read; committed work
 * survives reload, cancellation, stale-state rejection, duplicate command
 * ids (idempotent retry), and cross-tab mutation.
 *
 * ## Recovered failure modes (frozen)
 *
 * - reload / termination: every loop iteration re-reads the repository, so
 *   a fresh hub starts from the accepted state (no in-flight request).
 * - stale revision/digest or run-mismatch at the commit: another tab moved
 *   the run between the re-read and the commit — the runner reloads the
 *   authoritative state (through the fresh re-read) and stops with a typed
 *   error so the hub's cross-tab recovery can take over.
 * - duplicate command id: the same commandId was already committed (retry
 *   after a crash/reload) — the runner re-reads and continues.
 * - cancellation: observed at every boundary (between games AND mid-chunk);
 *   committed chunks are retained and the uncommitted chunk is discarded.
 * - engine rejections (wrong-game, invalid-stage, integrity-failure) are
 *   VALID outcomes of a well-formed request and surface as typed `rejected`
 *   events, never as errors.
 *
 * ## Effects/digest scope (resolved at integration)
 *
 * The engine state digest covers the post-advance effects state; the commit
 * carries the post-command effects (`postseasonPostCommandEffects` over the
 * engine's output run) so the stored checkpoint row reconciles with the
 * digest the reload audit recomputes (mirrors the M2.5 applySeasonRunCommand
 * effects seam; zero-transition advances fall back to the prior state).
 */

export type SeasonPostseasonMode = 'advance' | 'spectate' | 'fast-forward';

export type SeasonPostseasonEvent =
  | {
      type: 'started';
      requestId: string;
      mode: SeasonPostseasonMode;
      targetGameId: string | null;
      /** Estimated remaining tournament games at session start (or 0). */
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
      /** Games committed by this atomic commit, in play order. */
      gameIds: string[];
      /** The authoritative re-read snapshot after the commit. */
      snapshot: SeasonRunSnapshot;
    }
  | {
      type: 'complete';
      requestId: string;
      runId: string;
      /**
       * The authoritative post-commit snapshot at the end of the
       * orchestration; null when the champion was promoted (no active run
       * remains).
       */
      snapshot: SeasonRunSnapshot | null;
      stage: SeasonRunStage;
      nextDecision: 'rotation' | 'none';
      nextGameId: string | null;
      aiNextGameId: string | null;
      /** True when the champion was promoted to completed history. */
      promoted: boolean;
    }
  | {
      type: 'rejected';
      requestId: string;
      command: SeasonRunCommand['command'];
      rejection: SeasonAdvancePostseasonRejection;
      message: string;
    }
  | { type: 'cancelled'; requestId: string }
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
  /** The FIRST commit's command id (idempotent retry after reload/crash). */
  commandId: string;
  /**
   * Optional terminal goal of the session: advance commits one game at a
   * time until this game is committed; spectate requires it (the engine
   * validates it is the current next game); fast-forward uses it as the
   * first chunk's target (must be among the first 8 upcoming games).
   */
  targetGameId?: string;
  /** The human franchise; null in a pure AI context. */
  humanFranchiseId: string | null;
}

/**
 * The engine simulation seam: given the schema-validated wire request,
 * returns the worker's complete/error outcome. The production binding posts
 * to the worker; tests and e2e inject the direct engine simulator so the
 * exact same runner loop runs without a Worker.
 */
export type SeasonPostseasonSimulatorFn = (
  request: SeasonPostseasonWorkerStartRequest,
  onProgress: (progress: SeasonPostseasonWorkerProgressMessage) => void,
) => Promise<SeasonPostseasonWorkerCompleteMessage | SeasonPostseasonWorkerErrorMessage>;

export interface SeasonPostseasonRunner {
  /** Advances one game per atomic commit until a human rotation is needed,
   * the optional terminal target is committed, or the tournament completes. */
  advancePostseason(input: SeasonPostseasonRunInput): string;
  /** Simulates exactly the named game (engine-validated) and commits it. */
  spectatePostseasonGame(input: SeasonPostseasonRunInput & { targetGameId: string }): string;
  /** Chunks the remaining tournament at ≤ 8 games per atomic commit through
   * the champion, then promotes it to completed history. Requires the human
   * franchise to be eliminated. */
  fastForwardPostseason(input: SeasonPostseasonRunInput): string;
  /** Requests cancellation; committed chunks are retained. */
  cancel(requestId: string): void;
  /** Tears down the worker immediately (route change / full abort). */
  terminate(): void;
  /** Prewarms the worker's packaged asset caches (idempotent, best effort). */
  prewarm(): void;
  subscribe(listener: (event: SeasonPostseasonEvent) => void): () => void;
}

/** @internal Factory dependencies for tests and the e2e seam. */
export interface SeasonPostseasonRunnerDeps {
  repository?: SeasonRunRepository & SeasonPostseasonRepository;
  schedule?: SeasonSchedule;
  /** Overrides the packaged worker entry (tests). */
  workerUrl?: string;
  /** Overrides asset resolution (tests). */
  artifacts?: () => Promise<SeasonArtifactUrls>;
  /** Overrides the engine simulation seam (tests/e2e direct simulator). */
  simulate?: SeasonPostseasonSimulatorFn;
}

/** The maximum games one fast-forward chunk may commit atomically. */
export const SEASON_POSTSEASON_CHUNK_MAX_GAMES = 8;

/**
 * Main-thread postseason runner (spec/2.0/07, M2.6). One loop per session:
 * re-read the authoritative snapshot, derive the commit target, simulate
 * through the engine (worker or injected simulator), commit atomically
 * through the repository, re-read, decide the continuation, and finally
 * promote the champion when the stage completes. Nothing is persisted before
 * acceptance; cancelled or crashed work leaves the accepted commits intact.
 */
export function createSeasonPostseasonRunner(
  deps: SeasonPostseasonRunnerDeps = {},
): SeasonPostseasonRunner {
  const listeners = new Set<(event: SeasonPostseasonEvent) => void>();
  let worker: Worker | null = null;
  let currentRequestId: string | null = null;
  /** The wire request id of the in-flight engine request (cancel routing). */
  let currentWireRequestId: string | null = null;
  let cancelled = false;
  let warmRequestId: string | null = null;
  let warmed = false;
  /** In-flight engine request resolvers, keyed by wire request id. */
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
      // A worker load/execution failure resolves every in-flight request as
      // a typed internal error; the loop surfaces it and stops.
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
      // The message union is narrowed here: the only remaining type is the
      // season-postseason-error message.
      const resolve = pending.get(message.requestId);
      if (resolve === undefined) return;
      pending.delete(message.requestId);
      resolve(message);
    });
    return worker;
  }

  /**
   * Simulates one engine advance: the production binding posts the validated
   * wire request to the worker and awaits the routed outcome; the injected
   * simulator runs the same request through the direct engine core.
   */
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
        // Authoritative re-read before every commit: reload recovery,
        // cross-tab recovery, and idempotent retry all start here.
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
          // The engine rejects any target that is not the current next game.
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
        // A zero-game advance is VALID: the engine stops at a human rotation
        // wait (the saved rotation cannot play the current next game) and
        // still records the decision-point command + state bump. The commit
        // follows the cross-track reference flow (empty summaries/ids).
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
          // The state digest covers the post-advance effects; store them so
          // the reload audit's digest reconciliation holds (mirrors the M2.5
          // applySeasonRunCommand effects seam).
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
            // Idempotent retry: a previous attempt already committed this
            // command (crash/reload between commit and acknowledgement).
            // Re-read and continue from the authoritative state.
            continue;
          }
          if (
            error instanceof SeasonRunCommandStaleStateError ||
            error instanceof SeasonRunCommandRunMismatchError
          ) {
            // Another tab moved the run between the re-read and the commit:
            // the loop's next re-read loads the authoritative state; stop so
            // the hub's cross-tab recovery can take over.
            fail(
              requestId,
              'internal',
              `the run moved before the commit could apply: ${
                error instanceof Error ? error.message : String(error)
              }`,
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
        // Authoritative re-read after EVERY commit (frozen contract).
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
        // Continue the loop: the next commit derives from the re-read state.
      }
    } catch (error) {
      if (requestAborted(requestId)) return;
      fail(requestId, 'internal', error instanceof Error ? error.message : String(error), null);
    } finally {
      currentRequestId = null;
      currentWireRequestId = null;
    }
  }

  /** True when the session was cancelled or superseded (guard helper keeps
   * the flow analyzable for the lint's no-unnecessary-condition pass). */
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
    spectatePostseasonGame(input: SeasonPostseasonRunInput & { targetGameId: string }): string {
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
          // A session can start while the warm artifacts resolve; re-check.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (currentRequestId !== null) return;
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

/**
 * Atomic champion promotion (frozen reference flow: the persistence
 * cross-track test builds the almanac over `{schemaVersion, almanacVersion,
 * runId, rootSeed, championFranchiseId, postseasonDigest, commandLogDigest,
 * awardsDigest, tradeGradesDigest}` and replaces the run's placeholder
 * `completion.almanacDigest` with the real digest — the run `stateDigest` is
 * never recomputed). The command log and postseason summaries load from the
 * repository after the final advance commit; the trade grades derive from
 * the recorded facts (trade-grade-v1) right before promotion.
 */
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

/** Human-readable explanation of an advance rejection (runner-side alert). */
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

/**
 * Deep plain snapshot of worker-boundary payload slices (mirror of the block
 * runner's helper): Svelte $state Proxy-backed values are de-proxied without
 * a whole-payload JSON round trip.
 */
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

/** Singleton runner for the application (lazy deps; e2e may inject a fake). */
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
