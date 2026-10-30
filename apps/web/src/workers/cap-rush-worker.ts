import {
  CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
  capRushLeagueSeed,
  capRushWorkerMessageSchema,
  capRushWorkerRequestSchema,
  type CapRushLockedInputs,
  type CapRushPlayoffGamePlan,
  type CapRushWorkerErrorCode,
  type OpponentBracket,
} from '@hoop-rush/data-contracts';
import {
  createCapRushLeagueSimulation,
  createEngineContext,
  simulateCapRushGame,
  simulateCapRushLeagueSlot,
  simulateCapRushPlayoffGame,
} from '@hoop-rush/engine';
import { sleep } from '../lib/sleep';

const engineContext = createEngineContext();
const cancelledRequests = new Set<string>();
const PROGRESS_INTERVAL_MS = 250;
const STANDINGS_BATCH = 40;

function post(message: unknown): void {
  self.postMessage(capRushWorkerMessageSchema.parse(message));
}

function postError(
  requestId: string,
  code: CapRushWorkerErrorCode,
  message: string,
  gameNumber: number | null,
): void {
  post({
    schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
    type: 'cap-rush-error',
    requestId,
    code,
    message: message.slice(0, 512),
    gameNumber,
  });
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown cap rush worker failure';
}

async function simulate(
  request: {
    requestId: string;
    locked: Parameters<typeof simulateCapRushGame>[0]['locked'];
    startGame: number;
    count: number;
  },
  signal: { cancelled: boolean },
): Promise<void> {
  const lastGame = Math.min(request.startGame + request.count - 1, request.locked.schedule.length);
  let delivered = 0;
  let lastCursor = request.startGame - 1;
  let lastProgressAt = Date.now();

  for (let gameNumber = request.startGame; gameNumber <= lastGame; gameNumber += 1) {
    if (signal.cancelled || cancelledRequests.has(request.requestId)) {
      cancelledRequests.delete(request.requestId);
      post({
        schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
        type: 'cap-rush-complete',
        requestId: request.requestId,
        gamesDelivered: delivered,
        cancelled: true,
        lastCursor,
      });
      return;
    }

    let simulation;
    try {
      simulation = simulateCapRushGame({
        locked: request.locked,
        gameNumber,
        context: engineContext,
      });
    } catch (error) {
      postError(request.requestId, 'internal', failureMessage(error), gameNumber);
      return;
    }

    if (simulation.summary.gameNumber !== gameNumber) {
      postError(request.requestId, 'stale-job', 'worker produced an out-of-order game', gameNumber);
      return;
    }
    if (!simulation.audit.ok) {
      const first = simulation.audit.findings[0];
      postError(
        request.requestId,
        'audit-failure',
        first === undefined ? 'game audit failed' : `${first.code}: ${first.message}`,
        gameNumber,
      );
      return;
    }

    let leagueGames;
    if (request.locked.leagueSchedule !== undefined) {
      try {
        leagueGames = simulateCapRushLeagueSlot({
          locked: request.locked,
          slot: gameNumber,
          context: engineContext,
        });
      } catch (error) {
        postError(request.requestId, 'internal', failureMessage(error), gameNumber);
        return;
      }
    }

    post({
      schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
      type: 'cap-rush-game',
      requestId: request.requestId,
      cursor: gameNumber,
      inputDigest: simulation.summary.inputDigest,
      resultDigest: simulation.summary.resultDigest,
      isolations: simulation.facts.filter((fact) => fact.kind === 'isolation').length,
      strikes: simulation.facts.filter((fact) => fact.kind === 'strike').length,
      summary: simulation.summary,
      audit: simulation.audit,
      result: simulation.result,
      ...(leagueGames === undefined ? {} : { leagueGames }),
    });
    delivered += 1;
    lastCursor = gameNumber;

    if (Date.now() - lastProgressAt >= PROGRESS_INTERVAL_MS) {
      lastProgressAt = Date.now();
      post({
        schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
        type: 'cap-rush-progress',
        requestId: request.requestId,
        gamesCompleted: gameNumber,
        gamesTotal: lastGame,
      });
      await sleep(0);
    }
  }

  post({
    schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
    type: 'cap-rush-complete',
    requestId: request.requestId,
    gamesDelivered: delivered,
    cancelled: false,
    lastCursor,
  });
}

