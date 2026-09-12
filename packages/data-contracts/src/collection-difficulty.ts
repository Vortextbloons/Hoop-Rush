import { z } from 'zod';
import { collectionRaritySchema } from './collection.ts';
import {
  COLLECTION_DIFFICULTY_ORDER,
  COLLECTION_DIFFICULTY_VERSION,
  COLLECTION_RARITY_ORDER,
} from './collection-versions.ts';

export const collectionDifficultyIdSchema = z.enum(COLLECTION_DIFFICULTY_ORDER);
export type CollectionDifficultyId = z.infer<typeof collectionDifficultyIdSchema>;

export const collectionCpuIdentitySchema = z.enum([
  'balanced',
  'shooting',
  'pressure-defense',
  'interior',
]);
export type CollectionCpuIdentity = z.infer<typeof collectionCpuIdentitySchema>;

export const COLLECTION_CPU_IDENTITIES = collectionCpuIdentitySchema.options;

const rarityIndex = new Map<string, number>(
  COLLECTION_RARITY_ORDER.map((rarity, index) => [rarity, index]),
);

function isWithinBand(rarity: string, floor: string, ceiling: string): boolean {
  const index = rarityIndex.get(rarity);
  const low = rarityIndex.get(floor);
  const high = rarityIndex.get(ceiling);
  if (index === undefined || low === undefined || high === undefined) return false;
  return index >= low && index <= high;
}

export const collectionRarityBandSchema = z
  .object({
    floor: collectionRaritySchema,
    ceiling: collectionRaritySchema,
  })
  .strict()
  .superRefine((band, ctx) => {
    const low = rarityIndex.get(band.floor) ?? 0;
    const high = rarityIndex.get(band.ceiling) ?? 0;
    if (low > high) {
      ctx.addIssue({
        code: 'custom',
        message: `rarity band floor ${band.floor} > ceiling ${band.ceiling}`,
      });
    }
  });
export type CollectionRarityBand = z.infer<typeof collectionRarityBandSchema>;

export const collectionRarityWeightSchema = z
  .object({
    rarity: collectionRaritySchema,
    weightBp: z.number().int().nonnegative(),
  })
  .strict();
export type CollectionRarityWeight = z.infer<typeof collectionRarityWeightSchema>;

export const collectionDifficultyRotationPolicySchema = z
  .object({
    starterWeightBp: z.number().int().positive(),
    benchWeightBp: z.number().int().positive(),
    overallBonusFloor: z.number().int().min(0).max(120),
    overallBonusPerPointBp: z.number().int().nonnegative(),
    maxMinutes: z.number().int().min(1).max(48),
    closingFivePolicy: z.enum(['generated-starters', 'best-legal-five']),
  })
  .strict();
export type CollectionDifficultyRotationPolicy = z.infer<
  typeof collectionDifficultyRotationPolicySchema
>;

export const collectionDifficultyProfileSchema = z
  .object({
    difficultyVersion: z.literal(COLLECTION_DIFFICULTY_VERSION),
    difficultyId: collectionDifficultyIdSchema,
    displayName: z.string().min(1).max(32),
    rarityBand: collectionRarityBandSchema,
    rarityWeightsBp: z.array(collectionRarityWeightSchema).min(1),
    specialWeightMultiplierBp: z.number().int().positive(),
    candidateTeams: z.number().int().min(1).max(16),
    identityFitWeightBp: z.number().int().min(0).max(10_000),
    useGeneratedStarters: z.boolean(),
    ratingShift: z.number().int().min(-20).max(20),
    rewardMultiplierBp: z.number().int().positive(),
    rotation: collectionDifficultyRotationPolicySchema,
  })
  .strict()
  .superRefine((profile, ctx) => {
    const seen = new Set<string>();
    let total = 0;
    for (const entry of profile.rarityWeightsBp) {
      if (seen.has(entry.rarity)) {
        ctx.addIssue({ code: 'custom', message: `duplicate rarity weight for ${entry.rarity}` });
      }
      seen.add(entry.rarity);
      if (!isWithinBand(entry.rarity, profile.rarityBand.floor, profile.rarityBand.ceiling)) {
        ctx.addIssue({
          code: 'custom',
          message: `rarity weight ${entry.rarity} is outside the declared band`,
        });
      }
      total += entry.weightBp;
    }
    for (const rarity of COLLECTION_RARITY_ORDER) {
      if (!isWithinBand(rarity, profile.rarityBand.floor, profile.rarityBand.ceiling)) continue;
      if (!seen.has(rarity)) {
        ctx.addIssue({
          code: 'custom',
          message: `missing rarity weight inside the band: ${rarity}`,
        });
      }
    }
    if (total !== 10_000) {
      ctx.addIssue({
        code: 'custom',
        message: `rarity weights sum to ${String(total)} basis points, expected 10000`,
      });
    }
    if (
      profile.useGeneratedStarters &&
      profile.rotation.closingFivePolicy !== 'generated-starters'
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'generated starters must close with the generated starters',
      });
    }
    if (!profile.useGeneratedStarters && profile.rotation.closingFivePolicy !== 'best-legal-five') {
      ctx.addIssue({
        code: 'custom',
        message: 'selected starters must close with the best legal five',
      });
    }
  });
export type CollectionDifficultyProfile = z.infer<typeof collectionDifficultyProfileSchema>;

export function collectionRarityWeightOf(
  profile: CollectionDifficultyProfile,
  rarity: string,
): number {
  const entry = profile.rarityWeightsBp.find((candidate) => candidate.rarity === rarity);
  return entry?.weightBp ?? 0;
}

export function collectionDifficultyProfileOf(
  profiles: readonly CollectionDifficultyProfile[],
  difficultyId: CollectionDifficultyId,
): CollectionDifficultyProfile | undefined {
  return profiles.find((profile) => profile.difficultyId === difficultyId);
}
