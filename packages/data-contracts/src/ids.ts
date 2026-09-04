import { z } from 'zod';
function makeIdSchema<B extends string>() {
    return z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9][a-z0-9._:-]*$/)
        .brand<B>();
}
export const idSchema = makeIdSchema<'Id'>();
export type Id = z.infer<typeof idSchema>;
export const commandIdSchema = makeIdSchema<'CommandId'>();
export type CommandId = z.infer<typeof commandIdSchema>;
export const seasonGameIdSchema = z
    .string()
    .regex(/^s[0-9]{6}$/)
    .brand<'SeasonGameId'>();
export type SeasonGameId = z.infer<typeof seasonGameIdSchema>;
export const playerIdSchema = makeIdSchema<'PlayerId'>();
export type PlayerId = z.infer<typeof playerIdSchema>;
export const franchiseIdSchema = makeIdSchema<'FranchiseId'>();
export type FranchiseId = z.infer<typeof franchiseIdSchema>;
export const eraIdSchema = makeIdSchema<'EraId'>();
export type EraId = z.infer<typeof eraIdSchema>;
export const seasonKeySchema = z
    .string()
    .regex(/^(19|20)\d{2}-\d{2}$/)
    .brand<'SeasonKey'>();
export type SeasonKey = z.infer<typeof seasonKeySchema>;
export const playerExternalIdSchema = z.string().regex(/^\d{1,12}$/);
export type PlayerExternalId = z.infer<typeof playerExternalIdSchema>;
export const teamExternalIdSchema = z.string().regex(/^\d{1,12}$/);
export type TeamExternalId = z.infer<typeof teamExternalIdSchema>;
export const bbrefIdSchema = z.string().regex(/^[a-z0-9]{6,12}$/);
export type BbrefId = z.infer<typeof bbrefIdSchema>;
export const seedSchema = z
    .string()
    .regex(/^[0-9a-f]{16,64}$/)
    .brand<'Seed'>();
export type Seed = z.infer<typeof seedSchema>;
export const contentHashSchema = z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .brand<'ContentHash'>();
export type ContentHash = z.infer<typeof contentHashSchema>;
