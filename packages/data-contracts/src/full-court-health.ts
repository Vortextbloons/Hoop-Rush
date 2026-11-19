import { z } from 'zod';
import { contentHashSchema, playerIdSchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';

export const FULL_COURT_HEALTH_VERSION = 'full-court-health-v1';

export const fullCourtPlayerHealthSchema = z.object({
  loadBasisPoints: z.number().int().min(0).max(10_000),
  availableFromDay: z.number().int().nonnegative().nullable(),
});
export type FullCourtPlayerHealth = z.infer<typeof fullCourtPlayerHealthSchema>;

export const fullCourtTeamHealthSchema = z.object({
  version: z.literal(FULL_COURT_HEALTH_VERSION),
  teamId: z.string().min(1),
  throughDay: z.number().int().nonnegative(),
  players: z.record(playerIdSchema, fullCourtPlayerHealthSchema),
});
export type FullCourtTeamHealth = z.infer<typeof fullCourtTeamHealthSchema>;

export const FULL_COURT_HEALTH_PROFILE_VERSION = 'full-court-health-profile-v1';

const count = z.number().int().nonnegative();
const durationCounts = z.tuple([count, count, count, count]);

export const fullCourtHealthProfileSetSchema = z
  .object({
    version: z.literal(FULL_COURT_HEALTH_PROFILE_VERSION),
    catalogHash: contentHashSchema,
    evidenceHash: contentHashSchema,
    cohorts: z.record(
      z.string().min(1),
      z.object({
        observedAppearances: count.positive(),
        durationCounts: durationCounts.refine((buckets) => buckets.some((n) => n > 0)),
      }),
    ),
    players: z.record(
      playerVersionIdSchema,
      z.object({
        cohortId: z.string().min(1),
        episodesPer10kAppearances: z.number().nonnegative(),
        playerEvidence: z.discriminatedUnion('source', [
          z.object({ source: z.literal('population') }),
          z.object({ source: z.literal('player-season'), observedAppearances: count.positive() }),
        ]),
      }),
    ),
  })
  .superRefine((profiles, ctx) => {
    for (const [player, profile] of Object.entries(profiles.players)) {
      if (!Object.hasOwn(profiles.cohorts, profile.cohortId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['players', player],
          message: 'Unknown health cohort',
        });
      }
    }
  });
export type FullCourtHealthProfileSet = z.infer<typeof fullCourtHealthProfileSetSchema>;
