import { z } from 'zod';
import { CAP_RUSH_TAKEOVER_TEAMS } from './cap-rush-league.ts';
import { CAP_RUSH_PLAYOFF_TEAMS, CAP_RUSH_SERIES_GAMES } from './cap-rush-postseason.ts';
import { fullCourtTeamHealthSchema } from './full-court-health.ts';
import { fullCourtScoreOutcomeSchema } from './full-court-season.ts';
import { idSchema, seedSchema } from './ids.ts';

export const FULL_COURT_PLAYOFFS_VERSION = 1;

export const fullCourtPlayoffAdaptationDefenseSchema = z.enum(['protect-paint', 'pressure']);
export type FullCourtPlayoffAdaptationDefense = z.infer<
  typeof fullCourtPlayoffAdaptationDefenseSchema
>;

export const fullCourtPlayoffAdaptationReasonSchema = z.enum([
  'persistent-inside-scoring',
  'persistent-opportunity-concentration',
]);
export type FullCourtPlayoffAdaptationReason = z.infer<
  typeof fullCourtPlayoffAdaptationReasonSchema
>;

export const fullCourtPlayoffAdaptationSchema = z.object({
  defense: fullCourtPlayoffAdaptationDefenseSchema,
  reason: fullCourtPlayoffAdaptationReasonSchema,
  sampleGames: z.number().int().min(2).max(6),
  windowGames: z.number().int().min(2).max(6),
  observedShareBps: z.number().int().min(0).max(10_000),
  thresholdShareBps: z.number().int().min(0).max(10_000),
});
export type FullCourtPlayoffAdaptation = z.infer<typeof fullCourtPlayoffAdaptationSchema>;

export const fullCourtPlayoffSideEvidenceSchema = z
  .object({
    fieldGoalAttempts: z.number().int().positive(),
    rimAttempts: z.number().int().nonnegative(),
    leadUsageCentis: z.number().int().nonnegative(),
    teamUsageCentis: z.number().int().positive(),
  })
  .refine(
    (side) =>
      side.rimAttempts <= side.fieldGoalAttempts && side.leadUsageCentis <= side.teamUsageCentis,
    'Full Court playoff evidence cannot exceed team totals',
  );
export type FullCourtPlayoffSideEvidence = z.infer<typeof fullCourtPlayoffSideEvidenceSchema>;

export const fullCourtPlayoffEvidenceSchema = z.object({
  home: fullCourtPlayoffSideEvidenceSchema,
  away: fullCourtPlayoffSideEvidenceSchema,
});
export type FullCourtPlayoffEvidence = z.infer<typeof fullCourtPlayoffEvidenceSchema>;

export const fullCourtPlayoffMatchupAdaptationsSchema = z
  .object({
    home: fullCourtPlayoffAdaptationSchema.optional(),
    away: fullCourtPlayoffAdaptationSchema.optional(),
  })
  .refine(
    (adaptations) => adaptations.home !== undefined || adaptations.away !== undefined,
    'Full Court playoff adaptations require at least one adapting side',
  );
export type FullCourtPlayoffMatchupAdaptations = z.infer<
  typeof fullCourtPlayoffMatchupAdaptationsSchema
>;

const fullCourtPlayoffScoreSchema = z
  .object({
    gameId: z.string().regex(/^fcp-[1-4]-[0-7]-[1-7]$/),
    dayOffset: z.number().int().nonnegative(),
    homeTeamId: z.string().min(1),
    awayTeamId: z.string().min(1),
    winnerTeamId: z.string().min(1),
    outcome: fullCourtScoreOutcomeSchema,
    evidence: fullCourtPlayoffEvidenceSchema.optional(),
    adaptations: fullCourtPlayoffMatchupAdaptationsSchema.optional(),
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
  }, 'Full Court playoff winner does not match the game outcome')
  .refine(
    ({ outcome, evidence, adaptations }) =>
      outcome.kind === 'played' || (evidence === undefined && adaptations === undefined),
    'Forfeit playoff games cannot carry played evidence or adaptations',
  );
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
