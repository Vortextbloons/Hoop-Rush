import { expect, mock, test } from 'bun:test';
import { FULL_COURT_HEALTH_VERSION, idSchema, seedSchema } from '@hoop-rush/data-contracts';
import {
  createEngineContext,
  createFullCourtSeasonCheckpoint,
  fullCourtPlayoffView,
  simulateFullCourtPlayoffGame,
  simulateFullCourtSeasonSlot,
} from '@hoop-rush/engine';
import { fullCourtRegularSeasonGameInput, simulateRecordedFullCourtGame } from '@hoop-rush/engine';
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
  const summary = await advanceFullCourtSeasonSlot(
    { lock, expectedThroughSlot: 0, options: { record: false } },
    {
      repository,
      simulateSlot: (l, c, o) => simulateFullCourtSeasonSlot(l, c, createEngineContext(), o),
    },
  );
  expect(summary.kind).toBe('simulated');
  if (summary.kind !== 'simulated') throw new Error('Expected simulated slot');
  expect(summary.watchedReplay).toBeNull();
  expect(commitSlot).toHaveBeenCalledTimes(1);
  expect(commitSlot.mock.calls[0]?.[2]).toBeUndefined();

  // Watched sim (record: true) builds and passes a verified watchedReplay.
  const watched = await advanceFullCourtSeasonSlot(
    { lock, expectedThroughSlot: 1, options: { record: true } },
    {
      repository,
      simulateSlot: (l, c, o) => simulateFullCourtSeasonSlot(l, c, createEngineContext(), o),
    },
  );
  expect(watched.kind).toBe('simulated');
  if (watched.kind !== 'simulated') throw new Error('Expected simulated slot');
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
  // The returned replay is the authoritative one committed to storage.
  expect(watched.watchedReplay).toBe(replay ?? null);

  // Forfeit user game (even if record: true) does not pass watchedReplay.
  const forfeit = await advanceFullCourtSeasonSlot(
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
  expect(forfeit.kind).toBe('simulated');
  if (forfeit.kind !== 'simulated') throw new Error('Expected simulated slot');
  expect(forfeit.watchedReplay).toBeNull();
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
    const outcome = await advanceFullCourtPlayoffs(
      { lock, expectedGames, options: { record: true } },
      {
        repository,
        simulateGame: (l, c, o) => simulateFullCourtPlayoffGame(l, c, createEngineContext(), o),
      },
    );
    expect(outcome.kind).toBe('simulated');
    if (outcome.kind !== 'simulated') throw new Error('Expected simulated game');
    expect(outcome.watchedReplay).toBeNull();
    expectedGames += 1;
    expect(commitGame.mock.calls[expectedGames - 1]?.[1]).toBeUndefined();
  }
  expect(expectedGames).toBeGreaterThan(0);

  // User game watched -> passes watchedReplay.
  const watched = await advanceFullCourtPlayoffs(
    { lock, expectedGames, options: { record: true } },
    {
      repository,
      simulateGame: (l, c, o) => simulateFullCourtPlayoffGame(l, c, createEngineContext(), o),
    },
  );
  expect(watched.kind).toBe('simulated');
  if (watched.kind !== 'simulated') throw new Error('Expected simulated game');
  expect(commitGame).toHaveBeenCalledTimes(expectedGames + 1);
  const firstReplay = commitGame.mock.calls[expectedGames]?.[1]?.watchedReplay;
  expect(firstReplay?.identity.phase).toBe('playoff');
  expect(firstReplay?.identity.lockDigest).toBe(lock.digest);
  expect(watched.watchedReplay).toBe(firstReplay ?? null);
});

test('builds a playoff watched replay from a recorded user game', () => {
  const { season } = fullCourtTestSeasonLock();
  const fixture = season.games.find(
    (game) => game.homeTeamId === season.userTeamId || game.awayTeamId === season.userTeamId,
  );
  if (fixture === undefined) throw new Error('Expected a user fixture');
  const home = simulateRecordedFullCourtGame(
    fullCourtRegularSeasonGameInput(season, fixture.gameId),
    createEngineContext(),
  );

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
    userTeamId: season.userTeamId,
    game: {
      kind: 'played',
      result: home.result,
      tape: home.tape,
      health: {
        home: health(fixture.homeTeamId),
        away: health(fixture.awayTeamId),
      },
      injuries: [],
    },
  });

  expect(replay.result.home.box.points).toBeGreaterThanOrEqual(0);
  expect(replay.result.away.box.points).toBeGreaterThanOrEqual(0);
  expect(replay.tape.at(-1)?.kind).not.toBeUndefined();
});
