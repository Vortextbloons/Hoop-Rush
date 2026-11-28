import { describe, expect, it } from 'bun:test';
import {
  FULL_COURT_HEALTH_VERSION,
  fullCourtSeasonScoreSchema,
  capRushLeagueGameId,
  type FullCourtSeasonScore,
} from '@hoop-rush/data-contracts';
import { createEngineContext } from '../../sim/kernel.ts';
import { checkFullCourtGameResult, simulateRecordedFullCourtGame } from './game.ts';
import { fullCourtTestInput, fullCourtTestRoster } from './game-test-support.ts';
import {
  buildFullCourtGameLineups,
  buildFullCourtGameReport,
  fullCourtCompletedGameFacts,
} from './report.ts';
import { buildFullCourtSeasonSummary } from './report-season.ts';
import { fullCourtScoreOutcome } from './score.ts';

const ctx = createEngineContext();

function health(teamId: string) {
  return {
    version: FULL_COURT_HEALTH_VERSION as 'full-court-health-v1',
    teamId,
    throughDay: 0,
    players: {},
  };
}

function playedSimulation() {
  const homeRoster = fullCourtTestRoster('signed-home', 8);
  const awayRoster = fullCourtTestRoster('signed-away', 8);
  const { result, tape } = simulateRecordedFullCourtGame(
    fullCourtTestInput({ seed: 'signed-bench-standard', homeRoster, awayRoster }),
    ctx,
  );
  expect(checkFullCourtGameResult(result)).toEqual([]);
  return { result, tape };
}

describe('signed Full Court scoring', () => {
  it('round-trips bench and starter splits through a compact score', () => {
    const { result, tape } = playedSimulation();
    const bench = result.home.players
      .filter((player) => !player.startedGame)
      .reduce((total, player) => total + player.points, 0);

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
    if (outcome.kind !== 'played') throw new Error('expected a played outcome');
    expect(outcome.benchPoints?.home).toBe(bench);
    expect(outcome.homePoints).toBe(result.home.box.points);
    expect(outcome.lineups?.side).toBe('home');
    const score = fullCourtSeasonScoreSchema.parse({
      gameId: 'fc-signed-bench',
      slot: 1,
      homeTeamId: 'home',
      awayTeamId: 'away',
      outcome,
    });
    expect(JSON.parse(JSON.stringify(score))).toEqual(score);
    if (score.outcome.kind !== 'played' || score.outcome.lineups === undefined) {
      throw new Error('expected recorded lineup facts');
    }
    expect(score.outcome.lineups.side).toBe('home');
  });

  it('keeps the recorded tape valid with signed bench facts', () => {
    const { result, tape } = playedSimulation();
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
    // Signed bench facts reach the tape through the per-player deltas the
    // broadcast folds into a live box.
    const deltas = tape.flatMap((event) => (event.kind === 'trip' ? (event.deltas ?? []) : []));
    expect(deltas.length).toBeGreaterThan(0);
    const deltaPoints = new Map<string, number>();
    for (const delta of deltas) {
      deltaPoints.set(
        delta.playerId,
        (deltaPoints.get(delta.playerId) ?? 0) + (delta.line[0] ?? 0),
      );
    }
    const homePoints = result.home.players.reduce(
      (total, player) => total + (deltaPoints.get(player.playerId) ?? 0),
      0,
    );
    expect(homePoints).toBe(result.home.box.points);
    expect(facts.starterPoints + facts.benchPoints + facts.teamBonusPoints).toBe(facts.teamPoints);
  });

  it('keeps signed bench and starter facts valid in the season summary', () => {
    const { result, tape } = playedSimulation();
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
          outcome:
            slot === 1
              ? {
                  kind: 'played',
                  homePoints,
                  awayPoints,
                  benchPoints: { home: facts.benchPoints, away: 0 },
                  benchPlayers: { home: facts.benchPlayerCount, away: 0 },
                  starterPoints: {
                    home: facts.starterPoints,
                    away: report.opponentPoints,
                  },
                }
              : { kind: 'played', homePoints, awayPoints },
        }),
      );
    }
    const summary = buildFullCourtSeasonSummary({
      runId: 'run-signed',
      userTeamId: 'home',
      variant: 'standard',
      regularScores: scores,
      completedGames: [facts],
    });
    expect(summary.bench?.totalBenchPoints).toBe(facts.benchPoints);
    expect(summary.regularSeason.complete).toBe(true);
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
      variant: 'standard',
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
        variant: 'standard',
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
