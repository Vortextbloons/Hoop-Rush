import { describe, expect, it } from 'vitest';
import {
  SEASON_GAME_SUMMARY_VERSION,
  type SeasonCompactPlayerLine,
  type SeasonGame,
  type SeasonGameSummary,
} from '@hoop-rush/data-contracts';
import {
  playedScheduleCount,
  scheduleBlockGroups,
  scheduleBlockRows,
  type ScheduleBlockRow,
} from './season-schedule-view';

const HUMAN = 'lakers';
const OPPONENT = 'celtics';

function game(
  gameId: string,
  round: number,
  homeFranchiseId: string,
  awayFranchiseId: string,
  status: SeasonGame['status'] = 'scheduled',
  score?: { home: number; away: number },
  forfeitLoserFranchiseId: string | null = null,
): SeasonGame {
  return {
    gameId,
    round,
    homeFranchiseId,
    awayFranchiseId,
    status,
    homeScore: score ? score.home : null,
    awayScore: score ? score.away : null,
    forfeitLoserFranchiseId,
  };
}

function playerLines(prefix: string): SeasonCompactPlayerLine[] {
  return Array.from({ length: 10 }, (_, index) => ({
    playerVersionId: `${prefix}-${String(index + 1)}`,
    seconds: 0,
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
  }));
}

function summary(
  gameId: string,
  round: number,
  homeFranchiseId: string,
  awayFranchiseId: string,
  status: 'final' | 'forfeit',
  homeScore: number,
  awayScore: number,
  forfeitLoserFranchiseId: string | null = null,
): SeasonGameSummary {
  const forfeit = status === 'forfeit';
  return {
    schemaVersion: 1,
    summaryVersion: SEASON_GAME_SUMMARY_VERSION,
    gameId,
    round,
    homeFranchiseId,
    awayFranchiseId,
    status,
    overtimePeriods: 0,
    homeScore,
    awayScore,
    forfeitLoserFranchiseId,
    injuryEvents: [],
    homeBox: {
      franchiseId: homeFranchiseId,
      points: homeScore,
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
      franchiseId: awayFranchiseId,
      points: awayScore,
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
    homePlayers: forfeit ? [] : playerLines(homeFranchiseId),
    awayPlayers: forfeit ? [] : playerLines(awayFranchiseId),
  };
}

const GAMES: SeasonGame[] = [
  game('s000001', 1, HUMAN, OPPONENT, 'final', { home: 110, away: 99 }),
  game('s000002', 2, OPPONENT, HUMAN, 'final', { home: 88, away: 101 }),
  game('s000003', 3, HUMAN, 'hawks', 'forfeit', undefined, HUMAN),
  game('s000004', 10, 'nuggets', HUMAN),
  game('s000005', 11, HUMAN, 'warriors', 'final', { home: 120, away: 121 }),
  game('s000006', 81, 'suns', HUMAN),
  game('s000007', 82, HUMAN, 'spurs', 'final', { home: 105, away: 100 }),

  game('s000008', 1, 'hawks', 'nets'),
];

const SUMMARIES: SeasonGameSummary[] = [
  summary('s000001', 1, HUMAN, OPPONENT, 'final', 110, 99),
  summary('s000002', 2, OPPONENT, HUMAN, 'final', 88, 101),
  summary('s000003', 3, HUMAN, 'hawks', 'forfeit', 0, 2, HUMAN),
  summary('s000005', 11, HUMAN, 'warriors', 'final', 120, 121),
  summary('s000007', 82, HUMAN, 'spurs', 'final', 105, 100),
];

describe('scheduleBlockRows', () => {
  it('joins human games to their round and block, sorted by round', () => {
    const rows = scheduleBlockRows(GAMES, SUMMARIES, HUMAN);
    expect(rows.map((row) => row.round)).toEqual([1, 2, 3, 10, 11, 81, 82]);
    expect(rows.map((row) => row.blockIndex)).toEqual([0, 0, 0, 0, 1, 8, 8]);
    for (const row of rows) {
      expect(row.opponentFranchiseId).not.toBe(HUMAN);
    }
  });

  it('marks home/away and the opponent from the matchup', () => {
    const rows = scheduleBlockRows(GAMES, SUMMARIES, HUMAN);
    const first = rows.find((row) => row.round === 1);
    const second = rows.find((row) => row.round === 2);
    expect(first?.humanIsHome).toBe(true);
    expect(first?.opponentFranchiseId).toBe(OPPONENT);
    expect(second?.humanIsHome).toBe(false);
    expect(second?.opponentFranchiseId).toBe(OPPONENT);
  });

  it('derives W/L, scores, and forfeit state from accepted summaries', () => {
    const rows = scheduleBlockRows(GAMES, SUMMARIES, HUMAN);
    const byRound = new Map(rows.map((row) => [row.round, row]));
    const r1 = byRound.get(1);
    expect(r1?.played).toBe(true);
    expect(r1?.won).toBe(true);
    expect(r1?.humanScore).toBe(110);
    expect(r1?.opponentScore).toBe(99);
    expect(r1?.forfeit).toBe(false);

    const r2 = byRound.get(2);
    expect(r2?.played).toBe(true);
    expect(r2?.won).toBe(true);
    expect(r2?.humanScore).toBe(101);
    expect(r2?.opponentScore).toBe(88);

    const r3 = byRound.get(3);
    expect(r3?.played).toBe(true);
    expect(r3?.won).toBe(false);
    expect(r3?.forfeit).toBe(true);

    const r10 = byRound.get(10);
    expect(r10?.played).toBe(false);
    expect(r10?.won).toBeNull();
    expect(r10?.humanScore).toBeNull();

    const r11 = byRound.get(11);
    expect(r11?.won).toBe(false);
    expect(r11?.humanScore).toBe(120);
    expect(r11?.opponentScore).toBe(121);

    const r81 = byRound.get(81);
    expect(r81?.played).toBe(false);
  });

  it('ignores non-human games entirely', () => {
    const rows = scheduleBlockRows(GAMES, SUMMARIES, HUMAN);
    expect(rows.some((row) => row.opponentFranchiseId === 'nets')).toBe(false);
  });
});

describe('scheduleBlockGroups', () => {
  it('produces nine block sections with the frozen round ranges', () => {
    const groups = scheduleBlockGroups(scheduleBlockRows(GAMES, SUMMARIES, HUMAN));
    expect(groups).toHaveLength(9);
    expect(groups[0]?.fromRound).toBe(1);
    expect(groups[0]?.toRound).toBe(10);
    expect(groups[1]?.fromRound).toBe(11);
    expect(groups[1]?.toRound).toBe(20);
    expect(groups[8]?.fromRound).toBe(81);
    expect(groups[8]?.toRound).toBe(82);
  });

  it('places every row in its own block group', () => {
    const rows = scheduleBlockRows(GAMES, SUMMARIES, HUMAN);
    const groups = scheduleBlockGroups(rows);
    const flat = groups.flatMap((group) => group.rows);
    expect(flat).toHaveLength(rows.length);
    const counts = groups.map((group) => group.rows.length);
    expect(counts).toEqual([4, 1, 0, 0, 0, 0, 0, 0, 2]);
  });
});

describe('playedScheduleCount', () => {
  it('counts only games with a result', () => {
    const rows: ScheduleBlockRow[] = scheduleBlockRows(GAMES, SUMMARIES, HUMAN);
    expect(playedScheduleCount(rows)).toBe(5);
  });
});
