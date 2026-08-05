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
import { seasonRotationSchema } from './season-rotation.ts';
import {
  SEASON_GAME_TARGETS_VERSION,
  SEASON_GAME_VERSION,
  SEASON_ROTATION_PLANNER_VERSION,
  SEASON_ROTATION_VERSION,
} from './season-versions.ts';

/**
 * M2.2 Season Run single-game simulation contracts (spec/2.0/04,
 * season-game-v1, rotation-planner-v1, season-game-targets-v1). The engine
 * controller consumes `SeasonGameSimulationInput`, produces the typed
 * `SeasonGameSimulationResult` discriminated union, and records
 * substitutions, unit stints, per-player deviations, foul-outs, and removals.
 *
 * Identity rule: `playerVersionId` is the authoritative simulation and
 * recorder identity. `playerId` is person-level metadata only, so two
 * historical versions of one person may share one roster (or one active
 * five) without merging any accounting.
 */

/** Frozen v1 rotation presets (spec/2.0/04): starters are all equal, bench
 * roles 6-10 use the fixed descending minute tables below. */
export const seasonRotationPresetSchema = z.enum(['balanced', 'tight', 'bench-heavy']);
export type SeasonRotationPreset = z.infer<typeof seasonRotationPresetSchema>;

/** Authoritative preset tables. Applying a preset rewrites ONLY the target
 * minutes; the current starter order, bench hierarchy, and closing five are
 * preserved. Regulation targets are integers from 0-48 and total 240. */
export const SEASON_ROTATION_PRESET_TARGETS = {
  balanced: { starters: 33, bench: [21, 18, 15, 12, 9] },
  tight: { starters: 37, bench: [20, 14, 9, 7, 5] },
  'bench-heavy': { starters: 29, bench: [23, 21, 19, 17, 15] },
} as const satisfies Record<
  SeasonRotationPreset,
  { starters: number; bench: readonly [number, number, number, number, number] }
>;

/** Fixed rotation rejection codes (spec/2.0/04 M2.2). */
export const seasonRotationRejectionCodeSchema = z.enum([
  'ROSTER_MISMATCH',
  'DUPLICATE_PLAYER_VERSION',
  'INVALID_TARGETS',
  'ILLEGAL_STARTERS',
  'ILLEGAL_CLOSING_FIVE',
]);
export type SeasonRotationRejectionCode = z.infer<typeof seasonRotationRejectionCodeSchema>;

/**
 * Typed rotation-editing command. A `preset` command rewrites only target
 * minutes; a `rotation` command supplies the full v2 rotation. Exactly one
 * of the two must be present.
 */
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

/** Accepted/rejected result of a rotation-editing command. */
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

/** Pregame availability entry for one rostered version. */
export const seasonGameAvailabilitySchema = z.object({
  playerVersionId: playerVersionIdSchema,
  available: z.boolean(),
});
export type SeasonGameAvailability = z.infer<typeof seasonGameAvailabilitySchema>;

/** Same-game removal reasons (the M2.5 seeded injury model uses this seam). */
export const seasonRemovalReasonSchema = z.enum(['injected-injury-removal']);
export type SeasonRemovalReason = z.infer<typeof seasonRemovalReasonSchema>;

/**
 * Deterministic same-game removal, honored at the next legal boundary after
 * the recorded game clock. Production M2.2 inputs carry an empty list;
 * tests and CLI fixtures inject removals to exercise contingency behavior.
 */
export const seasonRemovalSchema = z.object({
  side: z.enum(['home', 'away']),
  playerVersionId: playerVersionIdSchema,
  /** 1-based period. */
  period: z.number().int().min(1).max(12),
  /** Game clock seconds remaining in the period when the removal applies. */
  secondsRemaining: z.number().int().min(0).max(720),
  reason: seasonRemovalReasonSchema,
});
export type SeasonRemoval = z.infer<typeof seasonRemovalSchema>;

/** One rostered player exactly as the Season controller sees them. */
export const seasonGamePlayerInputSchema = z
  .object({
    playerVersionId: playerVersionIdSchema,
    playerId: playerIdSchema,
    displayName: z.string().min(1).max(96),
    /** Career-wide detailed playable union; slot legality is validated per unit. */
    positions: positionUnionSchema,
    heightInches: z.number().int().min(60).max(96).nullable(),
    weightLbs: z.number().int().min(120).max(400).nullable(),
    ratings: simulationRatingsSchema,
    tendencies: simulationTendenciesSchema,
    anchors: simulationAnchorsSchema.optional(),
    overall: z.number().int().min(0).max(100).optional(),
    ratingProfile: ratingProfileSchema.optional(),
  })
  .strict();
