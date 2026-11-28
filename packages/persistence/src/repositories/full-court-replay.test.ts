import { afterEach, expect, test } from 'bun:test';
import {
  FULL_COURT_HEALTH_VERSION,
  FULL_COURT_MAX_TAPE_EVENTS,
  FULL_COURT_SEASON_SAVE_SCHEMA_VERSION,
  FULL_COURT_WATCHED_REPLAY_SCHEMA_VERSION,
  fullCourtSeasonCheckpointSchema,
  fullCourtSeasonScoreSchema,
  fullCourtTeamHealthSchema,
  fullCourtWatchedReplaySchema,
  type FullCourtSeasonCheckpoint,
  type FullCourtSeasonScore,
  type FullCourtTeamHealth,
  type FullCourtWatchedReplay,
} from '@hoop-rush/data-contracts';
import {
  buildFullCourtGameReport,
  createEngineContext,
  fullCourtPlayoffView,
  fullCourtRegularSeasonGameInput,
  simulateFullCourtPlayoffGame,
  simulateRecordedFullCourtGame,
} from '@hoop-rush/engine';
import {
  fullCourtTestPlayoffLock,
  fullCourtTestSeasonLock,
} from '../../../../apps/web/src/lib/features/full-court/full-court-test-support.ts';
import {
  openTestDatabasePair,
  resetIndexedDb,
  restoreIndexedDb,
} from '../testing/repo-test-support.ts';
import { createFullCourtPlayoffRepository } from './full-court-playoffs.ts';
import { createFullCourtWatchedReplayRepository } from './full-court-replay.ts';
import { createFullCourtSeasonRepository } from './full-court-season.ts';

afterEach(restoreIndexedDb);

function buildSlotOneFixture() {
  const lock = fullCourtTestSeasonLock();
  const runId = lock.season.runId;
  const entries = lock.season.games.filter((game) => game.slot === 1);
  const userFixture = entries.find(
    (game) =>
      game.homeTeamId === lock.season.userTeamId || game.awayTeamId === lock.season.userTeamId,
  );
  if (userFixture === undefined) throw new Error('Missing user fixture');
  const input = fullCourtRegularSeasonGameInput(lock.season, userFixture.gameId);
  const { result, tape } = simulateRecordedFullCourtGame(input, createEngineContext());
  const userSide = userFixture.homeTeamId === lock.season.userTeamId ? 'home' : 'away';
  const opponentSide = userSide === 'home' ? 'away' : 'home';
  const report = buildFullCourtGameReport({
    kind: 'played',
    gameId: userFixture.gameId,
    userSide,
    result,
    tape,
  });
  if (report.status !== 'played') throw new Error('Expected played report');

  const healthByTeam: Record<string, FullCourtTeamHealth> = {};
  const scores: FullCourtSeasonScore[] = entries.map((fixture) => {
    healthByTeam[fixture.homeTeamId] = fullCourtTeamHealthSchema.parse({
      version: FULL_COURT_HEALTH_VERSION,
      teamId: fixture.homeTeamId,
      throughDay: fixture.dayOffset,
      players: {},
    });
    healthByTeam[fixture.awayTeamId] = fullCourtTeamHealthSchema.parse({
      version: FULL_COURT_HEALTH_VERSION,
      teamId: fixture.awayTeamId,
      throughDay: fixture.dayOffset,
      players: {},
    });
    if (fixture.gameId === userFixture.gameId) {
      return fullCourtSeasonScoreSchema.parse({
        ...fixture,
        outcome: {
          kind: 'played',
          homePoints: result.home.box.points,
          awayPoints: result.away.box.points,
        },
      });
    }
    return fullCourtSeasonScoreSchema.parse({
      ...fixture,
      outcome: { kind: 'played', homePoints: 100, awayPoints: 95 },
    });
  });

  const initial = fullCourtSeasonCheckpointSchema.parse({
    schemaVersion: FULL_COURT_SEASON_SAVE_SCHEMA_VERSION,
    runId,
    lockDigest: lock.digest,
    completedThroughSlot: 0,
    healthByTeam: {},
  });
  const checkpoint = fullCourtSeasonCheckpointSchema.parse({
    schemaVersion: FULL_COURT_SEASON_SAVE_SCHEMA_VERSION,
    runId,
    lockDigest: lock.digest,
    completedThroughSlot: 1,
    healthByTeam,
  });

  const replay: FullCourtWatchedReplay = fullCourtWatchedReplaySchema.parse({
    schemaVersion: FULL_COURT_WATCHED_REPLAY_SCHEMA_VERSION,
    identity: {
      runId,
      phase: 'regular',
      seasonLockDigest: lock.digest,
      lockDigest: lock.digest,
      gameId: userFixture.gameId,
      slot: 1,
      dayOffset: userFixture.dayOffset,
      homeTeamId: userFixture.homeTeamId,
      awayTeamId: userFixture.awayTeamId,
      userTeamId: lock.season.userTeamId,
      userSide,
      gameNumber: result.gameNumber,
      gameSeed: result.seed,
    },
    facts: {
      teamPoints: result[userSide].box.points,
      opponentPoints: result[opponentSide].box.points,
      userWon: result.winner === userSide,
      starterPoints: report.bench.starterPoints,
      benchPoints: report.bench.points,
      teamBonusPoints: report.teamBonusPoints,
      benchPlayerCount: report.bench.players.length,
      lineupCount: report.lineupRows.length,
    },
    health: {
      home: healthByTeam[userFixture.homeTeamId],
      away: healthByTeam[userFixture.awayTeamId],
    },
    injuries: [],
    result,
    tape,
  });

  return { lock, initial, checkpoint, scores, userFixture, replay };
}

