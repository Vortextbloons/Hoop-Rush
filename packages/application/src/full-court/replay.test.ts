import { expect, mock, test } from 'bun:test';
import { FULL_COURT_HEALTH_VERSION, idSchema, seedSchema } from '@hoop-rush/data-contracts';
import {
  createEngineContext,
  createFullCourtSeasonCheckpoint,
  fullCourtPlayoffView,
  simulateFullCourtPlayoffGame,
  simulateFullCourtSeasonSlot,
} from '@hoop-rush/engine';
import { simulateFullCourtBuzzerBanditTestGame } from '../../../engine/src/modes/full-court/game-test-support.ts';
import {
  fullCourtTestPlayoffLock,
  fullCourtTestSeasonLock,
} from '../../../../apps/web/src/lib/features/full-court/full-court-test-support.ts';
import {
  advanceFullCourtPlayoffs,
  advanceFullCourtSeasonSlot,
  buildFullCourtWatchedReplay,
  type FullCourtPlayoffRepository,
  type FullCourtSeasonRepository,
} from './index.ts';

test('advanceFullCourtSeasonSlot commits watchedReplay only when record=true and played', async () => {
  const lock = fullCourtTestSeasonLock();
  const initial = createFullCourtSeasonCheckpoint(lock);
  let stored = initial;
  const commitSlot = mock<FullCourtSeasonRepository['commitSlot']>((checkpoint) => {
    stored = checkpoint;
    return Promise.resolve({ status: 'committed' });
  });
  const repository: FullCourtSeasonRepository = {
    load: () => Promise.resolve(stored),
    listScores: () => Promise.resolve([]),
    create: () => Promise.resolve(),
    commitSlot,
  };

  // Summary sim (record: false) passes no watchedReplay.
  await advanceFullCourtSeasonSlot(
    { lock, expectedThroughSlot: 0, options: { record: false } },
    {
      repository,
      simulateSlot: (l, c, o) => simulateFullCourtSeasonSlot(l, c, createEngineContext(), o),
    },
  );
  expect(commitSlot).toHaveBeenCalledTimes(1);
  expect(commitSlot.mock.calls[0]?.[2]).toBeUndefined();

  // Watched sim (record: true) builds and passes a verified watchedReplay.
  await advanceFullCourtSeasonSlot(
    { lock, expectedThroughSlot: 1, options: { record: true } },
    {
      repository,
      simulateSlot: (l, c, o) => simulateFullCourtSeasonSlot(l, c, createEngineContext(), o),
    },
  );
  expect(commitSlot).toHaveBeenCalledTimes(2);
  const replay = commitSlot.mock.calls[1]?.[2]?.watchedReplay;
  expect(replay).toBeDefined();
  expect(replay?.identity).toMatchObject({
    runId: lock.season.runId,
    phase: 'regular',
    slot: 2,
    userTeamId: lock.season.userTeamId,
  });
  expect(replay?.tape.length).toBeGreaterThan(0);

  // Forfeit user game (even if record: true) does not pass watchedReplay.
  await advanceFullCourtSeasonSlot(
    { lock, expectedThroughSlot: 2, options: { record: true } },
    {
      repository,
      simulateSlot: (l, c) => {
        const simulated = simulateFullCourtSeasonSlot(l, c, createEngineContext(), {
          record: false,
        });
        if (simulated.kind !== 'simulated') throw new Error('Expected simulated slot');
        return {
          ...simulated,
          userGame: {
            kind: 'forfeit',
            sides: ['home'],
            winner: 'away',
            health: simulated.userGame.health,
          },
        };
      },
    },
  );
  expect(commitSlot).toHaveBeenCalledTimes(3);
  expect(commitSlot.mock.calls[2]?.[2]).toBeUndefined();
});

test('advanceFullCourtPlayoffs commits watchedReplay only for watched played user games', async () => {
  const seasonLock = fullCourtTestSeasonLock();
  const { lock, checkpoint } = fullCourtTestPlayoffLock(seasonLock);
  let stored = checkpoint;
  const commitGame = mock<FullCourtPlayoffRepository['commitGame']>((next) => {
    stored = next;
    return Promise.resolve();
  });
  const repository: FullCourtPlayoffRepository = {
    load: () => Promise.resolve(stored),
    create: () => Promise.resolve(),
    commitGame,
  };

  // Opening West series games have userSide === null -> never passes watchedReplay even with record=true.
  let expectedGames = 0;
  while (fullCourtPlayoffView(lock, stored).nextGame?.userSide === null) {
    await advanceFullCourtPlayoffs(
      { lock, expectedGames, options: { record: true } },
      {
        repository,
        simulateGame: (l, c, o) => simulateFullCourtPlayoffGame(l, c, createEngineContext(), o),
      },
    );
    expectedGames += 1;
    expect(commitGame.mock.calls[expectedGames - 1]?.[1]).toBeUndefined();
  }
  expect(expectedGames).toBeGreaterThan(0);

  // User game watched -> passes watchedReplay.
  await advanceFullCourtPlayoffs(
    { lock, expectedGames, options: { record: true } },
    {
      repository,
      simulateGame: (l, c, o) => simulateFullCourtPlayoffGame(l, c, createEngineContext(), o),
    },
  );
  expect(commitGame).toHaveBeenCalledTimes(expectedGames + 1);
  const firstReplay = commitGame.mock.calls[expectedGames]?.[1]?.watchedReplay;
  expect(firstReplay?.identity.phase).toBe('playoff');
  expect(firstReplay?.identity.lockDigest).toBe(lock.digest);
});

test('builds a playoff watched replay with negative live Buzzer Bandit scores', () => {
  function liveScoresOf(tape: ReturnType<typeof simulateFullCourtBuzzerBanditTestGame>['tape']) {
    let home = 0;
    let away = 0;
    for (const event of tape) {
      if (event.kind !== 'trip' && event.kind !== 'period') continue;
      home = Math.min(home, event.homeScore);
      away = Math.min(away, event.awayScore);
    }
    return { home, away };
  }

  const home = simulateFullCourtBuzzerBanditTestGame({ seed: 'bz-replay-2', gameNumber: 83 });
  expect(liveScoresOf(home.tape)).toEqual({ home: -1, away: 0 });
  const away = simulateFullCourtBuzzerBanditTestGame({ seed: 'bz-replay-6', gameNumber: 83 });
  expect(liveScoresOf(away.tape)).toEqual({ home: 0, away: -1 });

  const health = (teamId: string) => ({
    version: FULL_COURT_HEALTH_VERSION as 'full-court-health-v1',
    teamId,
    throughDay: 173,
    players: {},
  });
  const replay = buildFullCourtWatchedReplay({
    phase: 'playoff',
    runId: idSchema.parse('bz-replay-run'),
    seasonLockDigest: seedSchema.parse('a'.repeat(32)),
    lockDigest: seedSchema.parse('b'.repeat(32)),
    gameId: 'fcp-1-0-1',
    slot: null,
    dayOffset: 173,
    userTeamId: 'home',
    game: {
      kind: 'played',
      result: home.result,
      tape: home.tape,
      health: { home: health('home'), away: health('away') },
      injuries: [],
    },
  });

  expect(liveScoresOf(replay.tape)).toEqual({ home: -1, away: 0 });
  expect(replay.result.home.box.points).toBeGreaterThanOrEqual(0);
  expect(replay.result.away.box.points).toBeGreaterThanOrEqual(0);
  expect(replay.tape.at(-1)?.kind).not.toBeUndefined();
});
