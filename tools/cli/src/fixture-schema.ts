import { z } from 'zod';
import { seasonGameSimulationInputSchema, seasonRotationPresetSchema, simulationTeamSchema, } from '@hoop-rush/data-contracts';
export const simFixtureSchema = z.object({
    schemaVersion: z.literal(2),
    fixtureId: z.string().min(1).max(64),
    description: z.string().min(1).max(256),
    home: simulationTeamSchema,
    away: simulationTeamSchema,
    variantHome: simulationTeamSchema.optional(),
    variantAway: simulationTeamSchema.optional(),
    variantParameters: z.record(z.string(), z.number()).optional(),
});
export type SimFixture = z.infer<typeof simFixtureSchema>;
export const seasonGameFixtureSchema = z.object({
    schemaVersion: z.literal(1),
    fixtureId: z.string().min(1).max(64),
    description: z.string().min(1).max(256),
    preset: seasonRotationPresetSchema.optional(),
    input: seasonGameSimulationInputSchema,
});
export type SeasonGameFixture = z.infer<typeof seasonGameFixtureSchema>;