export type SeasonGamePlayerInput = z.infer<typeof seasonGamePlayerInputSchema>;

/** One ten-player Season side. */
export const seasonGameTeamInputSchema = z.object({
  teamId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  franchiseId: franchiseIdSchema,
  players: z.array(seasonGamePlayerInputSchema).length(10),
});
export type SeasonGameTeamInput = z.infer<typeof seasonGameTeamInputSchema>;

/**
 * Everything needed to reproduce one Season game: seed, game number,
 * versions, era profile, both ten-player rosters, both v2 rotations, and
 * pregame availability. `removals` is the M2.5 injury seam; it is empty in
 * production M2.2 inputs.
 */
export const seasonGameSimulationInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    seed: seedSchema,
    /** 1-based game number inside the shared 1,230-game season schedule. */
    gameNumber: z.number().int().min(1).max(1230),
    dataVersion: z.string().min(1).max(64),
    profile: eraSimulationProfileSchema,
    home: seasonGameTeamInputSchema,
    away: seasonGameTeamInputSchema,
    homeRotation: seasonRotationSchema,
    awayRotation: seasonRotationSchema,
    /** Pregame availability for every rostered version on both sides. */
    availability: z.array(seasonGameAvailabilitySchema).length(20),
    removals: z.array(seasonRemovalSchema).default([]),
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
  });
export type SeasonGameSimulationInput = z.infer<typeof seasonGameSimulationInputSchema>;

/** Causal reason recorded with a substitution (spec/2.0/04 M2.2). */
export const seasonSubstitutionReasonSchema = z.enum([
  'rotation-plan',
  'closing-preference',
  'foul-out',
  'injected-injury-removal',
  'contingency-legality',
]);
export type SeasonSubstitutionReason = z.infer<typeof seasonSubstitutionReasonSchema>;

/** One recorded substitution at an approved dead-ball or period boundary. */
export const seasonSubstitutionSchema = z.object({
  side: z.enum(['home', 'away']),
  /** 1-based period. */
  period: z.number().int().min(1).max(12),
  /** Game clock seconds remaining in the period at the pause. */
  secondsRemaining: z.number().int().min(0).max(720),
  playerIn: playerVersionIdSchema,
  playerOut: playerVersionIdSchema,
  reason: seasonSubstitutionReasonSchema,
  /** Resulting ordered unit (slots G, G, F, F, C). */
  unit: z.array(playerVersionIdSchema).length(5),
});
export type SeasonSubstitution = z.infer<typeof seasonSubstitutionSchema>;

/** Coalesced on-court unit stint with exact start/end clock times. */
export const seasonUnitStintSchema = z.object({
  side: z.enum(['home', 'away']),
  /** 1-based period. */
  period: z.number().int().min(1).max(12),
  /** Clock seconds remaining when the unit took the floor. */
  startSecondsRemaining: z.number().int().min(0).max(720),
  /** Clock seconds remaining when the unit left the floor (or the period ended). */
  endSecondsRemaining: z.number().int().min(0).max(720),
  /** startSecondsRemaining - endSecondsRemaining = on-court seconds. */
  durationSeconds: z.number().int().min(0),
  players: z.array(playerVersionIdSchema).length(5),
});
export type SeasonUnitStint = z.infer<typeof seasonUnitStintSchema>;

/** Fixed per-player regulation deviation reasons (spec/2.0/04 M2.2). */
export const seasonRotationDeviationReasonSchema = z.enum([
  'dead-ball-timing',
  'closing-preference',
  'foul-out',
  'pregame-unavailable',
  'injected-injury-removal',
  'contingency-legality',
]);
export type SeasonRotationDeviationReason = z.infer<typeof seasonRotationDeviationReasonSchema>;

/** Per-player regulation deviation; emitted only when actual != target seconds. */
export const seasonRotationDeviationSchema = z.object({
  side: z.enum(['home', 'away']),
  playerVersionId: playerVersionIdSchema,
  /** Exact regulation seconds played. */
  actualSeconds: z.number().int().min(0),
  /** Regulation target seconds (target minutes x 60). */
  targetSeconds: z.number().int().min(0).max(2880),
  reasons: z.array(seasonRotationDeviationReasonSchema),
});
export type SeasonRotationDeviation = z.infer<typeof seasonRotationDeviationSchema>;

