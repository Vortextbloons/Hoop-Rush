import { z } from 'zod';

export const FULL_COURT_COACHING_SCHEMA_VERSION = 1;

const FULL_COURT_MINUTE_TOTAL = 240;
const FULL_COURT_MIN_ROTATION_PLAYERS = 5;
const FULL_COURT_MAX_ROTATION_PLAYERS = 12;
const FULL_COURT_MAX_PLAYER_MINUTES = 48;

const playerRefSchema = z.string().min(1).max(64);

export const fullCourtTacticsSchema = z.object({
  pace: z.enum(['slow', 'balanced', 'fast']),
  offense: z.enum(['balanced', 'perimeter', 'interior', 'ball-movement']),
  defense: z.enum(['balanced', 'pressure', 'protect-paint']),
});
export type FullCourtTactics = z.infer<typeof fullCourtTacticsSchema>;

export const FULL_COURT_DEFAULT_TACTICS: FullCourtTactics = fullCourtTacticsSchema.parse({
  pace: 'balanced',
  offense: 'balanced',
  defense: 'balanced',
});

function hasDuplicates(ids: readonly string[]): boolean {
  return new Set(ids).size !== ids.length;
}

const fullCourtRotationSchema = z
  .object({
    startingFive: z.array(playerRefSchema).length(FULL_COURT_MIN_ROTATION_PLAYERS),
    minuteTargets: z.record(
      playerRefSchema,
      z.number().int().min(0).max(FULL_COURT_MAX_PLAYER_MINUTES),
    ),
    closingFive: z.array(playerRefSchema).length(FULL_COURT_MIN_ROTATION_PLAYERS).optional(),
  })
  .superRefine((rotation, context) => {
    const targetIds = Object.keys(rotation.minuteTargets);
    if (
      targetIds.length < FULL_COURT_MIN_ROTATION_PLAYERS ||
      targetIds.length > FULL_COURT_MAX_ROTATION_PLAYERS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['minuteTargets'],
        message: `a rotation requires ${String(FULL_COURT_MIN_ROTATION_PLAYERS)} to ${String(FULL_COURT_MAX_ROTATION_PLAYERS)} minute targets`,
      });
    }
    const total = Object.values(rotation.minuteTargets).reduce((sum, minutes) => sum + minutes, 0);
    if (total !== FULL_COURT_MINUTE_TOTAL) {
      context.addIssue({
        code: 'custom',
        path: ['minuteTargets'],
        message: `minute targets must total ${String(FULL_COURT_MINUTE_TOTAL)}`,
      });
    }
    if (hasDuplicates(rotation.startingFive)) {
      context.addIssue({
        code: 'custom',
        path: ['startingFive'],
        message: 'starters must be unique',
      });
    }
    if (rotation.closingFive !== undefined && hasDuplicates(rotation.closingFive)) {
      context.addIssue({
        code: 'custom',
        path: ['closingFive'],
        message: 'closers must be unique',
      });
    }
    const requireTargets = (
      players: readonly string[],
      path: 'startingFive' | 'closingFive',
      label: 'starter' | 'closer',
    ): void => {
      for (const playerId of players) {
        const minutes = Object.hasOwn(rotation.minuteTargets, playerId)
          ? rotation.minuteTargets[playerId]
          : undefined;
        if (minutes === undefined) {
          context.addIssue({
            code: 'custom',
            path: [path],
            message: `${label} ${playerId} is missing a minute target`,
          });
        } else if (minutes <= 0) {
          context.addIssue({
            code: 'custom',
            path: [path],
            message: `${label} ${playerId} requires positive minutes`,
          });
        }
      }
    };
    requireTargets(rotation.startingFive, 'startingFive', 'starter');
    if (rotation.closingFive !== undefined) {
      requireTargets(rotation.closingFive, 'closingFive', 'closer');
    }
  });

export const fullCourtCoachingPlanSchema = z.object({
  schemaVersion: z.literal(FULL_COURT_COACHING_SCHEMA_VERSION),
  tactics: fullCourtTacticsSchema,
  rotation: fullCourtRotationSchema.optional(),
});
export type FullCourtCoachingPlan = z.infer<typeof fullCourtCoachingPlanSchema>;

export const FULL_COURT_DEFAULT_COACHING_PLAN: FullCourtCoachingPlan =
  fullCourtCoachingPlanSchema.parse({
    schemaVersion: FULL_COURT_COACHING_SCHEMA_VERSION,
    tactics: FULL_COURT_DEFAULT_TACTICS,
  });