function slotTwoWithoutReplay(lock: ReturnType<typeof fullCourtTestSeasonLock>): {
  checkpoint: FullCourtSeasonCheckpoint;
  scores: FullCourtSeasonScore[];
} {
  const entries = lock.season.games.filter((game) => game.slot === 2);
  const healthByTeam: Record<string, FullCourtTeamHealth> = {};
  const scores = entries.map((fixture) => {
    healthByTeam[fixture.homeTeamId] = fullCourtTeamHealthSchema.parse({
      version: FULL_COURT_HEALTH_VERSION,
      teamId: fixture.homeTeamId,
      throughDay: fixture.dayOffset,
      players: {},
    });
    healthByTeam[fixture.awayTeamId] = fullCourtTeamHealthSchema.parse({
      version: FULL_COURT_HEALTH_VERSION,
      teamId: fixture.awayTeamId,
      throughDay: fixture.dayOffset,
      players: {},
    });
    return fullCourtSeasonScoreSchema.parse({
      ...fixture,
      outcome: { kind: 'played', homePoints: 102, awayPoints: 99 },
    });
  });
  const checkpoint = fullCourtSeasonCheckpointSchema.parse({
    schemaVersion: FULL_COURT_SEASON_SAVE_SCHEMA_VERSION,
    runId: lock.season.runId,
    lockDigest: lock.digest,
    completedThroughSlot: 2,
    healthByTeam,
  });
  return { checkpoint, scores };
}

test('commits watched regular-season replay atomically, reloads across DB, retries idempotently, and retains across summary slots', async () => {
  resetIndexedDb();
  const { first, second } = openTestDatabasePair('full-court-replay-season');
  try {
    const seasonRepo = createFullCourtSeasonRepository(first);
    const replayRepo = createFullCourtWatchedReplayRepository(first);
    const { lock, initial, checkpoint, scores, replay } = buildSlotOneFixture();
    await seasonRepo.create(initial);

    expect(await seasonRepo.commitSlot(checkpoint, scores, { watchedReplay: replay })).toEqual({
      status: 'committed',
    });
    expect(await replayRepo.load(lock.season.runId)).toEqual(replay);
    expect(await seasonRepo.commitSlot(checkpoint, scores, { watchedReplay: replay })).toEqual({
      status: 'replayed',
    });

    // Quick-simming slot 2 without watchedReplay preserves slot 1's watched replay.
    const slot2 = slotTwoWithoutReplay(lock);
    expect(await seasonRepo.commitSlot(slot2.checkpoint, slot2.scores)).toEqual({
      status: 'committed',
    });
    expect(await replayRepo.load(lock.season.runId)).toEqual(replay);

    first.close();
    const reopenedReplayRepo = createFullCourtWatchedReplayRepository(second);
    const reopenedSeasonRepo = createFullCourtSeasonRepository(second);
    expect(await reopenedSeasonRepo.load(lock.season.runId)).toEqual(slot2.checkpoint);
    expect(await reopenedReplayRepo.load(lock.season.runId)).toEqual(replay);
  } finally {
    first.close();
    second.close();
  }
});

