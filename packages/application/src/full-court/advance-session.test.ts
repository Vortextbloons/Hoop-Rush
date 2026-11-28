import { describe, expect, test } from 'bun:test';
import {
  FULL_COURT_DEFAULT_COACHING_PLAN,
  type FullCourtPlayoffCheckpoint,
  type FullCourtSeasonCheckpoint,
  type FullCourtSeasonScore,
  type FullCourtWatchedReplay,
} from '@hoop-rush/data-contracts';
import type {
  FullCourtPlayoffLock,
  FullCourtPlayoffSeries,
  FullCourtSeasonLock,
  FullCourtSeasonSlotOptions,
  FullCourtSeasonSlotOutcome,
} from '@hoop-rush/engine';
import {
  FullCourtAdvanceSession,
  type FullCourtAdvanceObserver,
  type FullCourtAdvancePlayoffCommandInput,
  type FullCourtAdvanceRequest,
  type FullCourtAdvanceSeasonCommandInput,
  type FullCourtPlayoffProgressionResult,
} from './advance-session.ts';
import type { FullCourtPlayoffView } from './progression.ts';
import type { FullCourtSeasonAdvanceResult } from './season.ts';

type SimulatedSeason = Extract<FullCourtSeasonSlotOutcome, { kind: 'simulated' }>;
type SeasonStep = Extract<FullCourtSeasonAdvanceResult, { kind: 'simulated' }>;

function seasonLock(): FullCourtSeasonLock {
  return {
    digest: 'a'.repeat(32),
    season: {
      runId: 'run',
      runSeed: 'a'.repeat(32),
      userTeamId: 'user',
      teams: [
        { teamId: 'user', displayName: 'User' },
        { teamId: 'opponent', displayName: 'Opponent' },
      ],
      games: Array.from({ length: 82 }, (_, index) => ({
        gameId: `game-${String(index + 1)}`,
        slot: index + 1,
        dayOffset: index + 1,
        homeTeamId: index % 2 === 0 ? 'user' : 'opponent',
        awayTeamId: index % 2 === 0 ? 'opponent' : 'user',
      })),
    },
  } as unknown as FullCourtSeasonLock;
}

function seasonCheckpoint(completedThroughSlot: number): FullCourtSeasonCheckpoint {
  return {
    schemaVersion: 1,
    runId: 'run',
    lockDigest: 'a'.repeat(32),
    completedThroughSlot,
    healthByTeam: {},
  } as FullCourtSeasonCheckpoint;
}

function seasonScore(slot: number): FullCourtSeasonScore {
  return {
    gameId: `game-${String(slot)}`,
    slot,
    dayOffset: slot,
    homeTeamId: slot % 2 === 0 ? 'opponent' : 'user',
    awayTeamId: slot % 2 === 0 ? 'user' : 'opponent',
    outcome: { kind: 'played', homePoints: 100, awayPoints: 90 },
  } as FullCourtSeasonScore;
}

function playedSeasonGame(
  injuries: readonly { teamId: string; playerId: string; availableFromDay: number }[] = [],
): SimulatedSeason['userGame'] {
  return { kind: 'played', injuries } as unknown as SimulatedSeason['userGame'];
}

function seasonStep(slot: number, userGame = playedSeasonGame()): SeasonStep {
  return {
    kind: 'simulated',
    checkpoint: seasonCheckpoint(slot),
    scores: [seasonScore(slot)],
    userGame,
    watchedReplay: null,
  };
}

function playoffCheckpoint(games: number): FullCourtPlayoffCheckpoint {
  return {
    schemaVersion: 1,
    runId: 'run',
    lockDigest: 'b'.repeat(32),
    games: Array.from({ length: games }, (_, index) => ({
      gameId: `playoff-${String(index + 1)}`,
      round: 1,
      seriesSlot: 0,
      dayOffset: 100 + index,
      homeTeamId: 'user',
      awayTeamId: 'opponent',
      homeSeed: 1,
      awaySeed: 8,
      winnerTeamId: 'user',
    })),
    healthByTeam: {},
  } as unknown as FullCourtPlayoffCheckpoint;
}

function playoffLock(): FullCourtPlayoffLock {
  return {
    seasonLock: seasonLock(),
    digest: 'b'.repeat(32),
    standings: {},
    initialHealth: {},
    regularScores: [],
    firstGameDay: 100,
  } as unknown as FullCourtPlayoffLock;
}

