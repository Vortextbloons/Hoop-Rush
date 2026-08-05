import { z } from 'zod';
import { seedSchema } from './ids.ts';
import { difficultyProfileSchema } from './difficulty.ts';
import { opponentTeamSchema } from './opponent.ts';

/**
 * The fixed, versioned opponent bracket (spec/01, spec/02). One artifact
 * contains all 30 franchise identities with authored five-player lineups,
 * the measured strength evidence for each entry, and the shared 82-game
 * schedule. Runtime challenge creation loads this artifact as a unit; it is
 * never regenerated during gameplay.
 */

/** Measured strength evidence recorded at authoring time (spec/06 difficulty
 * calibration). Percentiles are computed against the generation candidate
 * population, so audit reports verify bands without re-simulating. */
export const opponentStrengthSchema = z.object({
  /** Version of the measurement procedure that produced the values. */
  evaluationVersion: z.string().min(1).max(64),
  /** Version of the fixed benchmark matrix used for measurement. */
  benchmarkVersion: z.string().min(1).max(64),
  /** Seeded games used for the measurement. */
  sampleCount: z.number().int().positive(),
  /** Weighted win rate against the weak/medium/strong benchmark matrix. */
  winRate: z.number().min(0).max(1),
  /** Rank percentile (0..1) within the candidate population. */
  percentile: z.number().min(0).max(1),
});
export type OpponentStrength = z.infer<typeof opponentStrengthSchema>;

/** One bracket entry: an authored opponent plus its measured strength. */
export const bracketOpponentSchema = opponentTeamSchema.extend({
  strength: opponentStrengthSchema,
});
export type BracketOpponent = z.infer<typeof bracketOpponentSchema>;

/** One fixed schedule position referencing a bracket opponent by id. */
export const bracketScheduleEntrySchema = z.object({
  gameNumber: z.number().int().min(1).max(82),
  opponentId: z.string().min(1).max(64),
});
export type BracketScheduleEntry = z.infer<typeof bracketScheduleEntrySchema>;

/** The immutable bracket content every run snapshots (spec/04 minimal run state). */
export const opponentBracketCoreSchema = z.object({
  bracketVersion: z.string().min(1).max(64),
  scheduleVersion: z.string().min(1).max(64),
  opponents: z.array(bracketOpponentSchema).length(30),
  schedule: z.array(bracketScheduleEntrySchema).length(82),
});
export type OpponentBracketCore = z.infer<typeof opponentBracketCoreSchema>;

/** Committed generation record so regeneration is byte-identical (spec/01). */
export const bracketGenerationSchema = z.object({
  /** Seeded generation seed; regenerating with it reproduces this artifact. */
  seed: seedSchema,
  /** Version of the generation procedure (proposal, measurement, selection). */
  generationVersion: z.string().min(1).max(64),
  /** Static data version consumed by the generation. */
  dataVersion: z.string().min(1).max(64),
  /** Target strength bands used by selection. */
  targetBands: z.object({
    teamPercentileBand: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
    leagueMedianPercentileBand: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
  }),
});
export type BracketGeneration = z.infer<typeof bracketGenerationSchema>;

/** The complete frozen bracket artifact (spec/02 opponent bracket artifact). */
export const opponentBracketSchema = opponentBracketCoreSchema.extend({
  schemaVersion: z.literal(1),
  /** Versioned medium-difficulty profile shipped with the bracket. */
  difficulty: difficultyProfileSchema,
  generation: bracketGenerationSchema,
});
export type OpponentBracket = z.infer<typeof opponentBracketSchema>;