test('rejects conflicting replays, forfeit replays, and non-matching retries without partial writes', async () => {
  resetIndexedDb();
  const { first, second } = openTestDatabasePair('full-court-replay-conflicts');
  try {
    const seasonRepo = createFullCourtSeasonRepository(first);
    const replayRepo = createFullCourtWatchedReplayRepository(first);
    const { lock, initial, checkpoint, scores, userFixture, replay } = buildSlotOneFixture();
    await seasonRepo.create(initial);

    // Rejects attaching a watched replay to a forfeit score without writing checkpoint or scores.
    const forfeitScores = scores.map((score) =>
      score.gameId === userFixture.gameId
        ? fullCourtSeasonScoreSchema.parse({
            ...score,
            outcome: { kind: 'forfeit', losingSides: ['home'] },
          })
        : score,
    );
    await expect(
      seasonRepo.commitSlot(checkpoint, forfeitScores, { watchedReplay: replay }),
    ).rejects.toThrow('Forfeit games cannot carry a watched replay');
    expect(await seasonRepo.load(lock.season.runId)).toEqual(initial);
    expect(await seasonRepo.listScores(lock.season.runId)).toEqual([]);
    expect(await replayRepo.load(lock.season.runId)).toBeNull();

    // Commit slot 1 without a replay, then reject a competing retry that tries to attach a replay.
    const otherSeasonRepo = createFullCourtSeasonRepository(second);
    await seasonRepo.commitSlot(checkpoint, scores);
    await expect(
      otherSeasonRepo.commitSlot(checkpoint, scores, { watchedReplay: replay }),
    ).rejects.toThrow('already committed without matching watched replay');
    expect(await replayRepo.load(lock.season.runId)).toBeNull();
  } finally {
    first.close();
    second.close();
  }
});

