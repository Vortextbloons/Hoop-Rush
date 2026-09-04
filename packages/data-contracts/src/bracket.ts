import { z } from 'zod';
import { seedSchema } from './ids.ts';
import { difficultyProfileSchema } from './difficulty.ts';
import { opponentTeamSchema } from './opponent.ts';
export const opponentStrengthSchema = z.object({
    evaluationVersion: z.string().min(1).max(64),
    benchmarkVersion: z.string().min(1).max(64),
    sampleCount: z.number().int().positive(),
    winRate: z.number().min(0).max(1),
    percentile: z.number().min(0).max(1),
});
export type OpponentStrength = z.infer<typeof opponentStrengthSchema>;
export const bracketOpponentSchema = opponentTeamSchema.extend({
    strength: opponentStrengthSchema,
});
export type BracketOpponent = z.infer<typeof bracketOpponentSchema>;
export const bracketScheduleEntrySchema = z.object({
    gameNumber: z.number().int().min(1).max(82),
    opponentId: z.string().min(1).max(64),
});
export type BracketScheduleEntry = z.infer<typeof bracketScheduleEntrySchema>;
export const opponentBracketCoreSchema = z.object({
    bracketVersion: z.string().min(1).max(64),
    scheduleVersion: z.string().min(1).max(64),
    opponents: z.array(bracketOpponentSchema).length(30),
    schedule: z.array(bracketScheduleEntrySchema).length(82),
});
export type OpponentBracketCore = z.infer<typeof opponentBracketCoreSchema>;
export const bracketGenerationSchema = z.object({
    seed: seedSchema,
    generationVersion: z.string().min(1).max(64),
    dataVersion: z.string().min(1).max(64),
    targetBands: z.object({
        teamPercentileBand: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
        leagueMedianPercentileBand: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
    }),
});
export type BracketGeneration = z.infer<typeof bracketGenerationSchema>;
export const opponentBracketSchema = opponentBracketCoreSchema.extend({
    schemaVersion: z.literal(1),
    difficulty: difficultyProfileSchema,
    generation: bracketGenerationSchema,
});
export type OpponentBracket = z.infer<typeof opponentBracketSchema>;
