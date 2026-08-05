import {
  blockIndexForRound,
  blockRoundRange,
  SEASON_BLOCK_COUNT,
  type SeasonGame,
  type SeasonGameSummary,
} from '@hoop-rush/data-contracts';
import { finalizeGameRecords, humanScheduleRows } from './season-presentation';

/**
 * Schedule tab view model (M2.3.5): the human team's games joined to their
 * round and block index, with result state from accepted summaries. The
 * frozen `humanScheduleRows` helper carries no block info, so this module
 * re-derives the rows with block boundaries (`blockIndexForRound`) and groups
 * them into the nine block sections the Schedule tab renders. Every fact
 * (opponent, home/away, W/L, score, forfeit) derives from recorded games and
 * summaries — the UI never invents a result.
 */

/** One human-team game as the Schedule tab renders it. */
export interface ScheduleBlockRow {
  gameId: string;
  /** Finalized game record (status/scores merged from summaries). */
  game: SeasonGame;
  /** 1-based round. */
  round: number;
  /** 0-based block index (0..8). */
  blockIndex: number;
  opponentFranchiseId: string;
  humanIsHome: boolean;
  /** True once the game carries a result (final or forfeit). */
  played: boolean;
  /** Null while scheduled; otherwise the human W/L result. */
  won: boolean | null;
  humanScore: number | null;
  opponentScore: number | null;
  forfeit: boolean;
}

/** One of the nine block sections, in round order. */
export interface ScheduleBlockGroup {
  blockIndex: number;
  fromRound: number;
  toRound: number;
  rows: ScheduleBlockRow[];
}

/**
 * Joins the human team's games to their round and block, sorting by round.
 * Result state comes from the accepted summaries via `finalizeGameRecords`
 * (the same mirror the hub uses), so W/L, scores, and forfeits always agree
 * with the committed checkpoint.
 */
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

/** Groups rows into the nine block sections with their round ranges. */
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

/** Played-game count of the human team (for filter labels). */
export function playedScheduleCount(rows: readonly ScheduleBlockRow[]): number {
  return rows.reduce((count, row) => (row.played ? count + 1 : count), 0);
}
