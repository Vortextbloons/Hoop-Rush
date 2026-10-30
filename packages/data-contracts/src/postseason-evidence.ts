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
export const playoffPerformanceSchema = z.object({
  season: z.string().regex(/^\d{4}-\d{2}$/),
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
