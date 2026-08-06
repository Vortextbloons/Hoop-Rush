import { describe, expect, it } from 'vitest';
import {
  SEASON_LEADER_MIN_GAME_SHARE,
  seasonLeadersSchema,
  type SeasonGameSummary,
  type SeasonStandings,
} from '@hoop-rush/data-contracts';
import {
  auditSeasonAggregates,
  deriveSeasonLeaders,
  foldSeasonPlayerAggregates,
  foldSeasonTeamAggregates,
  provisionalStandingOrder,
} from './aggregates.ts';

/** A minimal final summary; box fields must reconcile with player lines. */
function finalSummary(overrides: Partial<SeasonGameSummary> = {}): SeasonGameSummary {
  const homeLine = (
    playerVersionId: string,
    points: number,
  ): SeasonGameSummary['homePlayers'][number] => ({
    playerVersionId,
    seconds: 1440,
    points,
    fieldGoalsMade: points,
    fieldGoalsAttempted: points + 5,
    threePointersMade: 0,
    threePointersAttempted: 1,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    offensiveRebounds: 1,
    defensiveRebounds: 2,
    assists: 1,
    steals: 0,
    blocks: 0,
    turnovers: 1,
    fouls: 2,
  });
  const homePlayers = [
    'pv-h1',
    'pv-h2',
    'pv-h3',
    'pv-h4',
    'pv-h5',
    'pv-h6',
    'pv-h7',
    'pv-h8',
    'pv-h9',
    'pv-h10',
  ].map((id, index) => homeLine(id, 10 + index));
  const awayPlayers = [
    'pv-a1',
    'pv-a2',
    'pv-a3',
    'pv-a4',
    'pv-a5',
    'pv-a6',
    'pv-a7',
    'pv-a8',
    'pv-a9',
    'pv-a10',
  ].map((id, index) => homeLine(id, 8 + index));
  const box = (players: typeof homePlayers): SeasonGameSummary['homeBox'] => {
    const fgm = players.reduce((sum, line) => sum + line.fieldGoalsMade, 0);
    const fga = players.reduce((sum, line) => sum + line.fieldGoalsAttempted, 0);
    return {
      franchiseId: players[0]?.playerVersionId.startsWith('pv-h') ? 'lakers' : 'celtics',
      points: players.reduce((sum, line) => sum + line.points, 0),
      fieldGoalsMade: fgm,
      fieldGoalsAttempted: fga,
      threePointersMade: 0,
      threePointersAttempted: 10,
      freeThrowsMade: 0,
      freeThrowsAttempted: 0,
      offensiveRebounds: players.reduce((sum, line) => sum + line.offensiveRebounds, 0),
      defensiveRebounds: players.reduce((sum, line) => sum + line.defensiveRebounds, 0),
      assists: players.reduce((sum, line) => sum + line.assists, 0),
      steals: 0,
      blocks: 0,
      turnovers: players.reduce((sum, line) => sum + line.turnovers, 0),
      fouls: players.reduce((sum, line) => sum + line.fouls, 0),
      possessions: 100,
    };
  };
  const homeScore = box(homePlayers).points;
  const awayScore = box(awayPlayers).points;
  return {
    schemaVersion: 1,
    summaryVersion: 'season-game-summary-v3',
    gameId: 's000001',
    round: 1,
    homeFranchiseId: 'lakers',
    awayFranchiseId: 'celtics',
    status: 'final',
    overtimePeriods: 0,
    homeScore,
    awayScore,
    forfeitLoserFranchiseId: null,
    homeBox: box(homePlayers),
    awayBox: box(awayPlayers),
    homePlayers,
    awayPlayers,
    injuryEvents: [],
    ...overrides,
  };
}