function playoffFixture(gameId: string, userSide: 'home' | 'away' | null) {
  return {
    gameId,
    dayOffset: 100,
    homeTeamId: userSide === 'away' ? 'opponent' : 'user',
    awayTeamId: userSide === 'away' ? 'user' : 'opponent',
    homeSeed: 1,
    awaySeed: 8,
    userSide,
    round: 1,
    seriesSlot: 0,
    gameOrdinal: 1,
  };
}

function playoffSeries(input: {
  readonly seriesId: string;
  readonly round: number;
  readonly highTeamId: string;
  readonly lowTeamId: string;
  readonly winners?: readonly string[];
  readonly gameIds?: readonly string[];
}): FullCourtPlayoffSeries {
  const winners = input.winners ?? [];
  return {
    seriesId: input.seriesId,
    round: input.round,
    seriesSlot: 0,
    highSeed: 1,
    lowSeed: 8,
    highTeamId: input.highTeamId,
    lowTeamId: input.lowTeamId,
    games: winners.map((winnerTeamId, index) => ({
      gameId: input.gameIds?.[index] ?? `${input.seriesId}-${String(index + 1)}`,
      dayOffset: 100 + index,
      homeTeamId: input.highTeamId,
      awayTeamId: input.lowTeamId,
      winnerTeamId,
      homePoints: winnerTeamId === input.highTeamId ? 100 : 90,
      awayPoints: winnerTeamId === input.highTeamId ? 90 : 100,
      outcome:
        winnerTeamId === input.highTeamId
          ? { kind: 'played', homePoints: 100, awayPoints: 90 }
          : { kind: 'played', homePoints: 90, awayPoints: 100 },
    })),
  } as unknown as FullCourtPlayoffSeries;
}

function playoffView(input: {
  readonly series?: readonly FullCourtPlayoffSeries[];
  readonly nextGame?: ReturnType<typeof playoffFixture> | null;
  readonly userStatus?: 'pending' | 'not-qualified' | 'eliminated' | 'champion';
  readonly championTeamId?: string | null;
}): FullCourtPlayoffView {
  return {
    series: input.series ?? [],
    championTeamId: input.championTeamId ?? null,
    userOutcome:
      input.userStatus === undefined || input.userStatus === 'pending'
        ? { status: 'pending', round: null }
        : { status: input.userStatus, round: 1 },
    nextGame: input.nextGame ?? null,
  } as unknown as FullCourtPlayoffView;
}

function emptyPinnedPlan(): FullCourtAdvanceRequest['pinned'] {
  return {
    restGameId: null,
    restingPlayerIds: [],
    matchupGameId: null,
    matchupOpponentId: null,
    matchupAssignments: [],
  };
}

function observer(overrides: Partial<FullCourtAdvanceObserver> = {}) {
  const progress: { completed: number; total: number }[] = [];
  const cleared: { gameId: string | null }[] = [];
  const archived: FullCourtPlayoffCheckpoint[] = [];
  const published: (FullCourtWatchedReplay | null)[] = [];
  const value: FullCourtAdvanceObserver = {
    isActive: () => true,
    stopRequested: () => false,
    progress: (completed, total) => progress.push({ completed, total }),
    seasonCommitted: () => {},
    playoffsCommitted: () => {},
    publishedGame: (_game, watchedReplay) => published.push(watchedReplay),
    clearGamePlan: (input) => {
      cleared.push({ gameId: input.gameId });
      return Promise.resolve();
    },
    archiveRun: (_lock, checkpoint) => {
      archived.push(checkpoint);
      return Promise.resolve();
    },
    ...overrides,
  };
  return { value, progress, cleared, archived, published };
}

function regularRequest(input: {
  readonly checkpoint?: number;
  readonly count: number;
  readonly options?: FullCourtAdvanceRequest['options'];
  readonly pinned?: FullCourtAdvanceRequest['pinned'];
}): FullCourtAdvanceRequest {
  return {
    count: input.count,
    acceptForfeit: false,
    record: false,
    options: input.options ?? {},
    season: {
      lock: seasonLock(),
      checkpoint: seasonCheckpoint(input.checkpoint ?? 0),
      scores: [],
      coaching: FULL_COURT_DEFAULT_COACHING_PLAN,
    },
    playoffs: null,
    pinned: input.pinned ?? emptyPinnedPlan(),
  };
}

