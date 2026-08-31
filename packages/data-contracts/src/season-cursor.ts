import { z } from 'zod';
import {
  SEASON_BLOCK_COUNT,
  SEASON_BLOCK_TEAM_GAMES,
  SEASON_FINAL_BLOCK_TEAM_GAMES,
  SEASON_ROUND_COUNT,
} from './season-versions.ts';
export const seasonCursorSchema = z.object({
  schemaVersion: z.literal(1),
  completedRounds: z.number().int().min(0).max(SEASON_ROUND_COUNT),
});
export type SeasonCursor = z.infer<typeof seasonCursorSchema>;
export const seasonCursorVersionsSchema = z.object({
  blockCount: z.literal(SEASON_BLOCK_COUNT),
  blockTeamGames: z.literal(SEASON_BLOCK_TEAM_GAMES),
  finalBlockTeamGames: z.literal(SEASON_FINAL_BLOCK_TEAM_GAMES),
});
export function blockIndexForRound(round: number): number {
  if (round < 1 || round > SEASON_ROUND_COUNT) {
    throw new Error(`round ${String(round)} out of range 1..${String(SEASON_ROUND_COUNT)}`);
  }
  return Math.min(SEASON_BLOCK_COUNT - 1, Math.floor((round - 1) / SEASON_BLOCK_TEAM_GAMES));
}
export function blockRoundRange(blockIndex: number): {
  fromRound: number;
  toRound: number;
} {
  if (blockIndex < 0 || blockIndex >= SEASON_BLOCK_COUNT) {
    throw new Error(
      `block index ${String(blockIndex)} out of range 0..${String(SEASON_BLOCK_COUNT - 1)}`,
    );
  }
  const fromRound = blockIndex * SEASON_BLOCK_TEAM_GAMES + 1;
  const toRound =
    blockIndex === SEASON_BLOCK_COUNT - 1
      ? SEASON_ROUND_COUNT
      : (blockIndex + 1) * SEASON_BLOCK_TEAM_GAMES;
  return { fromRound, toRound };
}
export function isSeasonComplete(completedRounds: number): boolean {
  return completedRounds >= SEASON_ROUND_COUNT;
}
