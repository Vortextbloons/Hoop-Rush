import { describe, expect, it } from 'bun:test';
import {
  FULL_COURT_HEALTH_VERSION,
  FULL_COURT_WATCHED_REPLAY_SCHEMA_VERSION,
  fullCourtSeasonScoreSchema,
  fullCourtWatchedReplaySchema,
  idSchema,
  seedSchema,
  capRushLeagueGameId,
  type FullCourtSeasonScore,
  type HavocMutationEntry,
  type HavocMutationId,
  type Position,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { buildSimulationPlayer } from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../../sim/kernel.ts';
import { createRng } from '../../sim/rng.ts';
import { HAVOC_MUTATION_DEFINITIONS } from '../havoc/mutations.ts';
import { materializeHavocBundle } from '../havoc/offers.ts';
import { applyHavocMutationPackage } from '../havoc/transform.ts';
import { checkFullCourtGameResult, simulateRecordedFullCourtGame } from './game.ts';
import { fullCourtTestInput, fullCourtTestRoster } from './game-test-support.ts';
import {
  buildFullCourtGameLineups,
  buildFullCourtGameReport,
  fullCourtCompletedGameFacts,
} from './report.ts';
import { buildFullCourtSeasonSummary } from './report-season.ts';
import { adaptCapRushSpinsToFullCourt, type FullCourtRouletteSpinReceiptLike } from './roulette.ts';
import { fullCourtScoreOutcome } from './score.ts';

const ctx = createEngineContext();
const DEFINITIONS_BY_ID = new Map(
  HAVOC_MUTATION_DEFINITIONS.map((definition) => [definition.mutationId, definition]),
);

function rouletteEntryFor(mutationId: HavocMutationId, seedTag: string): HavocMutationEntry {
  const definition = DEFINITIONS_BY_ID.get(mutationId);
  if (definition === undefined) throw new Error(`missing definition for ${mutationId}`);
  const [entry] = materializeHavocBundle(
    { tier: definition.tier, mutationIds: [mutationId] },
    createRng(`${seedTag}:phys:${mutationId}`),
    createRng(`${seedTag}:spec:${mutationId}`),
    HAVOC_MUTATION_DEFINITIONS,
  );
  if (entry === undefined) throw new Error(`failed to materialize ${mutationId}`);
  return entry;
}

function rouletteReceiptFor(
  player: SimulationPlayer,
  slot: Position,
  entries: readonly HavocMutationEntry[],
): FullCourtRouletteSpinReceiptLike {
  if (player.playerVersionId === undefined) {
    throw new Error(`player ${player.playerId} requires playerVersionId`);
  }
  const sourcePlayer = buildSimulationPlayer({ ...player });
  const effective = applyHavocMutationPackage(
    {
      playerId: sourcePlayer.playerId,
      playerVersionId: sourcePlayer.playerVersionId ?? null,
      displayName: sourcePlayer.displayName,
      franchiseId: null,
      eraId: null,
      seasonKey: null,
      positions: [...sourcePlayer.positions],
      originalOverall: sourcePlayer.overall ?? 75,
      overallSource: 'catalog',
      profile: {
        ratings: sourcePlayer.ratings,
        tendencies: sourcePlayer.tendencies,
        ...(sourcePlayer.anchors === undefined ? {} : { anchors: sourcePlayer.anchors }),
      },
      physical: {
        heightInches: sourcePlayer.heightInches,
        weightLbs: sourcePlayer.weightLbs,
      },
    },
    [...entries],
    { slot },
  );
  const [head, ...rest] = entries;
  if (head === undefined) throw new Error('expected at least one entry');
  return {
    target: { slot, playerVersionId: player.playerVersionId, playerId: player.playerId },
    entry: head,
    ...(rest.length > 0 ? { additionalEntries: rest } : {}),
    effective,
  };
}

function health(teamId: string) {
  return {
    version: FULL_COURT_HEALTH_VERSION as 'full-court-health-v1',
    teamId,
    throughDay: 0,
    players: {},
  };
}

function signedSimulation() {
  const homeRoster = fullCourtTestRoster('neg-home', 6, (index) => ({
    rating: index === 5 ? 25 : 70 + (index % 4),
    ...(index === 5 ? { usageRate: 0.32 } : {}),
  }));
  const awayRoster = fullCourtTestRoster('neg-away', 8, (index) => ({ rating: 71 + (index % 3) }));
  const receipts = homeRoster.map((player, slotIndex) =>
    rouletteReceiptFor(player, (['PG', 'SG', 'SF', 'PF', 'C', 'PG'] as const)[slotIndex] ?? 'PG', [
      rouletteEntryFor('buzzer-bandit', `neg-97-${String(slotIndex)}`),
    ]),
  );
  const minuteTargets = Object.fromEntries(
    homeRoster.map((player, index) => [player.playerId, index < 5 ? 38 : 48]),
  );
  const base = fullCourtTestInput({
    seed: 'negative-bench-97',
    homeRoster,
    awayRoster,
    homeRotation: { minuteTargets },
  });
  const { result, tape } = simulateRecordedFullCourtGame(
    {
      ...base,
      home: {
        ...base.home,
        roulette: adaptCapRushSpinsToFullCourt({ roster: homeRoster, receipts }),
      },
    },
    ctx,
  );
  expect(checkFullCourtGameResult(result)).toEqual([]);
  return { result, tape };
}

describe('signed Full Court scoring', () => {
  it('round-trips an actually simulated deducted bench total through a compact score', () => {
    const { result, tape } = signedSimulation();
    const bench = result.home.players
      .filter((player) => !player.startedGame)
      .reduce((total, player) => total + player.points, 0);
    expect(bench).toBe(-2);

    const lineups = buildFullCourtGameLineups({
      kind: 'played',
      gameId: 'fc-signed-bench',
      userSide: 'home',
      result,
      tape,
    });
    expect(lineups.lineups.reduce((total, row) => total + row.pointsFor, 0)).toBe(
      result.home.box.points,
    );
    expect(lineups.lineups.reduce((total, row) => total + row.pointsAgainst, 0)).toBe(
      result.away.box.points,
    );
    const outcome = fullCourtScoreOutcome(
      {
        kind: 'played',
        result,
        tape,
        health: { home: health('home'), away: health('away') },
        injuries: [],
      },
      true,
      lineups,
    );
    expect(outcome).toMatchObject({
      kind: 'played',
      benchPoints: { home: -2 },
      starterPoints: { home: result.home.box.points + 2 },
      lineups: { side: 'home', version: 1 },
    });
    const score = fullCourtSeasonScoreSchema.parse({
      gameId: 'fc-signed-bench',
      slot: 1,
      homeTeamId: 'home',
      awayTeamId: 'away',
      outcome,
    });
    expect(JSON.parse(JSON.stringify(score))).toEqual(score);
    expect(score.outcome).toMatchObject({ benchPoints: { home: -2 } });
    if (score.outcome.kind !== 'played' || score.outcome.lineups === undefined) {
      throw new Error('expected recorded lineup facts');
    }
    expect(score.outcome.lineups.side).toBe('home');
  });

  it('keeps a signed watched replay valid with negative player and period points', () => {
    const { result, tape } = signedSimulation();
    const gameId = capRushLeagueGameId(1, 'home', 'away');
    const report = buildFullCourtGameReport({
      kind: 'played',
      gameId,
      userSide: 'home',
      result,
      tape,
    });
    if (report.status !== 'played') throw new Error('expected a played report');
    const facts = fullCourtCompletedGameFacts(report);
    if (facts === null) throw new Error('expected completed-game facts');
    const digest = seedSchema.parse('a'.repeat(32));
    const replay = fullCourtWatchedReplaySchema.parse({
      schemaVersion: FULL_COURT_WATCHED_REPLAY_SCHEMA_VERSION,
      identity: {
        runId: idSchema.parse('replay-run'),
        phase: 'regular',
        seasonLockDigest: digest,
        lockDigest: digest,
        gameId,
        slot: 1,
        dayOffset: 0,
        homeTeamId: 'home',
        awayTeamId: 'away',
        userTeamId: 'home',
        userSide: 'home',
        gameNumber: result.gameNumber,
        gameSeed: result.seed,
      },
      facts: {
        teamPoints: facts.teamPoints,
        opponentPoints: report.opponentPoints,
        userWon: report.userWon,
        starterPoints: facts.starterPoints,
        benchPoints: facts.benchPoints,
        teamBonusPoints: facts.teamBonusPoints,
        benchPlayerCount: facts.benchPlayerCount,
        lineupCount: report.lineupRows.length,
      },
      health: { home: health('home'), away: health('away') },
      injuries: [],
      result,
      tape,
    });
    expect(replay.result.home.players.some((player) => player.points < 0)).toBe(true);
    expect(replay.facts.benchPoints).toBe(-2);
  });

  it('keeps signed bench and starter facts valid in the season summary', () => {
    const { result, tape } = signedSimulation();
    const report = buildFullCourtGameReport({
      kind: 'played',
      gameId: 'fc-1',
      userSide: 'home',
      result,
      tape,
    });
    if (report.status !== 'played') throw new Error('expected a played report');
    const facts = fullCourtCompletedGameFacts(report);
    if (facts === null) throw new Error('expected completed-game facts');
    expect(facts.benchPoints).toBe(-2);

    const scores: FullCourtSeasonScore[] = [];
    for (let slot = 1; slot <= 82; slot += 1) {
      const userHome = slot === 1 ? true : slot % 2 === 0;
      const userPoints = slot === 1 ? report.userPoints : 100;
      const opponentPoints = slot === 1 ? report.opponentPoints : 90;
      const homePoints = userHome ? userPoints : opponentPoints;
      const awayPoints = userHome ? opponentPoints : userPoints;
      scores.push(
        fullCourtSeasonScoreSchema.parse({
          gameId: slot === 1 ? 'fc-1' : `fc-${String(slot)}`,
          slot,
          homeTeamId: userHome ? 'home' : `opp-${String(slot)}`,
          awayTeamId: userHome ? `opp-${String(slot)}` : 'home',
          outcome: {
            kind: 'played',
            homePoints,
            awayPoints,
            ...(slot === 1
              ? {
                  benchPoints: { home: -2, away: 0 },
                  benchPlayers: { home: 1, away: 0 },
                  starterPoints: { home: result.home.box.points + 2, away: report.opponentPoints },
                }
              : {}),
          },
        }),
      );
    }
    const summary = buildFullCourtSeasonSummary({
      runId: 'run-signed',
      userTeamId: 'home',
      variant: 'roulette',
      regularScores: scores,
      completedGames: [facts],
    });
    expect(summary.bench).toMatchObject({
      gamesRecorded: 1,
      totalBenchPoints: -2,
      averageBenchPoints: -2,
      bestGame: { gameId: 'fc-1', benchPoints: -2 },
    });
    expect(summary.regularSeason.complete).toBe(true);

    expect(() =>
      buildFullCourtSeasonSummary({
        runId: 'run-signed',
        userTeamId: 'home',
        variant: 'roulette',
        regularScores: scores,
        completedGames: [{ ...facts, benchPoints: -3 }],
      }),
    ).toThrow(/do not sum to team points/);
  });

  it('accepts negative starter facts whose bench plus bonus exceeds team points', () => {
    const scores: FullCourtSeasonScore[] = [];
    for (let slot = 1; slot <= 82; slot += 1) {
      scores.push(
        fullCourtSeasonScoreSchema.parse({
          gameId: `fc-${String(slot)}`,
          slot,
          homeTeamId: 'user',
          awayTeamId: `opp-${String(slot)}`,
          outcome:
            slot === 1
              ? {
                  kind: 'played',
                  homePoints: 85,
                  awayPoints: 90,
                  benchPoints: { home: 90, away: 0 },
                  benchPlayers: { home: 4, away: 0 },
                  starterPoints: { home: -5, away: 90 },
                }
              : { kind: 'played', homePoints: 100, awayPoints: 90 },
        }),
      );
    }
    const summary = buildFullCourtSeasonSummary({
      runId: 'run-negative-starter',
      userTeamId: 'user',
      variant: 'roulette',
      regularScores: scores,
      completedGames: [
        {
          gameId: 'fc-1',
          gameNumber: 1,
          teamPoints: 85,
          starterPoints: -5,
          benchPoints: 90,
          teamBonusPoints: 0,
          benchPlayerCount: 4,
        },
      ],
    });
    expect(summary.bench?.totalBenchPoints).toBe(90);
    expect(summary.bench?.bestGame?.benchPoints).toBe(90);

    expect(() =>
      buildFullCourtSeasonSummary({
        runId: 'run-negative-starter',
        userTeamId: 'user',
        variant: 'roulette',
        regularScores: scores,
        completedGames: [
          {
            gameId: 'fc-1',
            gameNumber: 1,
            teamPoints: 85,
            starterPoints: -5,
            benchPoints: 90,
            teamBonusPoints: 0,
            benchPlayerCount: 0,
          },
        ],
      }),
    ).toThrow(/no bench player/);
  });
});
