import { z } from 'zod';
import { franchiseIdSchema, seasonGameIdSchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_HEALTH_VERSION } from './season-versions.ts';

/**
 * M2.5 injury and health contracts (spec/2.0 M2.5, season-health-v1). The
 * seeded injury model records every injury occurrence, its severity and
 * recovery facts, same-game-return resolution, recurrence windows, and
 * risky-rehab outcomes as an append-only run-scoped list of injury records.
 * Player availability is DERIVED from the recorded injuries (a player is
 * unavailable at a game's tipoff iff they have an active injury that is not
 * same-game-returned and has missed games remaining); it is never stored as
 * a separate fact, so the derivation can always be cross-checked.
 */

/**
 * Season-ending injuries keep this fixed sentinel as their
 * `missedGamesRemaining` (10_000, serialization-safe; the contract forbids
 * infinity). Serialized state compares against the sentinel, never
 * recomputes it.
 */
export const SEASON_ENDING_MISSED_GAMES_SENTINEL = 10_000;

/** Body-region classification of a seeded injury occurrence. */
export const seasonInjuryTypeSchema = z.enum([
  'lower-body',
  'soft-tissue',
  'upper-body',
  'illness',
]);
export type SeasonInjuryType = z.infer<typeof seasonInjuryTypeSchema>;

/** Recovery severity band; drives the missed-games range and recurrence. */
export const seasonInjurySeveritySchema = z.enum(['minor', 'moderate', 'major', 'season-ending']);
export type SeasonInjurySeverity = z.infer<typeof seasonInjurySeveritySchema>;

/** How an injury entered the league: natural occurrence or risky-rehab failure. */
export const seasonInjurySourceSchema = z.enum(['natural', 'risky-rehab-failure']);
export type SeasonInjurySource = z.infer<typeof seasonInjurySourceSchema>;

/**
 * Deterministic injury record id (`inj-` + 32-hex derived from the named
 * seed path that produced the record), so retries and replays reproduce
 * the exact same records.
 */
export const injuryIdSchema = z.string().regex(/^inj-[0-9a-f]{32}$/);
export type InjuryId = z.infer<typeof injuryIdSchema>;

/**
 * One recorded injury occurrence. `missedGamesTotal` is the severity-range
 * roll (0 for same-game returns); `missedGamesRemaining` counts down per
 * team game and carries `SEASON_ENDING_MISSED_GAMES_SENTINEL` for
 * season-ending injuries. `sameGameReturn` is the 35% minor-before-half
 * eligibility roll; `sameGameReturned` is null until the game resolves it.
 * `actualReturnRound` is the round of the first game after the recovery
 * (null until the player actually returns). `recurrenceWindowRoundsRemaining`
 * (0..10) is positive only after an ACTUAL return (including risky-rehab
 * failure returns). `rehabModifier` records the risky-rehab outcome
 * (-1: success shortens recovery; +1: failure lengthens it; 0: none).
 * `seedPath` names the exact seed stream that produced the record.
 */
export const seasonInjuryRecordSchema = z.object({
  injuryId: injuryIdSchema,
  playerVersionId: playerVersionIdSchema,
  franchiseId: franchiseIdSchema,
  /** The game the injury occurred in (stable scheduled-game id). */
  gameId: seasonGameIdSchema,
  type: seasonInjuryTypeSchema,
  severity: seasonInjurySeveritySchema,
  /** Occurred before halftime (eligible for the same-game-return roll). */
  occurredBeforeHalftime: z.boolean(),
  /** Minor + before halftime + the 35% same-game-return roll. */
  sameGameReturn: z.boolean(),
  /** Null until the game resolves the same-game return. */
  sameGameReturned: z.boolean().nullable(),
  /** 0 for same-game returns; else the severity-range roll. */
  missedGamesTotal: z.number().int().nonnegative(),
  /** Counts down per team game; sentinel for season-ending injuries. */
  missedGamesRemaining: z.number().int().min(0).max(SEASON_ENDING_MISSED_GAMES_SENTINEL),
  /** Round of the first game after recovery; null until the actual return. */
  actualReturnRound: z.number().int().min(0).max(82).nullable(),
  seasonEnding: z.boolean(),
  /** 0 | -1 | +1; the risky-rehab outcome (0 = no rehab applied). */
  rehabModifier: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  /** 0..10; >0 only after an actual return. */
  recurrenceWindowRoundsRemaining: z.number().int().min(0).max(10),
  /** The named seed path that produced this record. */
  seedPath: z.array(z.string()).min(1),
});
export type SeasonInjuryRecord = z.infer<typeof seasonInjuryRecordSchema>;

/**
 * The run-scoped health state: an append-only list of every recorded
 * injury (schema 1, season-health-v1). Availability per game is derived
 * from these records by the engine, never stored here.
 */
export const seasonHealthStateSchema = z.object({
  schemaVersion: z.literal(1),
  healthVersion: z.literal(SEASON_HEALTH_VERSION),
  injuries: z.array(seasonInjuryRecordSchema),
});
export type SeasonHealthState = z.infer<typeof seasonHealthStateSchema>;

/**
 * Compact per-game injury fact (season-game-summary-v3). `removedClock` is
 * the game clock where the removal applied (period + seconds remaining);
 * `returned` is whether the same-game return resolved; `returnClock` is
 * null until (and unless) the return applies. Carried by every game summary
 * and by retained human-game details for display.
 */
export const seasonCompactInjuryEventSchema = z.object({
  playerVersionId: playerVersionIdSchema,
  side: z.enum(['home', 'away']),
  type: seasonInjuryTypeSchema,
  severity: seasonInjurySeveritySchema,
  removedClock: z.object({
    /** 1-based period. */
    period: z.number().int().min(1).max(12),
    /** Game clock seconds remaining in the period. */
    seconds: z.number().int().min(0).max(720),
  }),
  returned: z.boolean(),
  /** Null until (and unless) the same-game return applies. */
  returnClock: z
    .object({
      /** 1-based period. */
      period: z.number().int().min(1).max(12),
      /** Game clock seconds remaining in the period. */
      seconds: z.number().int().min(0).max(720),
    })
    .nullable(),
});
export type SeasonCompactInjuryEvent = z.infer<typeof seasonCompactInjuryEventSchema>;
