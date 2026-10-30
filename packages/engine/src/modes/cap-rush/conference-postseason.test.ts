import { describe, expect, it } from 'bun:test';
import {
  CAP_RUSH_PLAYOFF_ROUNDS,
  CAP_RUSH_SERIES_WINS,
  capRushSeriesComplete,
  capRushSeriesWinner,
  seedSchema,
  type CapRushConferencePostseason,
  type CapRushConferenceSeries,
} from '@hoop-rush/data-contracts';
import { buildCapRushConferenceStandings } from './conference-standings.ts';
import {
  capRushConferenceOpeningSeries,
  capRushRefreshConferencePostseason,
} from './conference-postseason.ts';
import { buildCapRushLeagueSchedule, type CapRushLeagueField } from './league-schedule.ts';
import { CAP_RUSH_FRANCHISE_ALIGNMENT } from '@hoop-rush/data-contracts';

const FIELD: CapRushLeagueField[] = CAP_RUSH_FRANCHISE_ALIGNMENT.map((entry) => ({
  teamId: entry.franchiseId,
  displayName: entry.franchiseId,
}));

function standingsForHomeWins() {
  const schedule = buildCapRushLeagueSchedule({
    runSeed: '9999999999999999' as never,
    field: FIELD,
  });
  return {
    schedule,
    standings: buildCapRushConferenceStandings({
      teams: FIELD.map((team) => ({ ...team, isUserTeam: team.teamId === FIELD[0]?.teamId })),
      games: schedule.games.map((game) => ({
        gameId: game.gameId,
        homeTeamId: game.homeTeamId,
        awayTeamId: game.awayTeamId,
        homePoints: 100,
        awayPoints: 90,
      })),
    }),
  };
}

function seriesGames(series: CapRushConferenceSeries, winnerTeamId: string) {
  return Array.from({ length: 4 }, (_, index) => ({
    gameId: `crp-${String(series.round)}-${String(series.seriesSlot)}-${String(index + 1)}`,
    seriesId: series.seriesId,
    round: series.round,
    seriesSlot: series.seriesSlot,
    gameOrdinal: index + 1,
    seed: seedSchema.parse(String(index + 1).repeat(16)),
    homeTeamId: [1, 2, 5, 7].includes(index + 1) ? series.highTeamId : series.lowTeamId,
    awayTeamId: [1, 2, 5, 7].includes(index + 1) ? series.lowTeamId : series.highTeamId,
    homeSeed: [1, 2, 5, 7].includes(index + 1) ? series.highSeed : series.lowSeed,
    awaySeed: [1, 2, 5, 7].includes(index + 1) ? series.lowSeed : series.highSeed,
    userSide: null,
    homePoints:
      ([1, 2, 5, 7].includes(index + 1) ? series.highTeamId : series.lowTeamId) === winnerTeamId
        ? 110
        : 100,
    awayPoints:
      ([1, 2, 5, 7].includes(index + 1) ? series.highTeamId : series.lowTeamId) === winnerTeamId
        ? 100
        : 110,
    winnerTeamId,
    overtimePeriods: 0,
    inputDigest: '0'.repeat(32),
    resultDigest: '0'.repeat(32),
  }));
}

describe('cap rush conference postseason', () => {
  it('opens with 1–8, 4–5, 3–6 and 2–7 in each conference', () => {
    const { standings } = standingsForHomeWins();
    const opening = capRushConferenceOpeningSeries(standings);
    expect(opening).toHaveLength(8);
    expect(opening.map((entry) => [entry.highSeed, entry.lowSeed])).toEqual([
      [1, 8],
      [4, 5],
      [3, 6],
      [2, 7],
      [1, 8],
      [4, 5],
      [3, 6],
      [2, 7],
    ]);
    expect(opening.slice(0, 4).every((entry) => entry.conference === 'west')).toBe(true);
    expect(opening.slice(4).every((entry) => entry.conference === 'east')).toBe(true);
  });

  it('advances adjacent winners and crowns a Finals champion', () => {
    const { standings } = standingsForHomeWins();
    let postseason: CapRushConferencePostseason = {
      version: 'cap-rush-postseason-v2',
      format: 'conference',
      phase: 'playoffs',
      standings,
      series: capRushConferenceOpeningSeries(standings),
      userOutcome: { status: 'pending', round: null },
      championTeamId: null,
      finalsMvp: null,
      completedAt: null,
    };
    for (let round = 1; round <= CAP_RUSH_PLAYOFF_ROUNDS; round += 1) {
      if (round > 1) {
        postseason = capRushRefreshConferencePostseason({
          postseason,
          userTeamId: FIELD[0]?.teamId ?? '',
        });
      }
      const current = postseason.series.filter((entry) => entry.round === round);
      expect(current).toHaveLength(8 >> (round - 1));
      for (const series of current) {
        const winner = series.highTeamId;
        postseason = capRushRefreshConferencePostseason({
          postseason: {
            ...postseason,
            series: postseason.series.map((entry) =>
              entry.seriesId === series.seriesId
                ? { ...entry, games: seriesGames(entry, winner) }
                : entry,
            ),
          },
          userTeamId: FIELD[0]?.teamId ?? '',
        });
      }
    }
    expect(postseason.series).toHaveLength(15);
    expect(postseason.series.every(capRushSeriesComplete)).toBe(true);
    expect(postseason.championTeamId).not.toBeNull();
    const finals = postseason.series.find(
      (entry) => entry.round === CAP_RUSH_PLAYOFF_ROUNDS && entry.seriesSlot === 0,
    );
    expect(finals).toBeDefined();
    if (finals !== undefined) expect(capRushSeriesWinner(finals)).toBe(postseason.championTeamId);
    expect(CAP_RUSH_SERIES_WINS).toBe(4);
  });
});
