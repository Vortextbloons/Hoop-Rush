import { expect, test, mock } from 'bun:test';
import type { CapRushService } from '@hoop-rush/application/cap-rush';
import {
  CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
  type CapRushPlayoffGamePlan,
} from '@hoop-rush/data-contracts';
import { createEngineContext, simulateCapRushPlayoffGame } from '@hoop-rush/engine';
import { CapRushSeasonController } from './cap-rush-season-state.svelte';
import type { CapRushRunner } from './cap-rush-runner';
import { lockedRun } from './cap-rush-runner-test-support';

test('playoff batches retain accepted games without reloading the season archive', async () => {
  const locked = lockedRun();
  const draft = { draft: { locked } };
  const opponent = locked.opponents[0];
  if (opponent === undefined) throw new Error('missing opponent');
  const plan: CapRushPlayoffGamePlan = {
    seriesId: 'crs-1-0',
    round: 1,
    seriesSlot: 0,
    gameOrdinal: 1,
    homeTeamId: locked.human.teamId,
    awayTeamId: opponent.team.teamId,
    homeSeed: 1,
    awaySeed: 8,
    userSide: 'home',
    isFinals: false,
    seed: locked.runSeed,
  };
  const { game } = simulateCapRushPlayoffGame({ locked, plan, context: createEngineContext() });
  const loadActive = mock(() => Promise.resolve({ draft }));
  const acceptPlayoffGame = mock(() => Promise.resolve());
  const service = {
    loadActive,
    acceptPlayoffGame,
    getSnapshot: () => ({ draft }),
  } as unknown as CapRushService;
  const runner = {
    simulatePlayoffs: async (input: Parameters<CapRushRunner['simulatePlayoffs']>[0]) => {
      await input.handlers.onGame({
        schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
        type: 'cap-rush-playoff-game',
        requestId: input.requestId,
        game,
      });
      return { cancelled: false };
    },
  } as unknown as CapRushRunner;
  const controller = new CapRushSeasonController(service, runner);
  Object.assign(controller, { draft });
  const batch = controller as unknown as {
    simulatePlayoffBatch(games: CapRushPlayoffGamePlan[]): Promise<number | null>;
  };
  expect(await batch.simulatePlayoffBatch([plan])).toBe(1);
  expect(acceptPlayoffGame).toHaveBeenCalledWith({ summary: game.summary, stored: game });
  expect(controller.playoffGames).toEqual([game]);
  expect(loadActive).not.toHaveBeenCalled();
  expect(controller.draft).toBe(draft as unknown as typeof controller.draft);
});

test('sim series stops when the next round opens immediately', async () => {
  const locked = lockedRun();
  let round = 1;
  const draftOf = () => ({
    draft: { locked, stage: 'postseason' },
    postseason: {
      series: [{ round, highTeamId: locked.human.teamId, lowTeamId: 'opponent', games: [] }],
    },
  });
  const service = {
    postseasonStep: mock(() => ({ kind: 'games', games: [{ userSide: 'home' }] })),
  } as unknown as CapRushService;
  const controller = new CapRushSeasonController(service, {} as CapRushRunner);
  const batch = mock(() => {
    round += 1;
    Object.assign(controller, { draft: draftOf() });
    return Promise.resolve(1);
  });
  Object.assign(controller, {
    draft: draftOf(),
    simulatePlayoffBatch: batch,
    load: async () => {},
  });
  expect(await controller.simSeries()).toBe(true);
  expect(batch).toHaveBeenCalledTimes(1);
});
