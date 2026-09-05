import { z } from 'zod';
import { franchiseIdSchema, playerIdSchema, seedSchema } from './ids.ts';
import { positionUnionSchema } from './positions.ts';
import { eraSimulationProfileSchema } from './era-sim-profile.ts';
import {
  simulationAnchorsSchema,
  simulationRatingsSchema,
  simulationTendenciesSchema,
} from './simulation.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { ratingProfileSchema } from './ratings-model.ts';
import { seasonStaminaInputSchema } from './season-effects.ts';
import { seasonRotationSchema } from './season-rotation.ts';
import { seasonGameRuleSchema } from './season-evolution.ts';
import { seasonHomeCourtProfileSchema, SEASON_NEUTRAL_HOME_COURT } from './season-home-court.ts';
import {
  SEASON_GAME_TARGETS_VERSION,
  SEASON_GAME_VERSION,
  SEASON_ROTATION_PLANNER_VERSION,
  SEASON_ROTATION_V2,
  SEASON_ROTATION_VERSION,
} from './season-versions.ts';
export const seasonRotationPresetSchema = z.enum(['balanced', 'tight', 'bench-heavy']);
export type SeasonRotationPreset = z.infer<typeof seasonRotationPresetSchema>;
export const SEASON_ROTATION_PRESET_TARGETS = {
  balanced: { starters: 33, bench: [21, 18, 15, 12, 9] },
  tight: { starters: 37, bench: [20, 14, 9, 7, 5] },
  'bench-heavy': { starters: 29, bench: [23, 21, 19, 17, 15] },
} as const satisfies Record<
  SeasonRotationPreset,
  {
    starters: number;
    bench: readonly [number, number, number, number, number];
  }
>;
export const seasonRotationRejectionCodeSchema = z.enum([
  'ROSTER_MISMATCH',
  'DUPLICATE_PLAYER_VERSION',
  'INVALID_TARGETS',
  'ILLEGAL_STARTERS',
  'ILLEGAL_CLOSING_FIVE',
]);
export type SeasonRotationRejectionCode = z.infer<typeof seasonRotationRejectionCodeSchema>;
export const setSeasonRotationCommandSchema = z
  .object({
    schemaVersion: z.literal(1),
    commandType: z.literal('set-season-rotation'),
    commandId: z.string().min(1).max(64),
    franchiseId: franchiseIdSchema,
    preset: seasonRotationPresetSchema.nullable(),
    rotation: seasonRotationSchema.nullable(),
  })
  .superRefine((command, ctx) => {
    if (command.preset === null && command.rotation === null) {
      ctx.addIssue({ code: 'custom', message: 'set-season-rotation needs a preset or rotation' });
    }
    if (command.preset !== null && command.rotation !== null) {
      ctx.addIssue({
        code: 'custom',
        message: 'set-season-rotation takes preset or rotation, not both',
      });
    }
  });
