import { z } from 'zod';
import { franchiseIdSchema, seedSchema } from './ids.js';
import {
  SEASON_GAME_COUNT,
  SEASON_LEAGUE_VERSION,
  SEASON_ROUND_COUNT,
  SEASON_SCHEDULE_FORMULA_VERSION,
  SEASON_SCHEDULE_VERSION,
} from './season-versions.js';

/**
 * The authored Season Run schedule artifact (spec/2.0/02). One immutable
 * schedule for the frozen league: 82 synchronized abstract rounds of 15
 * games, stable game ids, and the committed generation seed so regeneration
 * is byte-identical. No calendar dates and no live-NBA dependency.
 */

export const seasonScheduleGameSchema = z.object({
  /** Stable, globally unique game id, e.g. "s000042". */
  gameId: z.string().regex(/^s[0-9]{6}$/),
  /** Abstract round label 1..82; each round holds 15 games. */
  round: z.number().int().min(1).max(SEASON_ROUND_COUNT),
  homeFranchiseId: franchiseIdSchema,
  awayFranchiseId: franchiseIdSchema,
});
export type SeasonScheduleGame = z.infer<typeof seasonScheduleGameSchema>;

export const seasonScheduleSchema = z.object({
  schemaVersion: z.literal(1),
  scheduleVersion: z.literal(SEASON_SCHEDULE_VERSION),
  formulaVersion: z.literal(SEASON_SCHEDULE_FORMULA_VERSION),
  leagueVersion: z.literal(SEASON_LEAGUE_VERSION),
  /** Authoring seed; regenerating with it reproduces the artifact exactly. */
  generationSeed: seedSchema,
  rounds: z.literal(SEASON_ROUND_COUNT),
  games: z.array(seasonScheduleGameSchema).length(SEASON_GAME_COUNT),
});
export type SeasonSchedule = z.infer<typeof seasonScheduleSchema>;
