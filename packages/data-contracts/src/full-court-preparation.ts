import { z } from 'zod';
import { seedSchema } from './ids.ts';

export const FULL_COURT_PRACTICE_REPORT_SCHEMA_VERSION = 1;

/**
 * One scrimmage sample from Training Camp. It is deliberately compact: the
 * practice game is never saved as a fixture, so only the facts the user needs
 * to revise a rotation survive with the report.
 */
export const fullCourtPracticePlayerSchema = z.object({
  playerId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  kind: z.enum(['roster', 'clone']),
  ownerPlayerId: z.string().min(1).max(64).optional(),
  starter: z.boolean(),
  minutes: z.number().nonnegative(),
  plannedMinutes: z.number().nonnegative(),
  points: z.number().int().nonnegative(),
  stints: z.number().int().nonnegative(),
  energyRemaining: z.number().min(0).max(1),
  fatigueLevel: z.number().int().nonnegative(),
});
export type FullCourtPracticePlayer = z.infer<typeof fullCourtPracticePlayerSchema>;

export const fullCourtPracticeReportSchema = z.object({
  schemaVersion: z.literal(FULL_COURT_PRACTICE_REPORT_SCHEMA_VERSION),
  seed: seedSchema,
  userTeamId: z.string().min(1).max(64),
  userTeamName: z.string().min(1).max(96),
  opponentTeamId: z.string().min(1).max(64),
  opponentTeamName: z.string().min(1).max(96),
  totalSeconds: z.number().nonnegative(),
  overtimePeriods: z.number().int().nonnegative(),
  score: z.object({
    user: z.number().int().nonnegative(),
    opponent: z.number().int().nonnegative(),
  }),
  rotation: z.array(fullCourtPracticePlayerSchema).min(5).max(24),
  bench: z.object({
    playersUsed: z.number().int().nonnegative(),
    minutes: z.number().nonnegative(),
    points: z.number().int().nonnegative(),
  }),
  fatigue: z.object({
    tiredPlayers: z.number().int().nonnegative(),
    lowestEnergy: z.number().min(0).max(1),
  }),
});
export type FullCourtPracticeReport = z.infer<typeof fullCourtPracticeReportSchema>;