/** A sixth personal foul removes the player at the next legal pause. */
export const seasonFoulOutSchema = z.object({
  side: z.enum(['home', 'away']),
  playerVersionId: playerVersionIdSchema,
  /** 1-based period. */
  period: z.number().int().min(1).max(12),
  secondsRemaining: z.number().int().min(0).max(720),
});
export type SeasonFoulOut = z.infer<typeof seasonFoulOutSchema>;

/** Applied same-game removal event (recorded once the pause resolves it). */
export const seasonRemovalEventSchema = z.object({
  side: z.enum(['home', 'away']),
  playerVersionId: playerVersionIdSchema,
  /** 1-based period. */
  period: z.number().int().min(1).max(12),
  secondsRemaining: z.number().int().min(0).max(720),
  reason: seasonRemovalReasonSchema,
});
export type SeasonRemovalEvent = z.infer<typeof seasonRemovalEventSchema>;

/** Per-player line in a Season game result; identity is playerVersionId. */
export const seasonGamePlayerResultSchema = z.object({
  playerVersionId: playerVersionIdSchema,
  playerId: playerIdSchema,
  /** Exact on-court seconds (integer). */
  seconds: z.number().int().min(0),
  /** Display minutes derived from seconds (seconds / 60). */
  minutes: z.number().nonnegative(),
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

/** One side of a completed Season game. */
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
});
export type SeasonGameSideResult = z.infer<typeof seasonGameSideResultSchema>;

/** Shared completed/forfeit metadata. */
const seasonGameResultBaseSchema = z.object({
  schemaVersion: z.literal(1),
  seed: seedSchema,
  gameNumber: z.number().int().min(1).max(1230),
  dataVersion: z.string().min(1).max(64),
  engineVersion: z.string().min(1).max(64),
  profileVersion: z.string().min(1).max(64),
  winner: z.enum(['home', 'away']),
});

/** Forfeit trigger kinds. */
export const seasonForfeitTriggerSchema = z.enum([
  'no-legal-five-tipoff',
  'no-legal-five-after-removal',
]);
export type SeasonForfeitTrigger = z.infer<typeof seasonForfeitTriggerSchema>;

/**
 * Typed Season game simulation result. `completed` carries the full box
 * scores (identity = playerVersionId) plus substitutions, unit stints,
 * deviations, foul-outs, and removals. `forfeit` is the official 2-0 result
 * with the losing franchise and trigger fact and no player statistics.
 * `noLegalFiveBoth` is returned instead of arbitrarily choosing a loser when
 * both teams are invalid before tipoff.
 */
export const seasonGameSimulationResultSchema = z.discriminatedUnion('outcome', [
  seasonGameResultBaseSchema.extend({
    outcome: z.literal('completed'),
    overtimePeriods: z.number().int().min(0),
    home: seasonGameSideResultSchema,
    away: seasonGameSideResultSchema,
    substitutions: z.array(seasonSubstitutionSchema),
    unitStints: z.array(seasonUnitStintSchema),
    deviations: z.array(seasonRotationDeviationSchema),
    foulOuts: z.array(seasonFoulOutSchema),
    removals: z.array(seasonRemovalEventSchema),
  }),
  seasonGameResultBaseSchema.extend({
    outcome: z.literal('forfeit'),
    losingFranchiseId: franchiseIdSchema,
    trigger: seasonForfeitTriggerSchema,
    /** Official result: the winner scores 2, the loser 0. */
    homeScore: z.literal(2),
    awayScore: z.literal(0),
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

/**
 * Frozen Season game calibration targets artifact (season-game-targets-v1,
 * spec/2.0/04 M2.2). Committed by `season game calibrate`; the calibration
 * cohort is seeds 0-1023 with held-out seeds 1024-1279. `starterSecondsMedian`
 * ordering across presets must be tight > balanced > bench-heavy,
 * `benchSecondsMedian` the reverse, bench-role medians non-increasing from
 * sixth through tenth, and at least 95% of held-out aggregate metrics inside
 * the frozen calibration envelopes.
 */
export const seasonGameTargetsSchema = z.object({
  schemaVersion: z.literal(1),
  targetsVersion: z.literal(SEASON_GAME_TARGETS_VERSION),
  gameVersion: z.literal(SEASON_GAME_VERSION),
  plannerVersion: z.literal(SEASON_ROTATION_PLANNER_VERSION),
  rotationVersion: z.literal(SEASON_ROTATION_VERSION),
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
      /** Calibration-cohort envelopes for aggregate metrics (e.g. points-per-game). */
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
