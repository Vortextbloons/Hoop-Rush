import { z } from 'zod';

export const postseasonPlayerStatsSchema = z.object({
  playerExternalId: z.string().min(1),
  gamesPlayed: z.number().int().nonnegative(),
  minutes: z.number().nonnegative(),
  points: z.number().nonnegative(),
  assists: z.number().nonnegative(),
  rebounds: z.number().nonnegative(),
  offensiveRebounds: z.number().nonnegative().nullable(),
  defensiveRebounds: z.number().nonnegative().nullable(),
  steals: z.number().nonnegative().nullable(),
  blocks: z.number().nonnegative().nullable(),
  turnovers: z.number().nonnegative().nullable(),
  fga: z.number().nonnegative(),
  fta: z.number().nonnegative(),
  tsPct: z.number().min(0).max(1.5).nullable(),
});

export const postseasonEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    season: z.string().regex(/^\d{4}-\d{2}$/),
    sources: z.array(z.url()).min(1),
    status: z.enum(['available', 'unavailable']),
    players: z.array(postseasonPlayerStatsSchema),
    coverage: z
      .object({
        eligiblePlayerCount: z.number().int().nonnegative(),
        retrievedPlayerCount: z.number().int().nonnegative(),
        missingPlayerIds: z.array(z.string().min(1)),
      })
      .optional(),
  })
  .superRefine((evidence, context) => {
    if (evidence.status === 'unavailable' && evidence.players.length > 0)
      context.addIssue({
        code: 'custom',
        message: 'Unavailable postseason evidence cannot contain player stats',
      });
    if (
      new Set(evidence.players.map((player) => player.playerExternalId)).size !==
      evidence.players.length
    )
      context.addIssue({ code: 'custom', message: 'Duplicate postseason player' });
  });

export type PostseasonPlayerStats = z.infer<typeof postseasonPlayerStatsSchema>;

const playoffComparisonStatsSchema = postseasonPlayerStatsSchema.pick({
  gamesPlayed: true,
  minutes: true,
  points: true,
  assists: true,
  rebounds: true,
  turnovers: true,
  fga: true,
  fta: true,
  tsPct: true,
});
const playoffDifferencesSchema = z.object({
  tsPct: z.number().nullable(),
  pointsPer36: z.number().nullable(),
  assistsPer36: z.number().nullable(),
  reboundsPer36: z.number().nullable(),
  turnoversPer36: z.number().nullable(),
});
const playoffRatesSchema = z.object({
  tsPct: z.number().nullable(),
  pointsPer100: z.number().nullable(),
  assistsPer100: z.number().nullable(),
  reboundsPer100: z.number().nullable(),
  turnoversPer100: z.number().nullable(),
});
const playoffShootingChannelSchema = z.object({
  expected: z.number().min(0).max(1),
  actual: z.number().min(0).max(1),
  difference: z.number().min(-1).max(1),
  attempts: z.number().positive(),
  weight: z.number().min(0).max(1),
});
const playoffShotVolumeSchema = z.object({
  expected: z.number().nonnegative(),
  actual: z.number().nonnegative(),
  difference: z.number(),
  differencePer36: z.number(),
  possessions: z.number().positive(),
  weight: z.number().min(0).max(1),
});
export const playoffAdjustmentSchema = z
  .object({
    modelVersion: z.enum(['opponent-pace-v1', 'opponent-pace-v2']),
    shooting: z
      .object({
        twoPoint: playoffShootingChannelSchema.nullable(),
        threePoint: playoffShootingChannelSchema.nullable(),
        freeThrow: playoffShootingChannelSchema.nullable(),
      })
      .optional(),
    shotVolume: playoffShotVolumeSchema.nullable().optional(),
    minutePrecision: z.enum(['seconds', 'whole-minutes']).optional(),
    sources: z.array(z.url()).min(1),
    possessions: z.number().positive(),
    opponents: z.number().int().positive(),
    expected: playoffRatesSchema,
    actual: playoffRatesSchema,
    differences: playoffDifferencesSchema,
    weights: z.object({
      tsPct: z.number().min(0).max(1),
      pointsPer36: z.number().min(0).max(1),
      assistsPer36: z.number().min(0).max(1),
      reboundsPer36: z.number().min(0).max(1),
      turnoversPer36: z.number().min(0).max(1),
    }),
  })
  .superRefine((value, context) => {
    if (
      value.modelVersion === 'opponent-pace-v2' &&
      (value.shooting === undefined || value.shotVolume === undefined)
    )
      context.addIssue({
        code: 'custom',
        message: 'Shooting model requires separate shooting and shot-volume evidence',
      });
  });
export type PlayoffAdjustment = z.infer<typeof playoffAdjustmentSchema>;
export const playoffPerformanceSchema = z.object({
  season: z.string().regex(/^\d{4}-\d{2}$/),
  adjustment: playoffAdjustmentSchema.optional(),
  regularSeason: playoffComparisonStatsSchema,
  playoffs: postseasonPlayerStatsSchema,
  differences: z.object({
    tsPct: z.number().nullable(),
    pointsPer36: z.number().nullable(),
    assistsPer36: z.number().nullable(),
    reboundsPer36: z.number().nullable(),
    turnoversPer36: z.number().nullable(),
  }),
});
export type PlayoffPerformance = z.infer<typeof playoffPerformanceSchema>;