function forfeitSummary(overrides: Partial<SeasonGameSummary> = {}): SeasonGameSummary {
  return {
    schemaVersion: 1,
    summaryVersion: 'season-game-summary-v3',
    gameId: 's000002',
    round: 1,
    homeFranchiseId: 'celtics',
    awayFranchiseId: 'lakers',
    status: 'forfeit',
    overtimePeriods: 0,
    homeScore: 2,
    awayScore: 0,
    forfeitLoserFranchiseId: 'lakers',
    homeBox: {
      franchiseId: 'celtics',
      points: 0,
      fieldGoalsMade: 0,
      fieldGoalsAttempted: 0,
      threePointersMade: 0,
      threePointersAttempted: 0,
      freeThrowsMade: 0,
      freeThrowsAttempted: 0,
      offensiveRebounds: 0,
      defensiveRebounds: 0,
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 0,
      fouls: 0,
      possessions: 0,
    },
    awayBox: {
      franchiseId: 'lakers',
      points: 0,
      fieldGoalsMade: 0,
      fieldGoalsAttempted: 0,
      threePointersMade: 0,
      threePointersAttempted: 0,
      freeThrowsMade: 0,
      freeThrowsAttempted: 0,
      offensiveRebounds: 0,
      defensiveRebounds: 0,
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 0,
      fouls: 0,
      possessions: 0,
    },
    homePlayers: [],
    awayPlayers: [],
    injuryEvents: [],
    ...overrides,
  };
}

function standingsOf(summaries: readonly SeasonGameSummary[]): SeasonStandings {
  const franchiseIds = ['lakers', 'celtics'];
  return {
    schemaVersion: 1,
    standingsVersion: 'standings-v1',
    rows: franchiseIds.map((franchiseId) => {
      const record = summaries.reduce(
        (acc, summary) => {
          if (summary.homeFranchiseId !== franchiseId && summary.awayFranchiseId !== franchiseId) {
            return acc;
          }
          const won =
            summary.status === 'forfeit'
              ? summary.forfeitLoserFranchiseId !== franchiseId
              : summary.homeFranchiseId === franchiseId
                ? summary.homeScore > summary.awayScore
                : summary.awayScore > summary.homeScore;
          const pointsFor =
            summary.homeFranchiseId === franchiseId ? summary.homeScore : summary.awayScore;
          const pointsAgainst =
            summary.homeFranchiseId === franchiseId ? summary.awayScore : summary.homeScore;
          return {
            wins: acc.wins + (won ? 1 : 0),
            losses: acc.losses + (won ? 0 : 1),
            pointsFor: acc.pointsFor + pointsFor,
            pointsAgainst: acc.pointsAgainst + pointsAgainst,
          };
        },
        { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 },
      );
      return {
        franchiseId,
        wins: record.wins,
        losses: record.losses,
        gamesPlayed: record.wins + record.losses,
        homeWins: 0,
        homeLosses: 0,
        awayWins: 0,
        awayLosses: 0,
        conferenceWins: 0,
        conferenceLosses: 0,
        divisionWins: 0,
        divisionLosses: 0,
        pointsFor: record.pointsFor,
        pointsAgainst: record.pointsAgainst,
        headToHead: franchiseIds
          .filter((other) => other !== franchiseId)
          .map((other) => ({ franchiseId: other, wins: 0, losses: 0 })),
      };
    }),
  };
}

