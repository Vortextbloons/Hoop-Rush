import { z } from 'zod';
import { franchiseIdSchema, seasonGameIdSchema } from './ids.ts';
import { postseasonGameIdSchema } from './season-postseason.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_HEALTH_VERSION } from './season-versions.ts';

export const SEASON_ENDING_MISSED_GAMES_SENTINEL = 10_000;

export const seasonInjuryTypeSchema = z.enum([
  'lower-body',
  'soft-tissue',
  'upper-body',
  'illness',
]);
export type SeasonInjuryType = z.infer<typeof seasonInjuryTypeSchema>;

export const seasonInjurySeveritySchema = z.enum(['minor', 'moderate', 'major', 'season-ending']);
export type SeasonInjurySeverity = z.infer<typeof seasonInjurySeveritySchema>;

export const seasonInjurySourceSchema = z.enum(['natural', 'risky-rehab-failure']);
export type SeasonInjurySource = z.infer<typeof seasonInjurySourceSchema>;

export const injuryIdSchema = z.string().regex(/^inj-[0-9a-f]{32}$/);
export type InjuryId = z.infer<typeof injuryIdSchema>;

export const SEASON_REHAB_RECURRENCE_PREMIUM_BASIS_POINTS = 60;
export const SEASON_REHAB_SUCCESS_BASIS_POINTS = 6000;

export const seasonInjuryRecordSchema = z.object({
  injuryId: injuryIdSchema,
  playerVersionId: playerVersionIdSchema,
  franchiseId: franchiseIdSchema,

  gameId: z.union([seasonGameIdSchema, postseasonGameIdSchema]),
  type: seasonInjuryTypeSchema,
  severity: seasonInjurySeveritySchema,

  occurredBeforeHalftime: z.boolean(),

  sameGameReturn: z.boolean(),

  sameGameReturned: z.boolean().nullable(),

  missedGamesTotal: z.number().int().nonnegative(),

  missedGamesRemaining: z.number().int().min(0).max(SEASON_ENDING_MISSED_GAMES_SENTINEL),

  actualReturnRound: z.number().int().min(0).max(82).nullable(),
  seasonEnding: z.boolean(),

  rehabModifier: z.union([z.literal(-1), z.literal(0), z.literal(1)]),

  recurrenceWindowRoundsRemaining: z.number().int().min(0).max(10),

  seedPath: z.array(z.string()).min(1),

  rehabAttempted: z.boolean().optional(),
  rehabOutcome: z.enum(['success', 'failure', 'pending']).nullable().optional(),
  rehabRecurrencePremiumApplied: z.boolean().optional(),
  rehabRecurrencePremiumBasisPoints: z.number().int().min(0).max(200).optional(),
});
export type SeasonInjuryRecord = z.infer<typeof seasonInjuryRecordSchema>;

export const seasonHealthStateSchema = z.object({
  schemaVersion: z.literal(1),
  healthVersion: z.literal(SEASON_HEALTH_VERSION),
  injuries: z.array(seasonInjuryRecordSchema),
});
export type SeasonHealthState = z.infer<typeof seasonHealthStateSchema>;

export const seasonCompactInjuryEventSchema = z.object({
  playerVersionId: playerVersionIdSchema,
  side: z.enum(['home', 'away']),
  type: seasonInjuryTypeSchema,
  severity: seasonInjurySeveritySchema,
  removedClock: z.object({
    period: z.number().int().min(1).max(12),

    seconds: z.number().int().min(0).max(720),
  }),
  returned: z.boolean(),

  returnClock: z
    .object({
      period: z.number().int().min(1).max(12),

      seconds: z.number().int().min(0).max(720),
    })
    .nullable(),
});
export type SeasonCompactInjuryEvent = z.infer<typeof seasonCompactInjuryEventSchema>;