function playoffRequest(input: {
  readonly view: FullCourtPlayoffView;
  readonly count: number;
  readonly options?: FullCourtAdvanceRequest['options'];
}): FullCourtAdvanceRequest {
  return {
    count: input.count,
    acceptForfeit: false,
    record: false,
    options: input.options ?? {},
    season: {
      lock: seasonLock(),
      checkpoint: seasonCheckpoint(82),
      scores: [],
      coaching: FULL_COURT_DEFAULT_COACHING_PLAN,
    },
    playoffs: {
      lock: playoffLock(),
      checkpoint: playoffCheckpoint(0),
      view: input.view,
    },
    pinned: emptyPinnedPlan(),
  };
}

describe('FullCourtAdvanceSession regular season', () => {
  test('stops at the next scheduled review slot', async () => {
    const calls: FullCourtAdvanceSeasonCommandInput[] = [];
    const seen = observer();
    const session = new FullCourtAdvanceSession({
      advanceSeasonSlot: (input) => {
        calls.push(input);
        return Promise.resolve(seasonStep(input.expectedThroughSlot + 1));
      },
      advancePlayoffGame: () => Promise.reject(new Error('unexpected playoff advance')),
      observer: seen.value,
    });

    const outcome = await session.advance(
      regularRequest({ checkpoint: 19, count: 25, options: { stopAtReview: true } }),
    );

    expect(outcome).toEqual({ kind: 'finished', stop: { kind: 'review', slot: 20 } });
    expect(calls).toHaveLength(1);
    expect(seen.progress).toEqual([
      { completed: 0, total: 25 },
      { completed: 1, total: 25 },
    ]);
  });

  test('stops after the first actionable injury', async () => {
    const seen = observer();
    const session = new FullCourtAdvanceSession({
      advanceSeasonSlot: (input) =>
        Promise.resolve(
          seasonStep(
            input.expectedThroughSlot + 1,
            playedSeasonGame([{ teamId: 'user', playerId: 'player-1', availableFromDay: 99 }]),
          ),
        ),
      advancePlayoffGame: () => Promise.reject(new Error('unexpected playoff advance')),
      observer: seen.value,
    });

    const outcome = await session.advance(
      regularRequest({ count: 5, options: { stopAtInjury: true } }),
    );

    expect(outcome).toEqual({
      kind: 'finished',
      stop: { kind: 'injury', slot: 1, playerIds: ['player-1'], availableFromDay: 99 },
    });
  });

  test('returns a game limit after the requested user games', async () => {
    const seen = observer();
    const session = new FullCourtAdvanceSession({
      advanceSeasonSlot: (input) => Promise.resolve(seasonStep(input.expectedThroughSlot + 1)),
      advancePlayoffGame: () => Promise.reject(new Error('unexpected playoff advance')),
      observer: seen.value,
    });

    const outcome = await session.advance(regularRequest({ count: 3 }));

    expect(outcome).toEqual({
      kind: 'finished',
      stop: { kind: 'game-limit', userGames: 3, bracketGames: 0 },
    });
    expect(seen.progress.at(-1)).toEqual({ completed: 3, total: 3 });
  });

  test('returns a decision without committing a slot', async () => {
    const seen = observer();
    const session = new FullCourtAdvanceSession({
      advanceSeasonSlot: () =>
        Promise.resolve({ kind: 'decision', reason: 'confirm-forfeit', fixture: {} as never }),
      advancePlayoffGame: () => Promise.reject(new Error('unexpected playoff advance')),
      observer: seen.value,
    });

    const outcome = await session.advance(regularRequest({ count: 1 }));

    expect(outcome).toEqual({ kind: 'decision', reason: 'confirm-forfeit' });
    expect(seen.progress).toEqual([{ completed: 0, total: 1 }]);
    expect(seen.cleared).toEqual([]);
  });

  test('returns stale for another tab commit', async () => {
    const seen = observer();
    const session = new FullCourtAdvanceSession({
      advanceSeasonSlot: () => Promise.resolve({ kind: 'stale', completedThroughSlot: 5 }),
      advancePlayoffGame: () => Promise.reject(new Error('unexpected playoff advance')),
      observer: seen.value,
    });

    expect(await session.advance(regularRequest({ count: 1 }))).toEqual({ kind: 'stale' });
  });

  test('applies pinned rest and matchups only to the captured fixture', async () => {
    const calls: FullCourtSeasonSlotOptions[] = [];
    const seen = observer();
    const session = new FullCourtAdvanceSession({
      advanceSeasonSlot: (input) => {
        calls.push(input.options ?? {});
        return Promise.resolve(seasonStep(input.expectedThroughSlot + 1));
      },
      advancePlayoffGame: () => Promise.reject(new Error('unexpected playoff advance')),
      observer: seen.value,
    });

    await session.advance(
      regularRequest({
        count: 2,
        pinned: {
          restGameId: 'game-1',
          restingPlayerIds: ['player-1'],
          matchupGameId: 'game-1',
          matchupOpponentId: 'opponent',
          matchupAssignments: [{ opponentPlayerId: 'opp-1', defenderPlayerId: 'player-2' }],
        },
      }),
    );

    expect(calls[0]?.restingPlayerIds).toEqual(['player-1']);
    expect(calls[0]?.defensiveMatchups?.gameId).toBe('game-1');
    expect(calls[1]?.restingPlayerIds).toBeUndefined();
    expect(calls[1]?.defensiveMatchups).toBeUndefined();
    expect(seen.cleared).toEqual([{ gameId: 'game-1' }, { gameId: 'game-2' }]);
  });

  test('honors a stop request after the committed game', async () => {
    let stopRequested = false;
    let calls = 0;
    const seen = observer({
      stopRequested: () => stopRequested,
    });
    const session = new FullCourtAdvanceSession({
      advanceSeasonSlot: (input) => {
        calls += 1;
        stopRequested = true;
        return Promise.resolve(seasonStep(input.expectedThroughSlot + 1));
      },
      advancePlayoffGame: () => Promise.reject(new Error('unexpected playoff advance')),
      observer: seen.value,
    });

    const outcome = await session.advance(regularRequest({ count: 5 }));

    expect(calls).toBe(1);
    expect(outcome).toEqual({
      kind: 'finished',
      stop: { kind: 'stopped', userGames: 1, bracketGames: 0 },
    });
  });
});