describe('season aggregate folding (M2.3)', () => {
  it('folds team and player aggregates that audit cleanly against standings', () => {
    const first = finalSummary();
    const forfeit = forfeitSummary();
    const summaries = [first, forfeit];
    const teams = foldSeasonTeamAggregates(summaries);
    const players = foldSeasonPlayerAggregates(summaries);
    // One row per franchise, sorted by franchiseId.
    expect(teams.map((team) => team.franchiseId)).toEqual(['celtics', 'lakers']);
    // Lakers: won the final (score), lost the forfeit 0-2; box points count.
    const lakers = teams.find((team) => team.franchiseId === 'lakers');
    const celtics = teams.find((team) => team.franchiseId === 'celtics');
    expect(lakers?.wins).toBe(1);
    expect(lakers?.losses).toBe(1);
    expect(celtics?.wins).toBe(1);
    expect(celtics?.losses).toBe(1);
    // Forfeit boxes are zero, so the forfeit winner's box points stay 0.
    expect(celtics?.points).toBe(first.awayBox.points);
    expect(lakers?.points).toBe(first.homeBox.points);
    // Player rows: 20 distinct, sorted by playerVersionId, ownership derived
    // from the side box.
    expect(players).toHaveLength(20);
    const ids = players.map((player) => player.playerVersionId);
    expect([...ids].sort()).toEqual(ids);
    const lakersPlayer = players.find((player) => player.playerVersionId === 'pv-a1');
    expect(lakersPlayer?.franchiseId).toBe('celtics');
    expect(lakersPlayer?.gamesPlayed).toBe(1);
    // Forfeit games contribute no player rows.
    expect(players.every((player) => player.gamesPlayed === 1)).toBe(true);

    const failures = auditSeasonAggregates({
      teams,
      players,
      summaries,
      standings: standingsOf(summaries),
    });
    expect(failures).toEqual([]);
  });

  it('flags tampered aggregates and standings in the audit', () => {
    const summaries = [finalSummary(), forfeitSummary()];
    const teams = foldSeasonTeamAggregates(summaries);
    const players = foldSeasonPlayerAggregates(summaries);
    const standings = standingsOf(summaries);
    const tamperedTeams = teams.map((team) =>
      team.franchiseId === 'lakers' ? { ...team, wins: team.wins + 1 } : team,
    );
    const failures = auditSeasonAggregates({
      teams: tamperedTeams,
      players,
      summaries,
      standings,
    });
    expect(failures.some((failure) => failure.includes('wins'))).toBe(true);
    const tamperedStandings = {
      ...standings,
      rows: standings.rows.map((row) =>
        row.franchiseId === 'lakers' ? { ...row, pointsFor: row.pointsFor + 5 } : row,
      ),
    };
    const standingsFailures = auditSeasonAggregates({
      teams,
      players,
      summaries,
      standings: tamperedStandings,
    });
    expect(standingsFailures.some((failure) => failure.includes('pointsFor'))).toBe(true);
  });
});

describe('season leaders (M2.3)', () => {
  it('derives leaders with eligibility, depth, and the frozen tie-break', () => {
    // Two players on one team: a high-scorer with few games (ineligible for
    // the 0.7 share) and a lower scorer with enough games (eligible).
    const teams = [
      {
        franchiseId: 'lakers',
        gamesPlayed: 10,
        wins: 5,
        losses: 5,
        points: 1000,
        fieldGoalsMade: 0,
        fieldGoalsAttempted: 0,
        threePointersMade: 0,
        threePointersAttempted: 0,
        freeThrowsMade: 0,
        freeThrowsAttempted: 0,
        offensiveRebounds: 0,
        defensiveRebounds: 0,
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fouls: 0,
        possessions: 0,
      },
    ];
    const players = [
      {
        playerVersionId: 'pv-00000000000000000000000000000001',
        franchiseId: 'lakers',
        gamesPlayed: 5,
        seconds: 0,
        points: 200,
        fieldGoalsMade: 0,
        fieldGoalsAttempted: 0,
        threePointersMade: 30,
        threePointersAttempted: 60,
        freeThrowsMade: 0,
        freeThrowsAttempted: 0,
        offensiveRebounds: 5,
        defensiveRebounds: 5,
        assists: 40,
        steals: 10,
        blocks: 5,
        turnovers: 0,
        fouls: 0,
      },
      {
        playerVersionId: 'pv-00000000000000000000000000000002',
        franchiseId: 'lakers',
        gamesPlayed: 9,
        seconds: 0,
        points: 180,
        fieldGoalsMade: 0,
        fieldGoalsAttempted: 0,
        threePointersMade: 10,
        threePointersAttempted: 30,
        freeThrowsMade: 0,
        freeThrowsAttempted: 0,
        offensiveRebounds: 20,
        defensiveRebounds: 20,
        assists: 30,
        steals: 5,
        blocks: 2,
        turnovers: 0,
        fouls: 0,
      },
    ];
    const leaders = deriveSeasonLeaders(teams, players);
    expect(seasonLeadersSchema.safeParse(leaders).success).toBe(true);
    // The star (5 games < 7) is ineligible for rate categories.
    expect(leaders.categories.points.map((entry) => entry.playerVersionId)).toEqual([
      'pv-00000000000000000000000000000002',
    ]);
    expect(leaders.categories.points[0]?.perGame).toBe(20);
    // The star is still eligible for the raw three-point table? No: same
    // 0.7 share gate applies to every category.
    expect(leaders.categories.threePointersMade.map((entry) => entry.playerVersionId)).toEqual([
      'pv-00000000000000000000000000000002',
    ]);
    // Rebounds combine offensive + defensive.
    expect(leaders.categories.rebounds[0]?.value).toBe(40);
  });

  it('breaks ties by per-game rate, then total, then version id', () => {
    const teams = [
      {
        franchiseId: 'lakers',
        gamesPlayed: 10,
        wins: 5,
        losses: 5,
        points: 0,
        fieldGoalsMade: 0,
        fieldGoalsAttempted: 0,
        threePointersMade: 0,
        threePointersAttempted: 0,
        freeThrowsMade: 0,
        freeThrowsAttempted: 0,
        offensiveRebounds: 0,
        defensiveRebounds: 0,
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fouls: 0,
        possessions: 0,
      },
    ];
    const players = [
      {
        playerVersionId: 'pv-00000000000000000000000000000004',
        franchiseId: 'lakers',
        gamesPlayed: 10,
        seconds: 0,
        points: 100,
        fieldGoalsMade: 0,
        fieldGoalsAttempted: 0,
        threePointersMade: 0,
        threePointersAttempted: 0,
        freeThrowsMade: 0,
        freeThrowsAttempted: 0,
        offensiveRebounds: 0,
        defensiveRebounds: 0,
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fouls: 0,
      },
      {
        playerVersionId: 'pv-00000000000000000000000000000003',
        franchiseId: 'lakers',
        gamesPlayed: 10,
        seconds: 0,
        points: 100,
        fieldGoalsMade: 0,
        fieldGoalsAttempted: 0,
        threePointersMade: 0,
        threePointersAttempted: 0,
        freeThrowsMade: 0,
        freeThrowsAttempted: 0,
        offensiveRebounds: 0,
        defensiveRebounds: 0,
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fouls: 0,
      },
      {
        playerVersionId: 'pv-00000000000000000000000000000005',
        franchiseId: 'lakers',
        gamesPlayed: 10,
        seconds: 0,
        points: 120,
        fieldGoalsMade: 0,
        fieldGoalsAttempted: 0,
        threePointersMade: 0,
        threePointersAttempted: 0,
        freeThrowsMade: 0,
        freeThrowsAttempted: 0,
        offensiveRebounds: 0,
        defensiveRebounds: 0,
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fouls: 0,
      },
    ];
    const leaders = deriveSeasonLeaders(teams, players);
    expect(leaders.categories.points.map((entry) => entry.playerVersionId)).toEqual([
      'pv-00000000000000000000000000000005',
      'pv-00000000000000000000000000000003',
      'pv-00000000000000000000000000000004',
    ]);
    expect(leaders.minimumGameShare).toBe(SEASON_LEADER_MIN_GAME_SHARE);
  });
});

