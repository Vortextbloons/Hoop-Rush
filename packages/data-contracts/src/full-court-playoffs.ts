import { z } from 'zod';
import { CAP_RUSH_TAKEOVER_TEAMS } from './cap-rush-league.ts';
import { CAP_RUSH_PLAYOFF_TEAMS, CAP_RUSH_SERIES_GAMES } from './cap-rush-postseason.ts';
import { fullCourtTeamHealthSchema } from './full-court-health.ts';
import { fullCourtScoreOutcomeSchema } from './full-court-season.ts';
import { idSchema, seedSchema } from './ids.ts';

export const FULL_COURT_PLAYOFFS_VERSION = 1;

const fullCourtPlayoffScoreSchema = z
  .object({
    gameId: z.string().regex(/^fcp-[1-4]-[0-7]-[1-7]$/),
    dayOffset: z.number().int().nonnegative(),
    homeTeamId: z.string().min(1),
    awayTeamId: z.string().min(1),
    winnerTeamId: z.string().min(1),
    outcome: fullCourtScoreOutcomeSchema,
  })
  .refine(({ homeTeamId, awayTeamId, winnerTeamId, outcome }) => {
    if (homeTeamId === awayTeamId || (winnerTeamId !== homeTeamId && winnerTeamId !== awayTeamId))
      return false;
    if (outcome.kind === 'played') {
      return (
        outcome.homePoints !== outcome.awayPoints &&
        winnerTeamId === (outcome.homePoints > outcome.awayPoints ? homeTeamId : awayTeamId)
      );
    }
    return (
      outcome.losingSides.length === 2 ||
      winnerTeamId === (outcome.losingSides[0] === 'home' ? awayTeamId : homeTeamId)
    );
  }, 'Full Court playoff winner does not match the game outcome');
export type FullCourtPlayoffScore = z.infer<typeof fullCourtPlayoffScoreSchema>;

export const fullCourtPlayoffCheckpointSchema = z
  .object({
    schemaVersion: z.literal(FULL_COURT_PLAYOFFS_VERSION),
    runId: idSchema,
    lockDigest: seedSchema,
    games: z
      .array(fullCourtPlayoffScoreSchema)
      .max((CAP_RUSH_PLAYOFF_TEAMS - 1) * CAP_RUSH_SERIES_GAMES),
    healthByTeam: z.record(z.string().min(1), fullCourtTeamHealthSchema),
  })
  .refine((checkpoint) => {
    const rows = Object.entries(checkpoint.healthByTeam);
    return rows.length === CAP_RUSH_TAKEOVER_TEAMS && rows.every(([id, row]) => row.teamId === id);
  }, 'Full Court playoffs require one health row per team');
export type FullCourtPlayoffCheckpoint = z.infer<typeof fullCourtPlayoffCheckpointSchema>;
