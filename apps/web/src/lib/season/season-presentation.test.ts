import { describe, expect, it } from 'vitest';
import {
  SEASON_GAME_SUMMARY_VERSION,
  type SeasonGame,
  type SeasonGameSummary,
  type SeasonLeague,
  type SeasonStandings,
} from '@hoop-rush/data-contracts';
import {
  franchiseIdSchema,
  eraIdSchema,
  seasonKeySchema,
  playerIdSchema,
  seasonGameIdSchema,
  idSchema,
} from '@hoop-rush/data-contracts';
import { buildSeasonLeague } from '@hoop-rush/test-fixtures';
import {
  boxScoreFromSummary,
  deriveBlockRecap,
  finalizeGameRecords,
  foldSeasonAggregates,
  franchiseStreak,
  franchiseStreaks,
  humanScheduleRows,
  ordinal,
  provisionalRanking,
  rebaseStandingsBefore,
  recordLabel,
  streakLabel,
  winPct,
} from './season-presentation';
const LEAGUE = buildSeasonLeague({}, { humanFranchiseId: franchiseIdSchema.parse('lakers') });
function playerLine(
  playerVersionId: string,
  points: number,
): SeasonGameSummary['homePlayers'][number] {
  return {
    playerVersionId,
    seconds: 1800,
    points,
    fieldGoalsMade: Math.floor(points / 2),
    fieldGoalsAttempted: Math.floor(points / 2) + 4,
    threePointersMade: 1,
    threePointersAttempted: 3,
    freeThrowsMade: 2,
    freeThrowsAttempted: 2,
    offensiveRebounds: 1,
    defensiveRebounds: 4,
    assists: 3,
    steals: 1,
    blocks: 1,
    turnovers: 2,
    fouls: 2,
  };
}
function summary(
  overrides: Partial<SeasonGameSummary> & {
    gameId: string;
    round: number;
  },
): SeasonGameSummary {
  const homePlayers = Array.from({ length: 10 }, (_, i) =>
    playerLine(`pv-home-${String(i)}`, 10 + i),
  );
  const awayPlayers = Array.from({ length: 10 }, (_, i) =>
    playerLine(`pv-away-${String(i)}`, 8 + i),
  );
  return {
    schemaVersion: 1,
    summaryVersion: SEASON_GAME_SUMMARY_VERSION,
    homeFranchiseId: franchiseIdSchema.parse('lakers'),
    awayFranchiseId: franchiseIdSchema.parse('celtics'),
    status: 'final',
    overtimePeriods: 0,
    homeScore: 110,
    awayScore: 104,
    forfeitLoserFranchiseId: null,
    injuryEvents: [],
    homeBox: {
      franchiseId: franchiseIdSchema.parse('lakers'),
      points: 110,
      fieldGoalsMade: 42,
      fieldGoalsAttempted: 88,
      threePointersMade: 11,
      threePointersAttempted: 30,
      freeThrowsMade: 15,
      freeThrowsAttempted: 19,
      offensiveRebounds: 10,
      defensiveRebounds: 31,
      assists: 25,
      steals: 8,
      blocks: 5,
      turnovers: 13,
      fouls: 18,
      possessions: 95,
    },
    awayBox: {
      franchiseId: franchiseIdSchema.parse('celtics'),
      points: 104,
      fieldGoalsMade: 40,
      fieldGoalsAttempted: 87,
      threePointersMade: 10,
      threePointersAttempted: 29,
      freeThrowsMade: 14,
      freeThrowsAttempted: 18,
      offensiveRebounds: 9,
      defensiveRebounds: 30,
      assists: 23,
      steals: 7,
      blocks: 4,
      turnovers: 15,
      fouls: 20,
      possessions: 93,
    },
    homePlayers,
    awayPlayers,
    ...overrides,
  };
}
function zeroStandings(league: SeasonLeague): SeasonStandings {
  return {
    schemaVersion: 1,
    standingsVersion: 'standings-v1',
    rows: league.teams.map((team) => ({
      franchiseId: team.franchiseId,
      wins: 0,
      losses: 0,
      gamesPlayed: 0,
      homeWins: 0,
      homeLosses: 0,
      awayWins: 0,
      awayLosses: 0,
      conferenceWins: 0,
      conferenceLosses: 0,
      divisionWins: 0,
      divisionLosses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      headToHead: league.teams
        .filter((other) => other.franchiseId !== team.franchiseId)
        .map((other) => ({ franchiseId: other.franchiseId, wins: 0, losses: 0 })),
    })),
  };
}
function standingsRow(
  standings: SeasonStandings,
  franchiseId: string,
): SeasonStandings['rows'][number] {
  const row = standings.rows.find((r) => r.franchiseId === franchiseId);
  if (row === undefined) {
    throw new Error(`fixture standings have no ${franchiseId} row`);
  }
  return row;
}
function teamAggregateOf(
  teams: readonly {
    franchiseId: string;
    wins: number;
    losses: number;
    points: number;
    possessions: number;
  }[],
  franchiseId: string,
) {
  const team = teams.find((t) => t.franchiseId === franchiseId);
  if (team === undefined) {
    throw new Error(`fixture fold has no ${franchiseId} team`);
  }
  return team;
}
describe('formatting helpers', () => {
  it('formats records, streaks, ordinals, and win percentage', () => {
    expect(recordLabel(23, 18)).toBe('23–18');
    expect(streakLabel('wins', 4)).toBe('4 W');
    expect(streakLabel('losses', 3)).toBe('3 L');
    expect(streakLabel('wins', 1)).toBe('—');
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(22)).toBe('22nd');
    expect(winPct(5, 5)).toBeCloseTo(0.5);
    expect(winPct(0, 0)).toBe(0);
  });
});
describe('provisionalRanking', () => {
  it('orders by wins desc, point differential desc, franchiseId asc per conference', () => {
    const standings = zeroStandings(LEAGUE);
    const lakers = standingsRow(standings, 'lakers');
    const warriors = standingsRow(standings, 'warriors');
    const clippers = standingsRow(standings, 'clippers');
    lakers.wins = 10;
    lakers.losses = 0;
    lakers.pointsFor = 1000;
    lakers.pointsAgainst = 900;
    warriors.wins = 10;
    warriors.losses = 0;
    warriors.pointsFor = 1000;
    warriors.pointsAgainst = 950;
    clippers.wins = 9;
    clippers.losses = 1;
    const ranked = provisionalRanking(standings, LEAGUE).filter((e) => e.conference === 'west');
    const order = ranked.map((e) => e.row.franchiseId);
    const lakersId = franchiseIdSchema.parse('lakers');
    const warriorsId = franchiseIdSchema.parse('warriors');
    const clippersId = franchiseIdSchema.parse('clippers');
    expect(order.indexOf(lakersId)).toBeLessThan(order.indexOf(warriorsId));
    expect(order.indexOf(warriorsId)).toBeLessThan(order.indexOf(clippersId));
    const top = ranked[0];
    if (top === undefined) {
      throw new Error('expected west conference rankings');
    }
    expect(top.rank).toBe(1);
  });
});
describe('franchiseStreak', () => {
  it('walks ordered summaries backward for the current streak', () => {
    const summaries = [
      summary({
        gameId: seasonGameIdSchema.parse('s000001'),
        round: 1,
        homeScore: 90,
        awayScore: 100,
      }),
      summary({ gameId: seasonGameIdSchema.parse('s000002'), round: 2 }),
      summary({ gameId: seasonGameIdSchema.parse('s000003'), round: 3 }),
    ];
    expect(franchiseStreak(summaries, 'lakers')).toEqual({ kind: 'wins', length: 2 });
    expect(franchiseStreak(summaries, 'celtics')).toEqual({ kind: 'losses', length: 2 });
  });
  it('returns null without games', () => {
    expect(franchiseStreak([], 'lakers')).toBeNull();
  });
});
describe('franchiseStreaks', () => {
  it('matches franchiseStreak per franchise in one pass', () => {
    const summaries = [
      summary({
        gameId: seasonGameIdSchema.parse('s000001'),
        round: 1,
        homeScore: 90,
        awayScore: 100,
      }),
      summary({ gameId: seasonGameIdSchema.parse('s000002'), round: 2 }),
      summary({ gameId: seasonGameIdSchema.parse('s000003'), round: 3 }),
      summary({
        gameId: seasonGameIdSchema.parse('s000004'),
        round: 4,
        homeScore: 90,
        awayScore: 100,
      }),
    ];
    const franchiseIds = ['lakers', 'celtics', 'warriors', 'not-a-team'];
    const batched = franchiseStreaks(summaries, franchiseIds);
    for (const franchiseId of franchiseIds) {
      expect(batched.get(franchiseId)).toEqual(franchiseStreak(summaries, franchiseId));
    }
  });
  it('handles games out of round order identically to the per-team sort', () => {
    const summaries = [
      summary({ gameId: seasonGameIdSchema.parse('s000003'), round: 3 }),
      summary({
        gameId: seasonGameIdSchema.parse('s000001'),
        round: 1,
        homeScore: 90,
        awayScore: 100,
      }),
      summary({ gameId: seasonGameIdSchema.parse('s000002'), round: 2 }),
    ];
    const batched = franchiseStreaks(summaries, ['lakers', 'celtics']);
    expect(batched.get('lakers')).toEqual(franchiseStreak(summaries, 'lakers'));
    expect(batched.get('celtics')).toEqual(franchiseStreak(summaries, 'celtics'));
  });
  it('returns null for every franchise without summaries', () => {
    const batched = franchiseStreaks([], ['lakers', 'celtics']);
    expect(batched.get('lakers')).toBeNull();
    expect(batched.get('celtics')).toBeNull();
  });
});
describe('foldSeasonAggregates', () => {
  it('folds team and player totals from one summary', () => {
    const { teams, players } = foldSeasonAggregates([
      summary({ gameId: seasonGameIdSchema.parse('s000001'), round: 1 }),
    ]);
    const lakers = teamAggregateOf(teams, 'lakers');
    const celtics = teamAggregateOf(teams, 'celtics');
    expect(lakers.wins).toBe(1);
    expect(celtics.losses).toBe(1);
    expect(lakers.points).toBe(110);
    expect(lakers.possessions).toBe(95);
    expect(players).toHaveLength(20);
    const first = players[0];
    if (first === undefined) {
      throw new Error('expected folded player lines');
    }
    expect(first.gamesPlayed).toBe(1);
  });
  it('counts a forfeit as the official 2-0 record without stats', () => {
    const forfeit = summary({
      gameId: seasonGameIdSchema.parse('s000009'),
      round: 9,
      status: 'forfeit',
      homeScore: 2,
      awayScore: 0,
      forfeitLoserFranchiseId: franchiseIdSchema.parse('lakers'),
      homePlayers: [],
      awayPlayers: [],
    });
    const { teams, players } = foldSeasonAggregates([forfeit]);
    const lakers = teamAggregateOf(teams, 'lakers');
    const celtics = teamAggregateOf(teams, 'celtics');
    expect(lakers.losses).toBe(1);
    expect(celtics.wins).toBe(1);
    expect(lakers.points).toBe(0);
    expect(players).toHaveLength(0);
  });
});
describe('rebaseStandingsBefore', () => {
  it('reverses a block of games back to the prior standings', () => {
    const after = zeroStandings(LEAGUE);
    const lakers = standingsRow(after, 'lakers');
    lakers.wins = 1;
    lakers.gamesPlayed = 1;
    lakers.homeWins = 1;
    lakers.conferenceWins = 1;
    lakers.pointsFor = 110;
    lakers.pointsAgainst = 104;
    const hh = lakers.headToHead.find((h) => h.franchiseId === 'celtics');
    if (hh === undefined) {
      throw new Error('fixture standings lack the celtics head-to-head row');
    }
    hh.wins = 1;
    const celtics = standingsRow(after, 'celtics');
    celtics.losses = 1;
    celtics.gamesPlayed = 1;
    celtics.awayLosses = 1;
    celtics.conferenceLosses = 1;
    celtics.pointsFor = 104;
    celtics.pointsAgainst = 110;
    const before = rebaseStandingsBefore(after, LEAGUE, [
      summary({ gameId: seasonGameIdSchema.parse('s000001'), round: 1 }),
    ]);
    const beforeLakers = standingsRow(before, 'lakers');
    const beforeCeltics = standingsRow(before, 'celtics');
    expect(beforeLakers.wins).toBe(0);
    expect(beforeLakers.gamesPlayed).toBe(0);
    expect(beforeLakers.pointsFor).toBe(0);
    expect(beforeLakers.homeWins).toBe(0);
    expect(beforeCeltics.losses).toBe(0);
    const beforeHh = beforeLakers.headToHead.find((h) => h.franchiseId === 'celtics');
    if (beforeHh === undefined) {
      throw new Error('fixture standings lack the celtics head-to-head row');
    }
    expect(beforeHh.wins).toBe(0);
  });
});
describe('finalizeGameRecords + humanScheduleRows', () => {
  it('merges summary results into scheduled games', () => {
    const scheduled: SeasonGame[] = [
      {
        gameId: seasonGameIdSchema.parse('s000001'),
        round: 1,
        homeFranchiseId: franchiseIdSchema.parse('lakers'),
        awayFranchiseId: franchiseIdSchema.parse('celtics'),
        status: 'scheduled',
        homeScore: null,
        awayScore: null,
        forfeitLoserFranchiseId: null,
      },
    ];
    const merged = finalizeGameRecords(scheduled, [
      summary({ gameId: seasonGameIdSchema.parse('s000001'), round: 1 }),
    ]);
    const game = merged[0];
    if (game === undefined) {
      throw new Error('expected merged game records');
    }
    expect(game.status).toBe('final');
    expect(game.homeScore).toBe(110);
    const rows = humanScheduleRows(merged, 'lakers');
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (row === undefined) {
      throw new Error('expected a human schedule row');
    }
    expect(row.won).toBe(true);
    expect(row.humanScore).toBe(110);
  });
});
describe('boxScoreFromSummary', () => {
  it('derives the human-side box with names and positions', () => {
    const names = new Map([
      ['pv-home-0', 'Home Star'],
      ['pv-away-0', 'Away Star'],
    ]);
    const playable = new Map([
      ['pv-home-0', ['PG']],
      ['pv-away-0', ['SG']],
    ]);
    const box = boxScoreFromSummary(
      summary({ gameId: seasonGameIdSchema.parse('s000001'), round: 1 }),
      'lakers',
      names,
      playable,
    );
    if (box === null) {
      throw new Error('expected a human-side box score');
    }
    expect(box.players).toHaveLength(10);
    const first = box.players[0];
    if (first === undefined) {
      throw new Error('expected box score player lines');
    }
    expect(first.displayName).toBe('Home Star');
    expect(first.position).toBe('PG');
    expect(box.team.points).toBe(110);
    expect(box.won).toBe(true);
  });
  it('returns null for an unrelated franchise', () => {
    const box = boxScoreFromSummary(
      summary({ gameId: seasonGameIdSchema.parse('s000001'), round: 1 }),
      'nuggets',
      new Map(),
      new Map(),
    );
    expect(box).toBeNull();
  });
});
describe('deriveBlockRecap', () => {
  it('derives a recap-shaped presentation from recorded facts', () => {
    const summaries = [
      summary({ gameId: seasonGameIdSchema.parse('s000001'), round: 1 }),
      summary({
        gameId: seasonGameIdSchema.parse('s000002'),
        round: 2,
        awayFranchiseId: franchiseIdSchema.parse('bulls'),
        homeScore: 101,
        awayScore: 105,
      }),
    ];
    const rosters = [
      {
        playerVersionId: 'pv-home-0',
        playerId: playerIdSchema.parse('person-1'),
        franchiseId: franchiseIdSchema.parse('lakers'),
        eraId: eraIdSchema.parse('1990s'),
        seasonKey: seasonKeySchema.parse('1995-96'),
        displayName: 'Home Star',
      },
    ];
    const recap = deriveBlockRecap({
      runId: idSchema.parse('run-1'),
      blockIndex: 0,
      completedRounds: 10,
      standings: zeroStandings(LEAGUE),
      league: LEAGUE,
      blockSummaries: summaries,
      allSummaries: summaries,
      rosters,
      games: [
        {
          gameId: seasonGameIdSchema.parse('s000011'),
          round: 11,
          homeFranchiseId: franchiseIdSchema.parse('lakers'),
          awayFranchiseId: franchiseIdSchema.parse('heat'),
          status: 'scheduled',
          homeScore: null,
          awayScore: null,
          forfeitLoserFranchiseId: null,
        },
      ],
      humanFranchiseId: franchiseIdSchema.parse('lakers'),
      run: {
        health: {
          schemaVersion: 1,
          healthVersion: 'season-health-v2',
          injuries: [],
        },
        influence: {
          schemaVersion: 1,
          influenceVersion: 'season-influence-v2',
          balances: { lakers: 3 },
          ledger: [],
          windows: {},
          rehabs: {},
        },
        transactions: [],
        objectives: {
          schemaVersion: 1,
          objectiveVersion: 'season-objective-v1',
          catalog: [],
          selections: {},
        },
      } as unknown as NonNullable<Parameters<typeof deriveBlockRecap>[0]['run']>,
    });
    expect(recap.runId).toBe('run-1');
    expect(recap.blockIndex).toBe(0);
    expect(recap.humanRecord).not.toBeNull();
    expect(recap.standingsMovement).toHaveLength(30);
    expect(recap.notablePerformances.length).toBeGreaterThan(0);
    expect(recap.upcomingHumanGames.map((g) => g.gameId)).toEqual(['s000011']);
    expect(recap.injuryEvidence.injuries).toBe(0);
    expect(recap.tradeEvidence.tradesAccepted).toBe(0);
    expect(recap.influenceBalance.humanBalance).toBe(3);
  });
});
