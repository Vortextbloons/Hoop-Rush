import {
  createEngineContext,
  duelGameEvents,
  findWeakestOpponent,
  shared82GameEvents,
  verifyFixedFiveCompetition,
  type EngineContext,
} from '@hoop-rush/engine';
import {
  FIXED_FIVE_WORKER_WIRE_VERSION,
  fixedFiveWorkerMessageSchema,
  fixedFiveWorkerRequestSchema,
  type FixedFiveWorkerComplete,
  type FixedFiveWorkerError,
  type FixedFiveWorkerProgress,
  type FixedFiveWorkerResultEntry,
  type FixedFiveWorkerResults,
  type FixedFiveWorkerVerificationFailed,
  type FixedFiveWorkerVerified,
  type OpponentBracket,
} from '@hoop-rush/data-contracts';
const BATCH = 4;
let currentRequestId: string | null = null;
let requestToken = 0;
let lastProgressAt = 0;
function post(
  message:
    | FixedFiveWorkerProgress
    | FixedFiveWorkerResults
    | FixedFiveWorkerComplete
    | FixedFiveWorkerError
    | FixedFiveWorkerVerified
    | FixedFiveWorkerVerificationFailed,
): void {
  fixedFiveWorkerMessageSchema.parse(message);
  self.postMessage(message);
}
function postError(requestId: string, message: string): void {
  self.postMessage({
    schemaVersion: FIXED_FIVE_WORKER_WIRE_VERSION,
    type: 'fixed-five-error',
    requestId,
    message: message.slice(0, 512),
  } satisfies FixedFiveWorkerError);
}
function maybeProgress(
  requestId: string,
  completedGames: number,
  totalGames: number,
  force = false,
): void {
  const now = Date.now();
  if (!force && now - lastProgressAt < 250) return;
  lastProgressAt = now;
  post({
    schemaVersion: FIXED_FIVE_WORKER_WIRE_VERSION,
    type: 'fixed-five-progress',
    requestId,
    completedGames,
    totalGames,
  });
}
function normalizeSimulationError(message: string): string {
  return message
    .replace(/ failed invariants: [\s\S]*$/, ' failed invariants')
    .replace(
      /^shared82 (?:p1|p2) game (\d+) failed invariants$/,
      'shared82 game $1 failed invariants',
    );
}
self.onmessage = (event: MessageEvent<unknown>): void => {
  const parsed = fixedFiveWorkerRequestSchema.safeParse(event.data);
  if (!parsed.success) {
    postError(currentRequestId ?? 'unknown', 'fixed-five worker received an invalid request');
    return;
  }
  const request = parsed.data;
  if (request.type === 'fixed-five-cancel') {
    if (request.requestId === currentRequestId) requestToken += 1;
    return;
  }
  currentRequestId = request.requestId;
  requestToken += 1;
  const token = requestToken;
  lastProgressAt = 0;
  const engineVersion =
    request.type === 'fixed-five-verify' ? request.versions.engineVersion : request.engineVersion;
  const context: EngineContext = createEngineContext({ engineVersion });
  void (async () => {
    const pending: FixedFiveWorkerResultEntry[] = [];
    function flush(requestId: string): void {
      if (pending.length === 0) return;
      post({
        schemaVersion: FIXED_FIVE_WORKER_WIRE_VERSION,
        type: 'fixed-five-results',
        requestId,
        entries: pending.splice(0, pending.length),
      });
    }
    try {
      if (request.type === 'fixed-five-verify') {
        const outcome = verifyFixedFiveCompetition(
          {
            roomId: request.roomId,
            competition: request.competition,
            rootSeed: request.rootSeed,
            versions: request.versions,
            challenge: request.challenge,
            acceptedCommands: request.acceptedCommands,
            lineups: request.lineups,
            result: request.result,
            resultDigest: request.resultDigest,
            bracket: request.bracket,
            profile: request.profile,
            dataVersion: request.dataVersion,
          },
          context,
        );
        if (token !== requestToken) return;
        if (outcome.ok) {
          post({
            schemaVersion: FIXED_FIVE_WORKER_WIRE_VERSION,
            type: 'fixed-five-verified',
            requestId: request.requestId,
            receipt: outcome.receipt,
          });
        } else {
          post({
            schemaVersion: FIXED_FIVE_WORKER_WIRE_VERSION,
            type: 'fixed-five-verification-failed',
            requestId: request.requestId,
            failures: outcome.failures,
          });
        }
        return;
      }
      if (request.type === 'fixed-five-duel') {
        let p1Wins = 0;
        let p2Wins = 0;
        let delivered = 0;
        const events = duelGameEvents(
          {
            p1Team: request.p1Team,
            p2Team: request.p2Team,
            profile: request.profile,
            rootSeed: request.rootSeed,
            dataVersion: request.dataVersion,
          },
          context,
        );
        for (;;) {
          if (token !== requestToken) return;
          const next = events.next();
          if (next.done) break;
          const { game } = next.value;
          const homeIsP1 = game.home.teamId === request.p1Team.teamId;
          if ((game.winner === 'home') === homeIsP1) p1Wins += 1;
          else p2Wins += 1;
          delivered += 1;
          pending.push(next.value);
          if (pending.length >= BATCH) flush(request.requestId);
          maybeProgress(
            request.requestId,
            delivered,
            7,
            delivered === 7 || p1Wins === 4 || p2Wins === 4,
          );
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (token !== requestToken) return;
        flush(request.requestId);
        post({
          schemaVersion: FIXED_FIVE_WORKER_WIRE_VERSION,
          type: 'fixed-five-complete',
          requestId: request.requestId,
          gamesDelivered: delivered,
          cancelled: false,
        });
        return;
      }
      const h2hSet = new Set<number>();
      const weakestId = findWeakestOpponent(request.bracket).opponentId;
      for (const entry of request.bracket.schedule) {
        if (entry.opponentId === weakestId) h2hSet.add(entry.gameNumber);
      }
      const total = 82 + 82 - h2hSet.size;
      let delivered = 0;
      const events = shared82GameEvents(
        {
          p1Team: request.p1Team,
          p2Team: request.p2Team,
          bracket: request.bracket as OpponentBracket,
          profile: request.profile,
          rootSeed: request.rootSeed,
          dataVersion: request.dataVersion,
        },
        context,
        request.startGameNumber,
      );
      for (;;) {
        if (token !== requestToken) return;
        const next = events.next();
        if (next.done) break;
        const event = next.value;
        pending.push(event);
        delivered += 1;
        if (event.tag === 'p1') continue;
        if (pending.length >= BATCH) flush(request.requestId);
        maybeProgress(request.requestId, delivered, total);
        if (event.game.gameNumber % BATCH === 0)
          await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (token !== requestToken) return;
      flush(request.requestId);
      maybeProgress(request.requestId, delivered, total, true);
      post({
        schemaVersion: FIXED_FIVE_WORKER_WIRE_VERSION,
        type: 'fixed-five-complete',
        requestId: request.requestId,
        gamesDelivered: delivered,
        cancelled: false,
      });
    } catch (error) {
      if (token !== requestToken) return;
      const message = error instanceof Error ? error.message : String(error);
      postError(
        request.requestId,
        request.type === 'fixed-five-verify' ? message : normalizeSimulationError(message),
      );
    }
  })();
};
export {};
