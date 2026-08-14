import {
  blockIndexForRound,
  blockRoundRange,
  SEASON_BLOCK_COUNT,
  type SeasonGame,
  type SeasonGameSummary,
} from '@hoop-rush/data-contracts';
import { finalizeGameRecords, humanScheduleRows } from './season-presentation';

export interface ScheduleBlockRow {
  gameId: string;

  game: SeasonGame;

  round: number;

  blockIndex: number;
  opponentFranchiseId: string;
  humanIsHome: boolean;

  played: boolean;

  won: boolean | null;
  humanScore: number | null;
  opponentScore: number | null;
  forfeit: boolean;
}

export interface ScheduleBlockGroup {
  blockIndex: number;
  fromRound: number;
  toRound: number;
  rows: ScheduleBlockRow[];
}

export function scheduleBlockRows(
  games: readonly SeasonGame[],
  summaries: readonly SeasonGameSummary[],
  humanFranchiseId: string,
): ScheduleBlockRow[] {
  return humanScheduleRows(finalizeGameRecords(games, summaries), humanFranchiseId).map((row) => ({
    gameId: row.game.gameId,
    game: row.game,
    round: row.game.round,
    blockIndex: blockIndexForRound(row.game.round),
    opponentFranchiseId: row.opponentFranchiseId,
    humanIsHome: row.humanIsHome,
    played: row.game.status === 'final' || row.game.status === 'forfeit',
    won: row.won,
    humanScore: row.humanScore,
    opponentScore: row.opponentScore,
    forfeit: row.game.status === 'forfeit',
  }));
}

export function scheduleBlockGroups(rows: readonly ScheduleBlockRow[]): ScheduleBlockGroup[] {
  const groups: ScheduleBlockGroup[] = [];
  for (let blockIndex = 0; blockIndex < SEASON_BLOCK_COUNT; blockIndex += 1) {
    const { fromRound, toRound } = blockRoundRange(blockIndex);
    groups.push({
      blockIndex,
      fromRound,
      toRound,
      rows: rows.filter((row) => row.blockIndex === blockIndex),
    });
  }
  return groups;
}

export function playedScheduleCount(rows: readonly ScheduleBlockRow[]): number {
  return rows.reduce((count, row) => (row.played ? count + 1 : count), 0);
}