describe('FullCourtAdvanceSession playoffs', () => {
  test('counts user games, not intervening bracket games', async () => {
    const fixture = playoffFixture('playoff-user', 'home');
    const steps = [
      playoffView({ nextGame: fixture }),
      playoffView({
        nextGame: playoffFixture('playoff-ai', null),
        series: [
          playoffSeries({
            seriesId: 's1',
            round: 1,
            highTeamId: 'user',
            lowTeamId: 'opponent',
            winners: ['user'],
          }),
        ],
      }),
      playoffView({
        nextGame: fixture,
        series: [
          playoffSeries({
            seriesId: 's1',
            round: 1,
            highTeamId: 'user',
            lowTeamId: 'opponent',
            winners: ['user'],
          }),
        ],
      }),
      playoffView({
        nextGame: fixture,
        series: [
          playoffSeries({
            seriesId: 's1',
            round: 1,
            highTeamId: 'user',
            lowTeamId: 'opponent',
            winners: ['user'],
          }),
        ],
        championTeamId: 'user',
      }),
    ];
    let index = 0;
    const initialView = steps[0];
    if (initialView === undefined) throw new Error('Missing opening playoff view');
    const calls: FullCourtAdvancePlayoffCommandInput[] = [];
    const seen = observer();
    const session = new FullCourtAdvanceSession({
      advanceSeasonSlot: () => Promise.reject(new Error('unexpected season advance')),
      advancePlayoffGame: (input) => {
        calls.push(input);
        const view = steps[Math.min(index + 1, steps.length - 1)] ?? initialView;
        index += 1;
        return Promise.resolve<FullCourtPlayoffProgressionResult>({
          kind: 'simulated',
          checkpoint: playoffCheckpoint(index),
          view,
          game: { kind: 'forfeit', sides: ['home'], winner: 'away', health: {} } as never,
          watchedReplay: null,
        });
      },
      observer: seen.value,
    });

    const outcome = await session.advance(playoffRequest({ view: initialView, count: 2 }));

    expect(calls).toHaveLength(3);
    expect(outcome).toEqual({
      kind: 'finished',
      stop: { kind: 'game-limit', userGames: 2, bracketGames: 3 },
    });
  });

  test('counts bracket games when the user is eliminated', async () => {
    const fixture = playoffFixture('playoff-ai', null);
    const view = playoffView({ nextGame: fixture, userStatus: 'not-qualified' });
    let calls = 0;
    const seen = observer();
    const session = new FullCourtAdvanceSession({
      advanceSeasonSlot: () => Promise.reject(new Error('unexpected season advance')),
      advancePlayoffGame: () => {
        calls += 1;
        return Promise.resolve<FullCourtPlayoffProgressionResult>({
          kind: 'simulated',
          checkpoint: playoffCheckpoint(calls),
          view,
          game: { kind: 'forfeit', sides: ['home'], winner: 'away', health: {} } as never,
          watchedReplay: null,
        });
      },
      observer: seen.value,
    });

    const outcome = await session.advance(playoffRequest({ view, count: 2 }));

    expect(calls).toBe(2);
    expect(outcome).toEqual({
      kind: 'finished',
      stop: { kind: 'game-limit', userGames: 0, bracketGames: 2 },
    });
  });

  test('archives and reports completion when the bracket is already done', async () => {
    const seen = observer();
    const session = new FullCourtAdvanceSession({
      advanceSeasonSlot: () => Promise.reject(new Error('unexpected season advance')),
      advancePlayoffGame: () => Promise.reject(new Error('unexpected playoff advance')),
      observer: seen.value,
    });

    const outcome = await session.advance(
      playoffRequest({
        view: playoffView({ nextGame: null, userStatus: 'champion', championTeamId: 'user' }),
        count: 1,
      }),
    );

    expect(outcome).toEqual({
      kind: 'finished',
      stop: { kind: 'playoffs-complete', championTeamId: 'user', userTeamId: 'user' },
    });
    expect(seen.archived).toHaveLength(1);
  });

  test('surfaces a series win', async () => {
    const fixture = playoffFixture('playoff-final', 'home');
    const series = playoffSeries({
      seriesId: 's1',
      round: 1,
      highTeamId: 'user',
      lowTeamId: 'opponent',
      winners: ['user', 'user', 'user', 'user'],
      gameIds: ['g1', 'g2', 'g3', 'playoff-final'],
    });
    const seen = observer();
    const session = new FullCourtAdvanceSession({
      advanceSeasonSlot: () => Promise.reject(new Error('unexpected season advance')),
      advancePlayoffGame: () =>
        Promise.resolve<FullCourtPlayoffProgressionResult>({
          kind: 'simulated',
          checkpoint: playoffCheckpoint(1),
          view: playoffView({ nextGame: fixture, series: [series] }),
          game: { kind: 'forfeit', sides: ['home'], winner: 'away', health: {} } as never,
          watchedReplay: null,
        }),
      observer: seen.value,
    });

    const outcome = await session.advance(
      playoffRequest({
        view: playoffView({ nextGame: fixture, series: [series] }),
        count: 1,
      }),
    );

    expect(outcome).toEqual({
      kind: 'finished',
      stop: {
        kind: 'series-complete',
        round: 1,
        opponentTeamId: 'opponent',
        won: true,
        userWins: 4,
        opponentWins: 0,
      },
    });
  });

  test('returns control at a new opponent only once', async () => {
    const previous = playoffSeries({
      seriesId: 'crs-1-0',
      round: 1,
      highTeamId: 'user',
      lowTeamId: 'opponent',
      winners: ['user', 'user', 'user', 'user'],
    });
    const next = playoffSeries({
      seriesId: 'crs-2-0',
      round: 2,
      highTeamId: 'user',
      lowTeamId: 'next-opponent',
    });
    const fixture = playoffFixture('playoff-round-2', 'home');
    let commands = 0;
    const seen = observer();
    const session = new FullCourtAdvanceSession({
      advanceSeasonSlot: () => Promise.reject(new Error('unexpected season advance')),
      advancePlayoffGame: () => {
        commands += 1;
        return Promise.resolve<FullCourtPlayoffProgressionResult>({
          kind: 'simulated',
          checkpoint: playoffCheckpoint(1),
          view: playoffView({
            nextGame: null,
            series: [previous, next],
            championTeamId: 'user',
          }),
          game: { kind: 'forfeit', sides: ['home'], winner: 'away', health: {} } as never,
          watchedReplay: null,
        });
      },
      observer: seen.value,
    });
    const request: FullCourtAdvanceRequest = playoffRequest({
      view: playoffView({ nextGame: fixture, series: [previous, next] }),
      count: 1,
    });

    const first = await session.advance(request);
    expect(first).toEqual({
      kind: 'finished',
      stop: {
        kind: 'opponent-change',
        round: 2,
        opponentTeamId: 'next-opponent',
        gameOrdinal: 1,
      },
    });
    expect(commands).toBe(0);

    const second = await session.advance(request);
    expect(commands).toBe(1);
    expect(second).toMatchObject({ kind: 'finished' });
  });
});
