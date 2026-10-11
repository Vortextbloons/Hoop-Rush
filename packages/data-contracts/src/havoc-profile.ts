import { z } from 'zod';
import { eraIdSchema, franchiseIdSchema, playerIdSchema, seasonKeySchema } from './ids.ts';
import { positionUnionSchema } from './positions.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import {
  reconstructedThreePointProfileSchema,
  simulationAnchorsSchema,
  simulationRatingsSchema,
  simulationTendenciesSchema,
} from './simulation.ts';
import { havocAuthoritativeChannelSchema } from './havoc-mutations.ts';

export const havocInstanceIdSchema = z.string().regex(/^hvi-[0-9a-f]{32}$/);
export type HavocInstanceId = z.infer<typeof havocInstanceIdSchema>;

export const havocPlayerProfileSchema = z.object({
  ratings: simulationRatingsSchema,
  tendencies: simulationTendenciesSchema,
  anchors: simulationAnchorsSchema.optional(),
  reconstructedThreePoint: reconstructedThreePointProfileSchema.optional(),
});
export type HavocPlayerProfile = z.infer<typeof havocPlayerProfileSchema>;

export const havocPhysicalSnapshotSchema = z.object({
  heightInches: z.number().int().min(60).max(96).nullable(),
  weightLbs: z.number().int().min(120).max(400).nullable(),
});
export type HavocPhysicalSnapshot = z.infer<typeof havocPhysicalSnapshotSchema>;

export const havocEffectivePhysicalSchema = z.object({
  baselineHeightInches: z.number().int().min(60).max(96),
  baselineHeightSource: z.enum(['source', 'estimated']),
  heightInches: z.number().int().min(50).max(108),
  weightLbs: z.number().int().min(120).max(400).nullable(),
  wingspanDeltaInches: z.number().int().min(0).max(36),
  reachUnits: z.number().min(-2).max(2),
});
export type HavocEffectivePhysical = z.infer<typeof havocEffectivePhysicalSchema>;

export const havocEffectiveProfileSchema = z.object({
  ratings: simulationRatingsSchema,
  tendencies: simulationTendenciesSchema,
  physical: havocEffectivePhysicalSchema,
  authoritativeChannels: z.array(havocAuthoritativeChannelSchema),
});
export type HavocEffectiveProfile = z.infer<typeof havocEffectiveProfileSchema>;

export const havocSourcePlayerSchema = z.object({
  playerId: playerIdSchema,
  playerVersionId: playerVersionIdSchema.nullable(),
  displayName: z.string().min(1).max(96),
  franchiseId: franchiseIdSchema.nullable(),
  eraId: eraIdSchema.nullable(),
  seasonKey: seasonKeySchema.nullable(),
  positions: positionUnionSchema,
  originalOverall: z.number().int().min(0).max(100),
  overallSource: z.enum(['catalog', 'derived']),
  profile: havocPlayerProfileSchema,
  physical: havocPhysicalSnapshotSchema,
});
export type HavocSourcePlayer = z.infer<typeof havocSourcePlayerSchema>;

export const havocClaimKeySchema = z.object({
  playerId: playerIdSchema,
  seasonKey: seasonKeySchema,
});
export type HavocClaimKey = z.infer<typeof havocClaimKeySchema>;

export function havocClaimKeyOf(playerId: string, seasonKey: string): string {
  return `${playerId}::${seasonKey}`;
}
