import { describe, expect, it } from 'bun:test';
import type {
  CapRushPlayoffGameSummary,
  CapRushPlayoffSeries,
  CapRushPostseason,
  CapRushPostseasonStandings,
  CapRushStandingsEntry,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_PLAYOFF_TEAMS,
  CAP_RUSH_USER_TEAM_ID,
  capRushPlayoffGameSummarySchema,
  capRushPlayoffSeriesSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import { createEngineContext } from '../../sim/kernel.ts';
import { leagueQuotas } from '../../challenge/league.ts';
import { capRushTestSetup } from './cap-rush-test-support.ts';
import { createCapRushLeagueSimulation } from './league.ts';
import { capRushLeagueSeed } from '@hoop-rush/data-contracts';
import {
  capRushFinalsMvp,
  capRushOpeningSeries,
  capRushPostseasonStep,
  capRushRankStandings,
  capRushRefreshPostseason,
} from './postseason.ts';

function entry(
  seed: number,
  overrides: Partial<CapRushStandingsEntry> = {},
): CapRushStandingsEntry {
  return {
    teamId: overrides.teamId ?? `team-${String(seed).padStart(2, '0')}`,
    displayName: overrides.displayName ?? `Team ${String(seed)}`,
    isUserTeam: overrides.isUserTeam ?? false,
    wins: overrides.wins ?? 82 - seed,
    losses: overrides.losses ?? seed,
    pointsFor: overrides.pointsFor ?? 8000,
    pointsAgainst: overrides.pointsAgainst ?? 7800,
    pointDifferential: overrides.pointDifferential ?? 200,
    seed,
    qualified: seed <= CAP_RUSH_PLAYOFF_TEAMS,
  };
}

function standingsOf(): CapRushPostseasonStandings {
  const entries = Array.from({ length: 31 }, (_, index) => entry(index + 1));
  return {
    entries,
    qualifiedTeamIds: entries.filter((item) => item.qualified).map((item) => item.teamId),
    cutoff: {
      seed: 16,
      teamId: 'team-16',
      wins: 66,
      losses: 16,
      pointDifferential: 200,
      pointsFor: 8000,
      tieBreak: 'wins',
    },
    league: {
      league: {
        leagueVersion: 'league-v1',
        scheduleVersion: 'league-schedule-v1',
        seed: seedSchema.parse('a'.repeat(16)),
        bracketVersion: 'bracket-v1',
        dataVersion: 'data-v1',
        eraProfileVersion: 'profile-v1',
        gamesSimulated: 1189,
        teams: [],
        players: [],
        digest: 'a'.repeat(32),
      },
      points: [],
    },
    tiesAtCutoff: ['team-16'],
  } as unknown as CapRushPostseasonStandings;
}

function gameOf(input: {
  series: CapRushPlayoffSeries;
  ordinal: number;
  winner: 'high' | 'low';
}): CapRushPlayoffGameSummary {
  const { series, ordinal } = input;
  const highHome = [1, 2, 5, 7].includes(ordinal);
  const homeTeamId = highHome ? series.highTeamId : series.lowTeamId;
  const awayTeamId = highHome ? series.lowTeamId : series.highTeamId;
  const winnerTeamId = input.winner === 'high' ? series.highTeamId : series.lowTeamId;
  const finals = series.round === 4;
  return capRushPlayoffGameSummarySchema.parse({
    gameId: `crp-${String(series.round)}-${String(series.seriesSlot)}-${String(ordinal)}`,
    seriesId: series.seriesId,
    round: series.round,
    seriesSlot: series.seriesSlot,
    gameOrdinal: ordinal,
    seed: seedSchema.parse('b'.repeat(16)),
    homeTeamId,
    awayTeamId,
    homeSeed: highHome ? series.highSeed : series.lowSeed,
    awaySeed: highHome ? series.lowSeed : series.highSeed,
    userSide:
      homeTeamId === CAP_RUSH_USER_TEAM_ID
        ? 'home'
        : awayTeamId === CAP_RUSH_USER_TEAM_ID
          ? 'away'
          : null,
    homePoints: winnerTeamId === homeTeamId ? 100 : 95,
    awayPoints: winnerTeamId === awayTeamId ? 100 : 95,
    winnerTeamId,
    overtimePeriods: 0,
    inputDigest: 'c'.repeat(32),
    resultDigest: 'd'.repeat(32),
    ...(finals
      ? {
          finalsLines: [series.highTeamId, series.lowTeamId].flatMap((teamId) =>
            ['PG', 'SG', 'SF', 'PF', 'C'].map((slot, index) => ({
              teamId,
              slot,
              playerId: `${teamId}-p${String(index)}`,
              displayName: `${teamId} ${slot}`,
              kind: 'starter' as const,
              minutes: 36,
              points: 20 + index,
              rebounds: 6,
              offensiveRebounds: 2,
              defensiveRebounds: 4,
              assists: 4,
              steals: 1,
              blocks: 0,
              turnovers: 2,
              fouls: 2,
              fieldGoalsMade: 8,
              fieldGoalsAttempted: 16,
              freeThrowsMade: 3,
              freeThrowsAttempted: 4,
              threesMade: 1,
              threesAttempted: 4,
              adjustments: 0,
            })),
          ),
        }
      : {}),
  });
}

function postseasonOf(series: CapRushPlayoffSeries[]): CapRushPostseason {
  return {
    version: 'cap-rush-postseason-v1',
    phase: 'playoffs',
    standings: standingsOf(),
    series,
    userOutcome: { status: 'pending', round: null },
    championTeamId: null,
    finalsMvp: null,
    completedAt: null,
  };
}

function completedSeries(
  series: CapRushPlayoffSeries,
  winner: 'high' | 'low',
): CapRushPlayoffSeries {
  const games = [1, 2, 3, 4].map((ordinal) => gameOf({ series, ordinal, winner }));
  return capRushPlayoffSeriesSchema.parse({ ...series, games });
}

describe('cap rush postseason', () => {
  it('orders ties by wins, differential, points and stable team id', () => {
    const ranked = capRushRankStandings([
      {
        teamId: 'b',
        displayName: 'B',
        isUserTeam: false,
        wins: 50,
        losses: 32,
        pointsFor: 8000,
        pointsAgainst: 7900,
      },
      {
        teamId: 'a',
        displayName: 'A',
        isUserTeam: false,
        wins: 50,
        losses: 32,
        pointsFor: 8000,
        pointsAgainst: 7900,
      },
      {
        teamId: 'c',
        displayName: 'C',
        isUserTeam: false,
        wins: 51,
        losses: 31,
        pointsFor: 7000,
        pointsAgainst: 7000,
      },
      {
        teamId: 'd',
        displayName: 'D',
        isUserTeam: false,
        wins: 50,
        losses: 32,
        pointsFor: 8100,
        pointsAgainst: 8000,
      },
    ]);
    expect(ranked.map((item) => item.teamId)).toEqual(['c', 'd', 'a', 'b']);
  });

  it('creates the confirmed opening bracket order', () => {
    const series = capRushOpeningSeries(standingsOf());
    expect(series.map((item) => [item.highSeed, item.lowSeed])).toEqual([
      [1, 16],
      [8, 9],
      [4, 13],
      [5, 12],
      [2, 15],
      [7, 10],
      [3, 14],
      [6, 11],
    ]);
  });

  it('advances adjacent winners and keeps the higher seed at home', () => {
    const opening = capRushOpeningSeries(standingsOf()).map((series, index) =>
      completedSeries(series, index % 2 === 0 ? 'high' : 'low'),
    );
    const advanced = capRushRefreshPostseason({
      postseason: postseasonOf(opening),
    });
    const quarterfinals = advanced.series.filter((series) => series.round === 2);
    expect(quarterfinals).toHaveLength(4);
    expect(quarterfinals[0]?.highSeed).toBe(1);
    expect(quarterfinals[0]?.lowSeed).toBe(9);
    const plan = capRushPostseasonStep({
      postseason: advanced,
      runSeed: seedSchema.parse('e'.repeat(16)),
    });
    if (plan.kind !== 'games') throw new Error('expected playoff games');
    for (const game of plan.games) {
      const series = advanced.series.find((entry) => entry.seriesId === game.seriesId);
      if (series === undefined) throw new Error('missing series');
      if (game.gameOrdinal <= 2 || game.gameOrdinal === 5 || game.gameOrdinal === 7) {
        expect(game.homeTeamId).toBe(series.highTeamId);
      } else {
        expect(game.homeTeamId).toBe(series.lowTeamId);
      }
    }
  });

  it('computes Finals MVP from the champions Finals lines only', () => {
    const opening = capRushOpeningSeries(standingsOf());
    const finals = opening[0];
    if (finals === undefined) throw new Error('missing opening series');
    const finalsSeries = capRushPlayoffSeriesSchema.parse({
      ...finals,
      round: 4,
      seriesId: 'crs-4-0',
      seriesSlot: 0,
      highSeed: 1,
      lowSeed: 2,
      highTeamId: 'team-01',
      lowTeamId: 'team-02',
      games: [1, 2, 3, 4].map((ordinal) =>
        gameOf({
          series: {
            ...finals,
            round: 4,
            seriesId: 'crs-4-0',
            seriesSlot: 0,
            highSeed: 1,
            lowSeed: 2,
            highTeamId: 'team-01',
            lowTeamId: 'team-02',
            games: [],
          },
          ordinal,
          winner: 'high',
        }),
      ),
    });
    const withReplacement = capRushPlayoffSeriesSchema.parse({
      ...finalsSeries,
      games: finalsSeries.games.map((game) => {
        const starter = game.finalsLines?.find(
          (line) => line.teamId === 'team-01' && line.slot === 'C',
        );
        if (starter === undefined) throw new Error('missing champion center');
        return {
          ...game,
          finalsLines: [
            ...(game.finalsLines ?? []),
            { ...starter, kind: 'replacement' as const, points: 50 },
          ],
        };
      }),
    });
    const postseason: CapRushPostseason = {
      ...postseasonOf([withReplacement]),
      championTeamId: 'team-01',
    };
    const mvp = capRushFinalsMvp(postseason);
    expect(mvp).not.toBeNull();
    expect(mvp?.teamId).toBe('team-01');
    expect(mvp?.games).toBe(4);
    expect(mvp?.totalPoints).toBe(296);
    expect(mvp?.displayName).toBe('team-01 C');
  });

  it('finishes every opponent with exactly its remaining league games', () => {
    const setup = capRushTestSetup();
    const league = createCapRushLeagueSimulation(
      {
        seed: capRushLeagueSeed(setup.state.runSeed),
        bracket: setup.lockSources.bracket,
        profile: setup.lockSources.profile,
      },
      createEngineContext(),
    );
    league.advance(league.gamesTotal);
    const result = league.finish();
    const quotas = leagueQuotas(setup.lockSources.bracket);
    result.league.teams.forEach((record, index) => {
      expect(record.gamesPlayed).toBe(quotas[index] ?? -1);
      expect(record.wins + record.losses).toBe(record.gamesPlayed);
    });
    expect(result.league.gamesSimulated).toBe(1189);
  }, 120_000);

  it('rejects a series with a fifth win', () => {
    const opening = capRushOpeningSeries(standingsOf());
    const first = opening[0];
    if (first === undefined) throw new Error('missing series');
    const games = [1, 2, 3, 4, 5].map((ordinal) =>
      gameOf({ series: first, ordinal, winner: 'high' }),
    );
    expect(() => capRushPlayoffSeriesSchema.parse({ ...first, games })).toThrow();
  });
});