export type SetSeasonRotationCommand = z.infer<typeof setSeasonRotationCommandSchema>;
export const seasonRotationCommandResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('accepted'),
    commandId: z.string().min(1).max(64),
    franchiseId: franchiseIdSchema,
    rotation: seasonRotationSchema,
  }),
  z.object({
    status: z.literal('rejected'),
    commandId: z.string().min(1).max(64),
    franchiseId: franchiseIdSchema,
    errorCode: seasonRotationRejectionCodeSchema,
    message: z.string().min(1).max(512),
  }),
]);
export type SeasonRotationCommandResult = z.infer<typeof seasonRotationCommandResultSchema>;
export const seasonGameAvailabilitySchema = z.object({
  playerVersionId: playerVersionIdSchema,
  available: z.boolean(),
});
export type SeasonGameAvailability = z.infer<typeof seasonGameAvailabilitySchema>;
export const seasonRemovalReasonSchema = z.enum(['injected-injury-removal', 'injury']);
export type SeasonRemovalReason = z.infer<typeof seasonRemovalReasonSchema>;
export const seasonRemovalSchema = z.object({
  side: z.enum(['home', 'away']),
  playerVersionId: playerVersionIdSchema,
  period: z.number().int().min(1).max(12),
  secondsRemaining: z.number().int().min(0).max(720),
  reason: seasonRemovalReasonSchema,
  clockKind: z.enum(['timed', 'untimed']).optional(),
  elapsedSeconds: z.number().int().nonnegative().optional(),
  eventOrder: z.number().int().nonnegative().optional(),
});
export type SeasonRemoval = z.infer<typeof seasonRemovalSchema>;
export const seasonReturnReasonSchema = z.enum(['injury-return']);
export type SeasonReturnReason = z.infer<typeof seasonReturnReasonSchema>;
export const seasonReturnSchema = z.object({
  side: z.enum(['home', 'away']),
  playerVersionId: playerVersionIdSchema,
  period: z.number().int().min(1).max(12),
  secondsRemaining: z.number().int().min(0).max(720),
  reason: seasonReturnReasonSchema,
  clockKind: z.enum(['timed', 'untimed']).optional(),
  elapsedSeconds: z.number().int().nonnegative().optional(),
  eventOrder: z.number().int().nonnegative().optional(),
});
export type SeasonReturn = z.infer<typeof seasonReturnSchema>;
export const seasonGamePlayerInputSchema = z
  .object({
    playerVersionId: playerVersionIdSchema,
    playerId: playerIdSchema,
    displayName: z.string().min(1).max(96),
    positions: positionUnionSchema,
    heightInches: z.number().int().min(60).max(96).nullable(),
    weightLbs: z.number().int().min(120).max(400).nullable(),
    ratings: simulationRatingsSchema,
    tendencies: simulationTendenciesSchema,
    anchors: simulationAnchorsSchema.optional(),
    overall: z.number().int().min(0).max(100).optional(),
    ratingProfile: ratingProfileSchema.optional(),
    stamina: seasonStaminaInputSchema.optional(),
  })
  .strict();