test('commits watched playoff replay atomically, bounds one replay per run, and rejects unsupported/corrupt reads', async () => {
  resetIndexedDb();
  const { first, second } = openTestDatabasePair('full-court-replay-playoffs');
  try {
    const seasonLock = fullCourtTestSeasonLock();
    const { lock, checkpoint: initialPlayoffs } = fullCourtTestPlayoffLock(seasonLock);
    const playoffRepo = createFullCourtPlayoffRepository(first);
    const replayRepo = createFullCourtWatchedReplayRepository(first);
    await playoffRepo.create(initialPlayoffs);

    let checkpoint = initialPlayoffs;
    while (fullCourtPlayoffView(lock, checkpoint).nextGame?.userSide === null) {
      const step = simulateFullCourtPlayoffGame(lock, checkpoint, createEngineContext(), {
        record: false,
      });
      if (step.kind !== 'simulated') throw new Error('Expected simulated AI playoff game');
      await playoffRepo.commitGame(step.checkpoint);
      checkpoint = step.checkpoint;
    }

    const outcome = simulateFullCourtPlayoffGame(lock, checkpoint, createEngineContext(), {
      record: true,
    });
    if (
      outcome.kind !== 'simulated' ||
      outcome.game.kind !== 'played' ||
      outcome.game.tape === null
    ) {
      throw new Error('Expected simulated recorded playoff game');
    }
    const nextGame = outcome.checkpoint.games.at(-1);
    if (nextGame === undefined) throw new Error('Missing playoff game');
    const userSide = nextGame.homeTeamId === seasonLock.season.userTeamId ? 'home' : 'away';
    const opponentSide = userSide === 'home' ? 'away' : 'home';
    const report = buildFullCourtGameReport({
      kind: 'played',
      gameId: nextGame.gameId,
      userSide,
      result: outcome.game.result,
      tape: outcome.game.tape,
    });
    if (report.status !== 'played') throw new Error('Expected played playoff report');

    const playoffReplay = fullCourtWatchedReplaySchema.parse({
      schemaVersion: FULL_COURT_WATCHED_REPLAY_SCHEMA_VERSION,
      identity: {
        runId: seasonLock.season.runId,
        phase: 'playoff',
        seasonLockDigest: seasonLock.digest,
        lockDigest: lock.digest,
        gameId: nextGame.gameId,
        slot: null,
        dayOffset: nextGame.dayOffset,
        homeTeamId: nextGame.homeTeamId,
        awayTeamId: nextGame.awayTeamId,
        userTeamId: seasonLock.season.userTeamId,
        userSide,
        gameNumber: outcome.game.result.gameNumber,
        gameSeed: outcome.game.result.seed,
      },
      facts: {
        teamPoints: outcome.game.result[userSide].box.points,
        opponentPoints: outcome.game.result[opponentSide].box.points,
        userWon: outcome.game.result.winner === userSide,
        starterPoints: report.bench.starterPoints,
        benchPoints: report.bench.points,
        teamBonusPoints: report.teamBonusPoints,
        benchPlayerCount: report.bench.players.length,
        lineupCount: report.lineupRows.length,
      },
      health: outcome.game.health,
      injuries: outcome.game.injuries,
      result: outcome.game.result,
      tape: outcome.game.tape,
    });

    // Signed live scores survive storage parsing and reload.
    const negativeIndex = playoffReplay.tape.findIndex(
      (event) => event.kind === 'trip' && event.homeScore === 0 && event.awayScore === 0,
    );
    if (negativeIndex < 0) throw new Error('Expected an early scoreless trip');
    const signedTape = playoffReplay.tape.map((event, index) =>
      index === negativeIndex && event.kind === 'trip' ? { ...event, homeScore: -1 } : event,
    );
    const signedReplay = fullCourtWatchedReplaySchema.parse({
      ...playoffReplay,
      tape: signedTape,
    });
    expect(signedReplay.tape[negativeIndex]).toMatchObject({ homeScore: -1 });

    await playoffRepo.commitGame(outcome.checkpoint, { watchedReplay: signedReplay });
    // Idempotent retry succeeds.
    await playoffRepo.commitGame(outcome.checkpoint, { watchedReplay: signedReplay });
    expect(await replayRepo.load(seasonLock.season.runId)).toEqual(signedReplay);
    expect(await first.fullCourtWatchedReplays.count()).toBe(1);
    expect(
      (await replayRepo.load(seasonLock.season.runId))?.tape.some(
        (event) => event.kind === 'trip' && event.homeScore < 0,
      ),
    ).toBe(true);
    const lastTripIndex = signedTape.findLastIndex((event) => event.kind === 'trip');
    const tamperedTape = signedTape.map((event, index) =>
      index === lastTripIndex && event.kind === 'trip'
        ? { ...event, homeScore: event.homeScore + 1 }
        : event,
    );
    expect(() =>
      fullCourtWatchedReplaySchema.parse({ ...signedReplay, tape: tamperedTape }),
    ).toThrow(/tape score/);

    // Unsupported version raises on read without deleting.
    const stored = await first.fullCourtWatchedReplays.get(seasonLock.season.runId);
    if (stored === undefined) throw new Error('Missing stored watched replay');
    await first.table('fullCourtWatchedReplays').put({ ...stored, saveSchemaVersion: 99 });
    const reopenedReplayRepo = createFullCourtWatchedReplayRepository(second);
    await expect(reopenedReplayRepo.load(seasonLock.season.runId)).rejects.toThrow(
      'stored save schema 99',
    );
    expect(await second.fullCourtWatchedReplays.count()).toBe(1);

    // Bounded payload check rejects oversized tapes.
    expect(() =>
      fullCourtWatchedReplaySchema.parse({
        ...playoffReplay,
        tape: Array.from({ length: FULL_COURT_MAX_TAPE_EVENTS + 1 }, () => playoffReplay.tape[0]),
      }),
    ).toThrow();
    expect(() => fullCourtWatchedReplaySchema.parse({ ...playoffReplay, tape: [] })).toThrow();
  } finally {
    first.close();
    second.close();
  }
});
