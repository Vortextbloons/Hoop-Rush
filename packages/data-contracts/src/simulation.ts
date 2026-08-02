import { z } from 'zod';
import { playerIdSchema, seedSchema } from './ids.js';
import { positionUnionSchema } from './positions.js';
import { eraSimulationProfileSchema } from './era-sim-profile.js';

/**
 * M2 possession-engine contracts. The engine consumes only these explicit
 * versions of players and teams — never summary Overall ratings and never the
 * open-ended `detailedRatings`/`tendencies` records of the pool artifacts.
 * Player-season records are adapted to `SimulationPlayer` at the application
 * boundary; the engine never reads pool JSON directly.
 *
 * Mirror matchups stay correct because every simulated side is a distinct
 * `SimulationTeam` instance even when the same playerId appears on both teams.
 */

/** The frozen set of possession-relevant ratings the engine may consume (0-100). */
export const simulationRatingsSchema = z
  .object({
    insideScoring: z.number().int().min(0).max(100),
    closeShot: z.number().int().min(0).max(100),
    midrange: z.number().int().min(0).max(100),
    threePoint: z.number().int().min(0).max(100),
    freeThrow: z.number().int().min(0).max(100),
    ballHandling: z.number().int().min(0).max(100),
    passing: z.number().int().min(0).max(100),
    offensiveIq: z.number().int().min(0).max(100),
    offensiveRebound: z.number().int().min(0).max(100),
    defensiveRebound: z.number().int().min(0).max(100),
    perimeterDefense: z.number().int().min(0).max(100),
    interiorDefense: z.number().int().min(0).max(100),
    steal: z.number().int().min(0).max(100),
    block: z.number().int().min(0).max(100),
    defensiveIq: z.number().int().min(0).max(100),
    speed: z.number().int().min(0).max(100),
    strength: z.number().int().min(0).max(100),
    vertical: z.number().int().min(0).max(100),
  })
  .strict();
export type SimulationRatings = z.infer<typeof simulationRatingsSchema>;

/** The frozen set of possession-relevant tendencies the engine may consume. */
export const simulationTendenciesSchema = z
  .object({
    usageRate: z.number().min(0).max(100),
    passRate: z.number().min(0).max(100),
    shotRate: z.number().min(0).max(100),
    driveRate: z.number().min(0).max(100),
    postUpRate: z.number().min(0).max(100),
    rimFrequency: z.number().min(0).max(100),
    shortMidFrequency: z.number().min(0).max(100),
    longMidFrequency: z.number().min(0).max(100),
    cornerThreeFrequency: z.number().min(0).max(100),
    aboveBreakThreeFrequency: z.number().min(0).max(100),
    threePointRate: z.number().min(0).max(100),
    freeThrowRate: z.number().min(0).max(100),
    turnoverRate: z.number().min(0).max(100),
    isolationRate: z.number().min(0).max(100),
    pickAndRollBallHandlerRate: z.number().min(0).max(100),
    pickAndRollRollManRate: z.number().min(0).max(100),
    spotUpRate: z.number().min(0).max(100),
    transitionRate: z.number().min(0).max(100),
    cutRate: z.number().min(0).max(100),
    foulRate: z.number().min(0).max(100),
    stealAttemptRate: z.number().min(0).max(100),
    blockAttemptRate: z.number().min(0).max(100),
    crashOffensiveGlassRate: z.number().min(0).max(100),
  })
  .strict();
export type SimulationTendencies = z.infer<typeof simulationTendenciesSchema>;

/**
 * Observed player-season anchors used by the possession engine. These are
 * deliberately separate from ratings: ratings describe transferable ability,
 * while anchors preserve what the player actually did in the selected season.
 * Low-sample values are shrunk during import before they reach this boundary.
 */
export const simulationAnchorsSchema = z.object({
  gamesPlayed: z.number().int().nonnegative(),
  minutesPerGame: z.number().min(0).max(60),
  pointsPerGame: z.number().nonnegative(),
  reboundsPerGame: z.number().nonnegative(),
  offensiveReboundsPerGame: z.number().nonnegative(),
  defensiveReboundsPerGame: z.number().nonnegative(),
  assistsPerGame: z.number().nonnegative(),
  stealsPerGame: z.number().nonnegative(),
  blocksPerGame: z.number().nonnegative(),
  turnoversPerGame: z.number().nonnegative(),
  fieldGoalPct: z.number().min(0).max(1),
  threePointPct: z.number().min(0).max(1).nullable(),
  freeThrowPct: z.number().min(0).max(1),
  threePointAttemptRate: z.number().min(0).max(1),
  freeThrowAttemptRate: z.number().min(0).max(1),
});
export type SimulationAnchors = z.infer<typeof simulationAnchorsSchema>;

/** One player exactly as the possession engine sees them. */
export const simulationPlayerSchema = z.object({
  playerId: playerIdSchema,
  displayName: z.string().min(1).max(96),
  /** Career-wide canonical position union; slot legality was validated upstream. */
  positions: positionUnionSchema,
  heightInches: z.number().int().min(60).max(96).nullable(),
  weightLbs: z.number().int().min(120).max(400).nullable(),
  ratings: simulationRatingsSchema,
  tendencies: simulationTendenciesSchema,
  /** Optional for authored opponents and legacy fixtures without source stats. */
  anchors: simulationAnchorsSchema.optional(),
});
export type SimulationPlayer = z.infer<typeof simulationPlayerSchema>;

/** One fixed five-player side. Team side identity is a runtime boundary: two
 * sides may legally share the same playerId (mirror matchups). */
export const simulationTeamSchema = z.object({
  teamId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  players: z.array(simulationPlayerSchema).length(5),
});
export type SimulationTeam = z.infer<typeof simulationTeamSchema>;

/** Everything needed to reproduce one game: seed, game number, versions, era
 * profile, and both fixed lineups. Engine version is injected through
 * EngineContext. The game number is explicit so challenge results are
 * numbered by the shared schedule (spec/01) rather than inferred. */
export const gameSimulationInputSchema = z.object({
  schemaVersion: z.literal(2),
  seed: seedSchema,
  /** 1-based game number inside the shared 82-game challenge schedule. */
  gameNumber: z.number().int().min(1).max(82),
  dataVersion: z.string().min(1).max(64),
  profile: eraSimulationProfileSchema,
  home: simulationTeamSchema,
  away: simulationTeamSchema,
});
export type GameSimulationInput = z.infer<typeof gameSimulationInputSchema>;