export type SeasonGamePlayerInput = z.infer<typeof seasonGamePlayerInputSchema>;
export const seasonGameTeamInputSchema = z.object({
  teamId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  franchiseId: franchiseIdSchema,
  players: z.array(seasonGamePlayerInputSchema).length(10),
});
export type SeasonGameTeamInput = z.infer<typeof seasonGameTeamInputSchema>;
export const seasonGameSimulationInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    seed: seedSchema,
    gameNumber: z.number().int().min(1).max(1230),
    dataVersion: z.string().min(1).max(64),
    profile: eraSimulationProfileSchema,
    home: seasonGameTeamInputSchema,
    away: seasonGameTeamInputSchema,
    homeRotation: seasonRotationSchema,
    awayRotation: seasonRotationSchema,
    availability: z.array(seasonGameAvailabilitySchema).length(20),
    removals: z.array(seasonRemovalSchema).default([]),
    returns: z.array(seasonReturnSchema).default([]),
    homeCourt: seasonHomeCourtProfileSchema.default(() => SEASON_NEUTRAL_HOME_COURT),
    gameRule: seasonGameRuleSchema.optional(),
    ruleVersion: z.string().min(1).max(64).optional(),
  })
  .superRefine((input, ctx) => {
    const ids = new Set<string>();
    for (const team of [input.home, input.away]) {
      for (const player of team.players) {
        if (ids.has(player.playerVersionId)) {
          ctx.addIssue({
            code: 'custom',
            message: `playerVersionId ${player.playerVersionId} appears on both sides`,
          });
        }
        ids.add(player.playerVersionId);
      }
    }
    const rostered = new Set(ids);
    const seenAvailability = new Set<string>();
    for (const entry of input.availability) {
      if (!rostered.has(entry.playerVersionId)) {
        ctx.addIssue({
          code: 'custom',
          message: `availability references an unrostered version ${entry.playerVersionId}`,
        });
      }
      if (seenAvailability.has(entry.playerVersionId)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate availability entry ${entry.playerVersionId}`,
        });
      }
      seenAvailability.add(entry.playerVersionId);
    }
    for (const removal of input.removals) {
      if (!rostered.has(removal.playerVersionId)) {
        ctx.addIssue({
          code: 'custom',
          message: `removal references an unrostered version ${removal.playerVersionId}`,
        });
      }
    }
    for (const ret of input.returns) {
      if (!rostered.has(ret.playerVersionId)) {
        ctx.addIssue({
          code: 'custom',
          message: `return references an unrostered version ${ret.playerVersionId}`,
        });
      }
    }
  });
export type SeasonGameSimulationInput = z.infer<typeof seasonGameSimulationInputSchema>;
export const seasonSubstitutionReasonSchema = z.enum([
  'rotation-plan',
  'closing-preference',
  'foul-out',
  'injected-injury-removal',
  'contingency-legality',
]);
export type SeasonSubstitutionReason = z.infer<typeof seasonSubstitutionReasonSchema>;
export const seasonSubstitutionSchema = z.object({
  side: z.enum(['home', 'away']),
  period: z.number().int().min(1).max(12),
  secondsRemaining: z.number().int().min(0).max(720),
  playerIn: playerVersionIdSchema,
  playerOut: playerVersionIdSchema,
  reason: seasonSubstitutionReasonSchema,
  unit: z.array(playerVersionIdSchema).length(5),
  clockKind: z.enum(['timed', 'untimed']).optional(),
  elapsedSeconds: z.number().int().nonnegative().optional(),
  eventOrder: z.number().int().nonnegative().optional(),
});
export type SeasonSubstitution = z.infer<typeof seasonSubstitutionSchema>;
export const seasonUnitStintSchema = z.object({
  side: z.enum(['home', 'away']),
  period: z.number().int().min(1).max(12),
  startSecondsRemaining: z.number().int().min(0).max(720),
  endSecondsRemaining: z.number().int().min(0).max(720),
  durationSeconds: z.number().int().min(0),
  players: z.array(playerVersionIdSchema).length(5),
  clockKind: z.enum(['timed', 'untimed']).optional(),
  elapsedStartSeconds: z.number().int().nonnegative().optional(),
  elapsedEndSeconds: z.number().int().nonnegative().optional(),
  eventOrder: z.number().int().nonnegative().optional(),
});
export type SeasonUnitStint = z.infer<typeof seasonUnitStintSchema>;
export const seasonRotationDeviationReasonSchema = z.enum([
  'dead-ball-timing',
  'closing-preference',
  'foul-out',
  'pregame-unavailable',
  'injected-injury-removal',
  'contingency-legality',
  'injury-return',
]);
export type SeasonRotationDeviationReason = z.infer<typeof seasonRotationDeviationReasonSchema>;
export const seasonRotationDeviationSchema = z.object({
  side: z.enum(['home', 'away']),
  playerVersionId: playerVersionIdSchema,
  actualSeconds: z.number().int().min(0),
  targetSeconds: z.number().int().min(0).max(2880),
  reasons: z.array(seasonRotationDeviationReasonSchema),
});
export type SeasonRotationDeviation = z.infer<typeof seasonRotationDeviationSchema>;
export const seasonFoulOutSchema = z.object({
  side: z.enum(['home', 'away']),
  playerVersionId: playerVersionIdSchema,
  period: z.number().int().min(1).max(12),
  secondsRemaining: z.number().int().min(0).max(720),
  clockKind: z.enum(['timed', 'untimed']).optional(),
  elapsedSeconds: z.number().int().nonnegative().optional(),
  eventOrder: z.number().int().nonnegative().optional(),
});
export type SeasonFoulOut = z.infer<typeof seasonFoulOutSchema>;
export const seasonRemovalEventSchema = z.object({
  side: z.enum(['home', 'away']),
  playerVersionId: playerVersionIdSchema,
  period: z.number().int().min(1).max(12),
  secondsRemaining: z.number().int().min(0).max(720),
  clockKind: z.enum(['timed', 'untimed']).optional(),
  elapsedSeconds: z.number().int().nonnegative().optional(),
  eventOrder: z.number().int().nonnegative().optional(),
  reason: seasonRemovalReasonSchema,
});
export type SeasonRemovalEvent = z.infer<typeof seasonRemovalEventSchema>;
export const seasonReturnEventSchema = z.object({
  side: z.enum(['home', 'away']),
  playerVersionId: playerVersionIdSchema,
  period: z.number().int().min(1).max(12),
  secondsRemaining: z.number().int().min(0).max(720),
  clockKind: z.enum(['timed', 'untimed']).optional(),
  elapsedSeconds: z.number().int().nonnegative().optional(),
  eventOrder: z.number().int().nonnegative().optional(),
  reason: seasonReturnReasonSchema,
});
export type SeasonReturnEvent = z.infer<typeof seasonReturnEventSchema>;
export const seasonGamePlayerResultSchema = z.object({
  playerVersionId: playerVersionIdSchema,
  playerId: playerIdSchema,
  seconds: z.number().int().min(0),
  minutes: z.number().nonnegative(),
  deepFours: z
    .object({ made: z.number().int().nonnegative(), attempted: z.number().int().nonnegative() })
    .optional(),
  points: z.number().int().nonnegative(),
  fieldGoals: z.object({
    made: z.number().int().nonnegative(),
    attempted: z.number().int().nonnegative(),
  }),
  threes: z.object({
    made: z.number().int().nonnegative(),
    attempted: z.number().int().nonnegative(),
  }),
  freeThrows: z.object({
    made: z.number().int().nonnegative(),
    attempted: z.number().int().nonnegative(),
  }),
  rebounds: z.object({
    total: z.number().int().nonnegative(),
    offensive: z.number().int().nonnegative(),
    defensive: z.number().int().nonnegative(),
  }),
  assists: z.number().int().nonnegative(),
  steals: z.number().int().nonnegative(),
  blocks: z.number().int().nonnegative(),
  turnovers: z.number().int().nonnegative(),
  fouls: z.number().int().nonnegative(),
  diagnostics: z.object({
    usage: z.number().nonnegative(),
    shotZones: z.array(
      z.object({
        zone: z.string().min(1).max(32),
        attempts: z.number().int().nonnegative(),
        makes: z.number().int().nonnegative(),
      }),
    ),
    assistOpportunities: z.number().int().nonnegative(),
    offensiveReboundChances: z.number().int().nonnegative(),
    defensiveReboundChances: z.number().int().nonnegative(),
    contestedShots: z.number().int().nonnegative(),
  }),
});
export type SeasonGamePlayerResult = z.infer<typeof seasonGamePlayerResultSchema>;
export const seasonGameSideResultSchema = z.object({
  teamId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  franchiseId: franchiseIdSchema,
  score: z.number().int().nonnegative(),
  periodScores: z.array(z.number().int().nonnegative()),
  box: z.object({
    points: z.number().int().nonnegative(),
    fieldGoals: z.object({
      made: z.number().int().nonnegative(),
      attempted: z.number().int().nonnegative(),
    }),
    threes: z.object({
      made: z.number().int().nonnegative(),
      attempted: z.number().int().nonnegative(),
    }),
    freeThrows: z.object({
      made: z.number().int().nonnegative(),
      attempted: z.number().int().nonnegative(),
    }),
    rebounds: z.object({
      total: z.number().int().nonnegative(),
      offensive: z.number().int().nonnegative(),
      defensive: z.number().int().nonnegative(),
      team: z.number().int().nonnegative(),
    }),
    assists: z.number().int().nonnegative(),
    steals: z.number().int().nonnegative(),
    blocks: z.number().int().nonnegative(),
    turnovers: z.number().int().nonnegative(),
    fouls: z.number().int().nonnegative(),
    possessions: z.number().int().nonnegative(),
    deepFours: z
      .object({ made: z.number().int().nonnegative(), attempted: z.number().int().nonnegative() })
      .optional(),
    diagnostics: z.object({
      assistedFieldGoals: z.number().int().nonnegative(),
      unassistedFieldGoals: z.number().int().nonnegative(),
      reboundOpportunities: z.number().int().nonnegative(),
      contestedShots: z.number().int().nonnegative(),
    }),
  }),
  players: z.array(seasonGamePlayerResultSchema).length(10),
  shotZones: z.array(
    z.object({
      zone: z.string().min(1).max(32),
      attempts: z.number().int().nonnegative(),
      makes: z.number().int().nonnegative(),
    }),
  ),
  returns: z.array(seasonReturnEventSchema),
});
export type SeasonGameSideResult = z.infer<typeof seasonGameSideResultSchema>;
const seasonGameResultBaseSchema = z.object({
  schemaVersion: z.literal(1),
  seed: seedSchema,
  gameNumber: z.number().int().min(1).max(1230),
  dataVersion: z.string().min(1).max(64),
  engineVersion: z.string().min(1).max(64),
  profileVersion: z.string().min(1).max(64),
  winner: z.enum(['home', 'away']),
  gameRule: seasonGameRuleSchema.optional(),
  ruleVersion: z.string().min(1).max(64).optional(),
});
export const seasonForfeitTriggerSchema = z.enum([
  'no-legal-five-tipoff',
  'no-legal-five-after-removal',
  'human-interruption-forfeit',
]);
export type SeasonForfeitTrigger = z.infer<typeof seasonForfeitTriggerSchema>;
export const seasonGameSimulationResultSchema = z.discriminatedUnion('outcome', [
  seasonGameResultBaseSchema.extend({
    outcome: z.literal('completed'),
    overtimePeriods: z.number().int().min(0),
    overtimeRace: z
      .object({
        target: z.literal(7),
        homePoints: z.number().int().nonnegative(),
        awayPoints: z.number().int().nonnegative(),
        possessions: z.number().int().nonnegative(),
      })
      .optional(),
    home: seasonGameSideResultSchema,
    away: seasonGameSideResultSchema,
    substitutions: z.array(seasonSubstitutionSchema),
    unitStints: z.array(seasonUnitStintSchema),
    deviations: z.array(seasonRotationDeviationSchema),
    foulOuts: z.array(seasonFoulOutSchema),
    removals: z.array(seasonRemovalEventSchema),
  }),
  seasonGameResultBaseSchema
    .extend({
      outcome: z.literal('forfeit'),
      losingFranchiseId: franchiseIdSchema,
      trigger: seasonForfeitTriggerSchema,
      homeScore: z.union([z.literal(0), z.literal(2)]),
      awayScore: z.union([z.literal(0), z.literal(2)]),
    })
    .superRefine((result, ctx) => {
      if (result.homeScore + result.awayScore !== 2) {
        ctx.addIssue({ code: 'custom', message: 'forfeit must be an official 2-0 result' });
      }
    }),
  z.object({
    schemaVersion: z.literal(1),
    outcome: z.literal('no-legal-five-both'),
    seed: seedSchema,
    gameNumber: z.number().int().min(1).max(1230),
    dataVersion: z.string().min(1).max(64),
    engineVersion: z.string().min(1).max(64),
    profileVersion: z.string().min(1).max(64),
  }),
]);
export type SeasonGameSimulationResult = z.infer<typeof seasonGameSimulationResultSchema>;
export const seasonGameTargetsSchema = z.object({
  schemaVersion: z.literal(1),
  targetsVersion: z.literal(SEASON_GAME_TARGETS_VERSION),
  gameVersion: z.literal(SEASON_GAME_VERSION),
  plannerVersion: z.literal(SEASON_ROTATION_PLANNER_VERSION),
  rotationVersion: z.union([z.literal(SEASON_ROTATION_VERSION), z.literal(SEASON_ROTATION_V2)]),
  calibration: z.object({
    calibrationSeedCount: z.number().int().positive(),
    validationSeedCount: z.number().int().positive(),
    generatedAtIso: z.string().min(1),
  }),
  fixtures: z.array(
    z.object({
      fixtureId: z.string().min(1).max(64),
      preset: seasonRotationPresetSchema,
      sample: z.number().int().positive(),
      starterSecondsMedian: z.number().nonnegative(),
      benchSecondsMedian: z.number().nonnegative(),
      benchRoleMedianSeconds: z.array(z.number().nonnegative()).length(5),
      aggregateEnvelopes: z.record(z.string(), z.tuple([z.number(), z.number()])),
    }),
  ),
  gates: z.object({
    zeroFailures: z.boolean(),
    starterOrdering: z.boolean(),
    benchOrdering: z.boolean(),
    benchRoleNonIncreasing: z.boolean(),
    heldOutPassShare: z.number().min(0).max(1),
    heldOutPass: z.boolean(),
  }),
});
export type SeasonGameTargets = z.infer<typeof seasonGameTargetsSchema>;