async function completeStandings(
  request: { requestId: string; locked: CapRushLockedInputs; bracket: OpponentBracket },
  signal: { cancelled: boolean },
): Promise<void> {
  const simulation = createCapRushLeagueSimulation(
    {
      seed: capRushLeagueSeed(request.locked.runSeed),
      bracket: request.bracket,
      profile: request.locked.profile,
    },
    engineContext,
  );
  let lastProgressAt = Date.now();
  while (simulation.gamesDone < simulation.gamesTotal) {
    if (signal.cancelled || cancelledRequests.has(request.requestId)) {
      cancelledRequests.delete(request.requestId);
      post({
        schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
        type: 'cap-rush-standings-complete',
        requestId: request.requestId,
        result: null,
        cancelled: true,
      });
      return;
    }
    const remaining = simulation.gamesTotal - simulation.gamesDone;
    simulation.advance(Math.min(STANDINGS_BATCH, remaining));
    if (Date.now() - lastProgressAt >= PROGRESS_INTERVAL_MS) {
      lastProgressAt = Date.now();
      post({
        schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
        type: 'cap-rush-progress',
        requestId: request.requestId,
        gamesCompleted: simulation.gamesDone,
        gamesTotal: simulation.gamesTotal,
      });
      await sleep(0);
    }
  }
  post({
    schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
    type: 'cap-rush-standings-complete',
    requestId: request.requestId,
    result: simulation.finish(),
    cancelled: false,
  });
}

async function simulatePlayoffs(
  request: {
    requestId: string;
    locked: CapRushLockedInputs;
    games: CapRushPlayoffGamePlan[];
  },
  signal: { cancelled: boolean },
): Promise<void> {
  let delivered = 0;
  for (const plan of request.games) {
    if (signal.cancelled || cancelledRequests.has(request.requestId)) {
      cancelledRequests.delete(request.requestId);
      post({
        schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
        type: 'cap-rush-playoffs-complete',
        requestId: request.requestId,
        gamesDelivered: delivered,
        cancelled: true,
      });
      return;
    }
    let simulation;
    try {
      simulation = simulateCapRushPlayoffGame({
        locked: request.locked,
        plan,
        context: engineContext,
      });
    } catch (error) {
      postError(request.requestId, 'internal', failureMessage(error), null);
      return;
    }
    if (!simulation.game.audit.ok) {
      const first = simulation.game.audit.findings[0];
      postError(
        request.requestId,
        'audit-failure',
        first === undefined ? 'playoff game audit failed' : `${first.code}: ${first.message}`,
        null,
      );
      return;
    }
    post({
      schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
      type: 'cap-rush-playoff-game',
      requestId: request.requestId,
      game: simulation.game,
    });
    delivered += 1;
    await sleep(0);
  }
  post({
    schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
    type: 'cap-rush-playoffs-complete',
    requestId: request.requestId,
    gamesDelivered: delivered,
    cancelled: false,
  });
}

self.onmessage = (event: MessageEvent<unknown>): void => {
  const parsed = capRushWorkerRequestSchema.safeParse(event.data);
  if (!parsed.success) {
    postError('unknown', 'internal', 'unrecognised cap rush worker request', null);
    return;
  }
  const request = parsed.data;
  switch (request.type) {
    case 'cap-rush-cancel':
      cancelledRequests.add(request.requestId);
      return;
    case 'cap-rush-simulate': {
      const signal = { cancelled: false };
      void simulate(request, signal).catch((error: unknown) => {
        postError(request.requestId, 'internal', failureMessage(error), null);
      });
      return;
    }
    case 'cap-rush-standings': {
      const signal = { cancelled: false };
      void completeStandings(request, signal).catch((error: unknown) => {
        postError(request.requestId, 'internal', failureMessage(error), null);
      });
      return;
    }
    case 'cap-rush-playoffs': {
      const signal = { cancelled: false };
      void simulatePlayoffs(request, signal).catch((error: unknown) => {
        postError(request.requestId, 'internal', failureMessage(error), null);
      });
      return;
    }
  }
};
