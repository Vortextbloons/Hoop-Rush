import { z } from 'zod';
import { CAP_RUSH_CONFERENCE_GAMES_PER_TEAM, CAP_RUSH_TAKEOVER_TEAMS } from './cap-rush-league.ts';
import { fullCourtTeamHealthSchema } from './full-court-health.ts';
import { idSchema, seedSchema } from './ids.ts';

export const FULL_COURT_SEASON_SAVE_SCHEMA_VERSION = 1;

export const fullCourtSeasonCheckpointSchema = z
  .object({
    schemaVersion: z.literal(FULL_COURT_SEASON_SAVE_SCHEMA_VERSION),
    runId: idSchema,
    lockDigest: seedSchema,
    completedThroughSlot: z.number().int().min(0).max(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM),
    healthByTeam: z.record(z.string().min(1), fullCourtTeamHealthSchema),
  })
  .refine((checkpoint) => {
    const teams = Object.entries(checkpoint.healthByTeam);
    return (
      teams.length === (checkpoint.completedThroughSlot === 0 ? 0 : CAP_RUSH_TAKEOVER_TEAMS) &&
      teams.every(([teamId, health]) => health.teamId === teamId)
    );
  }, 'Full Court checkpoint health must cover the completed slot');
export type FullCourtSeasonCheckpoint = z.infer<typeof fullCourtSeasonCheckpointSchema>;

const sideSchema = z.enum(['home', 'away']);

export const fullCourtScoreOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('played'),
    homePoints: z.number().int().nonnegative(),
    awayPoints: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('forfeit'),
    losingSides: z
      .array(sideSchema)
      .min(1)
      .max(2)
      .refine((sides) => new Set(sides).size === sides.length),
  }),
]);

export const fullCourtSeasonScoreSchema = z
  .object({
    gameId: z.string().min(1),
    slot: z.number().int().min(1).max(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM),
    homeTeamId: z.string().min(1),
    awayTeamId: z.string().min(1),
    outcome: fullCourtScoreOutcomeSchema,
  })
  .refine(
    (score) =>
      score.homeTeamId !== score.awayTeamId &&
      (score.outcome.kind !== 'played' || score.outcome.homePoints !== score.outcome.awayPoints),
    'Full Court results require distinct teams and a winner in a played game',
  );
export type FullCourtSeasonScore = z.infer<typeof fullCourtSeasonScoreSchema>;