describe('season provisional standing order (M2.3)', () => {
  it('orders by wins, then point differential, then franchise id', () => {
    const standings: SeasonStandings = {
      schemaVersion: 1,
      standingsVersion: 'standings-v1',
      rows: [
        {
          franchiseId: 'b',
          wins: 8,
          losses: 2,
          gamesPlayed: 10,
          homeWins: 0,
          homeLosses: 0,
          awayWins: 0,
          awayLosses: 0,
          conferenceWins: 0,
          conferenceLosses: 0,
          divisionWins: 0,
          divisionLosses: 0,
          pointsFor: 100,
          pointsAgainst: 90,
          headToHead: [],
        },
        {
          franchiseId: 'a',
          wins: 9,
          losses: 1,
          gamesPlayed: 10,
          homeWins: 0,
          homeLosses: 0,
          awayWins: 0,
          awayLosses: 0,
          conferenceWins: 0,
          conferenceLosses: 0,
          divisionWins: 0,
          divisionLosses: 0,
          pointsFor: 100,
          pointsAgainst: 100,
          headToHead: [],
        },
        {
          franchiseId: 'c',
          wins: 9,
          losses: 1,
          gamesPlayed: 10,
          homeWins: 0,
          homeLosses: 0,
          awayWins: 0,
          awayLosses: 0,
          conferenceWins: 0,
          conferenceLosses: 0,
          divisionWins: 0,
          divisionLosses: 0,
          pointsFor: 100,
          pointsAgainst: 80,
          headToHead: [],
        },
      ],
    };
    expect(provisionalStandingOrder(standings)).toEqual(['c', 'a', 'b']);
  });
});
