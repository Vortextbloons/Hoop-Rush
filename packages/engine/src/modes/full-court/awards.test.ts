import { describe, expect, test } from 'bun:test';
import type {
  FullCourtPlayoffScore,
  FullCourtSeasonScore,
  SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { buildSimulationPlayer } from '@hoop-rush/test-fixtures';
import { buildFullCourtAwards, buildFullCourtPlayerSeasonStats } from './awards.ts';
import type { FullCourtStandings } from './standings.ts';

function makePlayer(
  id: string,
  name: string,
  overrides: Partial<SimulationPlayer['ratings']> = {},
): SimulationPlayer {
  const base = buildSimulationPlayer({ playerId: id, displayName: name });
  return {
    ...base,
    ratings: { ...base.ratings, ...overrides },
  };
}

describe('full-court awards and player stats', () => {
  test('aggregates player season stats and picks MVP, DPOY, Sixth Man, Scoring Champ, and Finals MVP', () => {
    const star = makePlayer('p-star', 'Alex Star', {
      perimeterDefense: 75,
      interiorDefense: 70,
    });
    const stopper = makePlayer('p-def', 'Ben Stopper', {
      perimeterDefense: 96,
      interiorDefense: 94,
    });
    const sixth = makePlayer('p-6th', 'Chris Spark');
    const opp = makePlayer('p-opp', 'Dan Rival');

    const teams = [
      {
        teamId: 'team-a',
        displayName: 'Alpha',
        conference: 'east' as const,
        roster: [star, stopper, sixth],
      },
      {
        teamId: 'team-b',
        displayName: 'Beta',
        conference: 'west' as const,
        roster: [opp],
      },
    ];

    const regularScores: FullCourtSeasonScore[] = [1, 2, 3, 4].map((slot) => ({
      gameId: `fc-g-${String(slot)}`,
      slot,
      homeTeamId: 'team-a',
      awayTeamId: 'team-b',
      outcome: {
        kind: 'played',
        homePoints: 112,
        awayPoints: 98,
        playerStats: {
          home: [
            {
              playerId: 'p-star',
              started: true,
              seconds: 2100,
              points: 34,
              rebounds: 9,
              offRebounds: 2,
              defRebounds: 7,
              assists: 8,
              steals: 1,
              blocks: 0,
              turnovers: 2,
              fouls: 2,
              fgm: 12,
              fga: 21,
              tpm: 4,
              tpa: 8,
              ftm: 6,
              fta: 6,
            },
            {
              playerId: 'p-def',
              started: true,
              seconds: 1920,
              points: 12,
              rebounds: 11,
              offRebounds: 2,
              defRebounds: 9,
              assists: 3,
              steals: 3,
              blocks: 4,
              turnovers: 1,
              fouls: 3,
              fgm: 5,
              fga: 10,
              tpm: 0,
              tpa: 1,
              ftm: 2,
              fta: 2,
            },
            {
              playerId: 'p-6th',
              started: false,
              seconds: 1500,
              points: 20,
              rebounds: 4,
              offRebounds: 1,
              defRebounds: 3,
              assists: 4,
              steals: 1,
              blocks: 0,
              turnovers: 1,
              fouls: 2,
              fgm: 7,
              fga: 14,
              tpm: 3,
              tpa: 6,
              ftm: 3,
              fta: 3,
            },
          ],
          away: [
            {
              playerId: 'p-opp',
              started: true,
              seconds: 2160,
              points: 28,
              rebounds: 6,
              offRebounds: 1,
              defRebounds: 5,
              assists: 5,
              steals: 1,
              blocks: 1,
              turnovers: 3,
              fouls: 3,
              fgm: 10,
              fga: 22,
              tpm: 3,
              tpa: 9,
              ftm: 5,
              fta: 6,
            },
          ],
        },
      },
    }));

    const playoffGames: FullCourtPlayoffScore[] = [
      {
        gameId: 'fcp-4-0-1',
        dayOffset: 180,
        homeTeamId: 'team-a',
        awayTeamId: 'team-b',
        winnerTeamId: 'team-a',
        outcome: {
          kind: 'played',
          homePoints: 108,
          awayPoints: 99,
          playerStats: {
            home: [
              {
                playerId: 'p-star',
                started: true,
                seconds: 2200,
                points: 38,
                rebounds: 10,
                offRebounds: 2,
                defRebounds: 8,
                assists: 9,
                steals: 2,
                blocks: 0,
                turnovers: 2,
                fouls: 2,
                fgm: 14,
                fga: 23,
                tpm: 5,
                tpa: 9,
                ftm: 5,
                fta: 5,
              },
            ],
            away: [],
          },
        },
      },
    ];

    const standings: FullCourtStandings = {
      east: [
        {
          teamId: 'team-a',
          displayName: 'Alpha',
          conference: 'east',
          wins: 4,
          losses: 0,
          winPct: 1,
          pointsFor: 448,
          pointsAgainst: 392,
          pointDifferential: 56,
          conferenceWins: 4,
          conferenceLosses: 0,
          seed: 1,
          qualified: true,
        },
      ],
      west: [
        {
          teamId: 'team-b',
          displayName: 'Beta',
          conference: 'west',
          wins: 0,
          losses: 4,
          winPct: 0,
          pointsFor: 392,
          pointsAgainst: 448,
          pointDifferential: -56,
          conferenceWins: 0,
          conferenceLosses: 4,
          seed: 1,
          qualified: true,
        },
      ],
    };
    const stats = buildFullCourtPlayerSeasonStats({ teams, scores: regularScores });
    expect(stats[0]?.playerId).toBe('p-star');
    expect(stats[0]?.ppg).toBe(34);

    const awards = buildFullCourtAwards({
      teams,
      regularScores,
      standings,
      completedSlots: 82,
      playoffGames,
      championTeamId: 'team-a',
    });

    expect(awards.regularComplete).toBe(true);
    expect(awards.hasPlayerStats).toBe(true);
    expect(awards.mvp.winner?.player.playerId).toBe('p-star');
    expect(awards.dpoy.winner?.player.playerId).toBe('p-def');
    expect(awards.sixthMan.winner?.player.playerId).toBe('p-6th');
    expect(awards.scoringChamp.winner?.player.playerId).toBe('p-star');
    expect(awards.finalsMvp.winner?.player.playerId).toBe('p-star');
    expect(awards.leaders.scoring[0]?.playerId).toBe('p-star');
    expect(awards.leaders.blocks[0]?.playerId).toBe('p-def');
  });

  test('keeps a team-leading workload out of the Sixth Man race even when starts are missing', () => {
    const star = makePlayer('p-star', 'Alex Star');
    const heavy = makePlayer('p-heavy', 'Ben Heavy');
    const spark = makePlayer('p-spark', 'Chris Spark');
    const fillers = ['p-fill-1', 'p-fill-2', 'p-fill-3', 'p-fill-4', 'p-fill-5'].map((id) =>
      makePlayer(id, id),
    );

    const teams = [
      {
        teamId: 'team-a',
        displayName: 'Alpha',
        conference: 'east' as const,
        roster: [star, heavy, spark, ...fillers],
      },
    ];
    // A legacy or mis-flagged season: nobody is recorded as a starter.
    const makeLine = (playerId: string, points: number, seconds: number) => ({
      playerId,
      started: false,
      seconds,
      points,
      rebounds: 4,
      offRebounds: 1,
      defRebounds: 3,
      assists: 4,
      steals: 1,
      blocks: 0,
      turnovers: 1,
      fouls: 2,
      fgm: 8,
      fga: 16,
      tpm: 2,
      tpa: 5,
      ftm: 4,
      fta: 4,
    });
    const regularScores: FullCourtSeasonScore[] = [1, 2, 3, 4].map((slot) => ({
      gameId: `fc-g-${String(slot)}`,
      slot,
      homeTeamId: 'team-a',
      awayTeamId: 'team-a',
      outcome: {
        kind: 'played',
        homePoints: 112,
        awayPoints: 98,
        playerStats: {
          home: [
            makeLine('p-star', 32, 2280),
            makeLine('p-heavy', 29, 2220),
            makeLine('p-spark', 18, 1260),
            makeLine('p-fill-1', 9, 900),
            makeLine('p-fill-2', 8, 840),
            makeLine('p-fill-3', 7, 780),
            makeLine('p-fill-4', 6, 720),
            makeLine('p-fill-5', 5, 600),
          ],
          away: [],
        },
      },
    }));
    const standings: FullCourtStandings = {
      east: [
        {
          teamId: 'team-a',
          displayName: 'Alpha',
          conference: 'east',
          division: 'atlantic',
          wins: 4,
          losses: 0,
          pointsFor: 448,
          pointsAgainst: 392,
          pointDifferential: 56,
          conferenceWins: 4,
          conferenceLosses: 0,
          seed: 1,
          qualified: true,
        },
      ],
      west: [],
      qualifiedTeamIds: ['team-a'],
    };

    const awards = buildFullCourtAwards({
      teams,
      regularScores,
      standings,
      completedSlots: 82,
    });

    expect(awards.sixthMan.winner?.player.playerId).toBe('p-spark');
    const ids = awards.sixthMan.finalists.map((candidate) => candidate.player.playerId);
    expect(ids).not.toContain('p-star');
    expect(ids).not.toContain('p-heavy');
  });

  test('handles empty or legacy scores without playerStats gracefully', () => {
    const star = makePlayer('p-star', 'Alex Star');
    const teams = [
      { teamId: 'team-a', displayName: 'Alpha', conference: 'east' as const, roster: [star] },
    ];
    const standings: FullCourtStandings = { west: [], east: [], qualifiedTeamIds: [] };
    const awards = buildFullCourtAwards({
      teams,
      regularScores: [],
      standings,
      completedSlots: 0,
    });
    expect(awards.hasPlayerStats).toBe(false);
    expect(awards.mvp.winner).toBeNull();
    expect(awards.finalsMvp.winner).toBeNull();
  });
});
