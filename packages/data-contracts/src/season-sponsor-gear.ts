import { z } from 'zod';
import { commandIdSchema, contentHashSchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_SPONSOR_GEAR_VERSION } from './season-versions.ts';

export const seasonSponsorSlotSchema = z.enum(['shoe', 'apparel', 'fuel']);
export type SeasonSponsorSlot = z.infer<typeof seasonSponsorSlotSchema>;
export const SEASON_SPONSOR_SLOTS = ['shoe', 'apparel', 'fuel'] as const;

export const seasonSponsorTierSchema = z.enum(['BUZZ', 'PRIME', 'ICON']);
export type SeasonSponsorTier = z.infer<typeof seasonSponsorTierSchema>;

export const SEASON_SPONSOR_GEAR_TIERS = {
  BUZZ: { price: 1, poolMin: 5, poolMax: 8, statMin: 1, statMax: 2, singleKeyCap: 6, weight: 55 },
  PRIME: {
    price: 2,
    poolMin: 9,
    poolMax: 13,
    statMin: 1,
    statMax: 3,
    singleKeyCap: 9,
    weight: 32,
  },
  ICON: {
    price: 3,
    poolMin: 14,
    poolMax: 18,
    statMin: 1,
    statMax: 3,
    singleKeyCap: 12,
    weight: 13,
  },
} as const;
export type SeasonSponsorTierConfig =
  (typeof SEASON_SPONSOR_GEAR_TIERS)[keyof typeof SEASON_SPONSOR_GEAR_TIERS];

export function sponsorGearTierConfigOf(tier: SeasonSponsorTier): SeasonSponsorTierConfig {
  return SEASON_SPONSOR_GEAR_TIERS[tier];
}

export function sponsorGearPriceOf(tier: SeasonSponsorTier): number {
  return SEASON_SPONSOR_GEAR_TIERS[tier].price;
}

export const seasonSponsorBoostKeySchema = z.enum([
  'speed',
  'ballHandling',
  'vertical',
  'steal',
  'midrange',
  'strength',
  'threePoint',
  'perimeterDefense',
  'interiorDefense',
  'block',
  'offensiveRebound',
  'defensiveRebound',
  'freeThrow',
]);
export type SeasonSponsorBoostKey = z.infer<typeof seasonSponsorBoostKeySchema>;

export const seasonSponsorBoostSchema = z.object({
  key: seasonSponsorBoostKeySchema,
  points: z.number().int().min(1).max(12),
});
export type SeasonSponsorBoost = z.infer<typeof seasonSponsorBoostSchema>;

export const seasonSponsorBrandWeightSchema = z.object({
  key: seasonSponsorBoostKeySchema,
  weight: z.number().positive(),
});
export type SeasonSponsorBrandWeight = z.infer<typeof seasonSponsorBrandWeightSchema>;

export const seasonSponsorGearCatalogEntrySchema = z.object({
  entryId: z.string().min(1).max(64),
  brandFamily: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  slot: seasonSponsorSlotSchema,
  tier: seasonSponsorTierSchema,
  version: z.literal(SEASON_SPONSOR_GEAR_VERSION),
  eligible: z.array(seasonSponsorBrandWeightSchema).min(1).max(6),
});
export type SeasonSponsorGearCatalogEntry = z.infer<typeof seasonSponsorGearCatalogEntrySchema>;

type GearCatalogSeed = {
  entryId: string;
  brandFamily: string;
  displayName: string;
  slot: SeasonSponsorSlot;
  tier: SeasonSponsorTier;
  eligible: readonly (readonly [SeasonSponsorBoostKey, number])[];
};

const GEAR_CATALOG_SEEDS: readonly GearCatalogSeed[] = [
  {
    entryId: 'nike-icon',
    brandFamily: 'nike',
    displayName: 'Nike',
    slot: 'shoe',
    tier: 'ICON',
    eligible: [
      ['speed', 3],
      ['vertical', 3],
      ['ballHandling', 1],
      ['steal', 1],
    ],
  },
  {
    entryId: 'jordan-icon',
    brandFamily: 'jordan',
    displayName: 'Jordan',
    slot: 'shoe',
    tier: 'ICON',
    eligible: [
      ['speed', 3],
      ['midrange', 2],
      ['ballHandling', 2],
      ['vertical', 1],
    ],
  },
  {
    entryId: 'adidas-icon',
    brandFamily: 'adidas',
    displayName: 'Adidas',
    slot: 'shoe',
    tier: 'ICON',
    eligible: [
      ['speed', 3],
      ['ballHandling', 3],
      ['vertical', 1],
      ['steal', 1],
    ],
  },
  {
    entryId: 'li-ning-prime',
    brandFamily: 'li-ning',
    displayName: 'Li-Ning',
    slot: 'shoe',
    tier: 'PRIME',
    eligible: [
      ['vertical', 3],
      ['steal', 2],
      ['speed', 2],
      ['ballHandling', 1],
    ],
  },
  {
    entryId: 'anta-prime',
    brandFamily: 'anta',
    displayName: 'Anta',
    slot: 'shoe',
    tier: 'PRIME',
    eligible: [
      ['speed', 3],
      ['vertical', 2],
      ['ballHandling', 1],
      ['steal', 1],
    ],
  },
  {
    entryId: 'puma-prime',
    brandFamily: 'puma',
    displayName: 'Puma',
    slot: 'shoe',
    tier: 'PRIME',
    eligible: [
      ['vertical', 3],
      ['speed', 2],
      ['steal', 1],
      ['ballHandling', 1],
    ],
  },
  {
    entryId: 'reebok-buzz',
    brandFamily: 'reebok',
    displayName: 'Reebok',
    slot: 'shoe',
    tier: 'BUZZ',
    eligible: [
      ['strength', 3],
      ['speed', 2],
      ['vertical', 1],
      ['ballHandling', 1],
    ],
  },
  {
    entryId: 'new-balance-buzz',
    brandFamily: 'new-balance',
    displayName: 'New Balance',
    slot: 'shoe',
    tier: 'BUZZ',
    eligible: [
      ['speed', 2],
      ['vertical', 2],
      ['ballHandling', 1],
      ['steal', 1],
    ],
  },
  {
    entryId: 'converse-buzz',
    brandFamily: 'converse',
    displayName: 'Converse',
    slot: 'shoe',
    tier: 'BUZZ',
    eligible: [
      ['ballHandling', 3],
      ['speed', 2],
      ['steal', 1],
      ['vertical', 1],
    ],
  },
  {
    entryId: 'asics-buzz',
    brandFamily: 'asics',
    displayName: 'Asics',
    slot: 'shoe',
    tier: 'BUZZ',
    eligible: [
      ['speed', 3],
      ['ballHandling', 1],
      ['vertical', 1],
      ['steal', 1],
    ],
  },
  {
    entryId: 'under-armour-icon',
    brandFamily: 'under-armour',
    displayName: 'Under Armour',
    slot: 'apparel',
    tier: 'ICON',
    eligible: [
      ['interiorDefense', 3],
      ['perimeterDefense', 2],
      ['block', 2],
      ['steal', 1],
    ],
  },
  {
    entryId: 'beats-icon',
    brandFamily: 'beats',
    displayName: 'Beats',
    slot: 'apparel',
    tier: 'ICON',
    eligible: [
      ['threePoint', 3],
      ['midrange', 2],
      ['steal', 1],
      ['perimeterDefense', 1],
    ],
  },
  {
    entryId: 'spalding-icon',
    brandFamily: 'spalding',
    displayName: 'Spalding',
    slot: 'apparel',
    tier: 'ICON',
    eligible: [
      ['interiorDefense', 3],
      ['block', 3],
      ['perimeterDefense', 1],
      ['steal', 1],
    ],
  },
  {
    entryId: 'mitchell-ness-prime',
    brandFamily: 'mitchell-ness',
    displayName: 'Mitchell & Ness',
    slot: 'apparel',
    tier: 'PRIME',
    eligible: [
      ['midrange', 3],
      ['threePoint', 2],
      ['perimeterDefense', 1],
      ['steal', 1],
    ],
  },
  {
    entryId: 'oakley-prime',
    brandFamily: 'oakley',
    displayName: 'Oakley',
    slot: 'apparel',
    tier: 'PRIME',
    eligible: [
      ['perimeterDefense', 3],
      ['steal', 3],
      ['block', 1],
      ['interiorDefense', 1],
    ],
  },
  {
    entryId: 'wilson-prime',
    brandFamily: 'wilson',
    displayName: 'Wilson',
    slot: 'apparel',
    tier: 'PRIME',
    eligible: [
      ['threePoint', 3],
      ['midrange', 1],
      ['steal', 1],
      ['perimeterDefense', 1],
    ],
  },
  {
    entryId: 'hyperice-buzz',
    brandFamily: 'hyperice',
    displayName: 'Hyperice',
    slot: 'apparel',
    tier: 'BUZZ',
    eligible: [
      ['perimeterDefense', 3],
      ['steal', 2],
      ['block', 1],
      ['interiorDefense', 1],
    ],
  },
  {
    entryId: 'champion-buzz',
    brandFamily: 'champion',
    displayName: 'Champion',
    slot: 'apparel',
    tier: 'BUZZ',
    eligible: [
      ['midrange', 3],
      ['threePoint', 1],
      ['perimeterDefense', 1],
      ['steal', 1],
    ],
  },
  {
    entryId: 'stance-buzz',
    brandFamily: 'stance',
    displayName: 'Stance',
    slot: 'apparel',
    tier: 'BUZZ',
    eligible: [
      ['perimeterDefense', 3],
      ['steal', 1],
      ['block', 1],
      ['interiorDefense', 1],
    ],
  },
  {
    entryId: 'new-era-buzz',
    brandFamily: 'new-era',
    displayName: 'New Era',
    slot: 'apparel',
    tier: 'BUZZ',
    eligible: [
      ['steal', 3],
      ['perimeterDefense', 2],
      ['block', 1],
      ['interiorDefense', 1],
    ],
  },
  {
    entryId: 'gatorade-icon',
    brandFamily: 'gatorade',
    displayName: 'Gatorade',
    slot: 'fuel',
    tier: 'ICON',
    eligible: [
      ['strength', 3],
      ['freeThrow', 2],
      ['defensiveRebound', 2],
      ['offensiveRebound', 1],
    ],
  },
  {
    entryId: 'red-bull-icon',
    brandFamily: 'red-bull',
    displayName: 'Red Bull',
    slot: 'fuel',
    tier: 'ICON',
    eligible: [
      ['vertical', 3],
      ['speed', 3],
      ['strength', 1],
      ['offensiveRebound', 1],
    ],
  },
  {
    entryId: 'monster-icon',
    brandFamily: 'monster',
    displayName: 'Monster',
    slot: 'fuel',
    tier: 'ICON',
    eligible: [
      ['strength', 3],
      ['offensiveRebound', 3],
      ['defensiveRebound', 1],
      ['vertical', 1],
    ],
  },
  {
    entryId: 'therabody-prime',
    brandFamily: 'therabody',
    displayName: 'Therabody',
    slot: 'fuel',
    tier: 'PRIME',
    eligible: [
      ['defensiveRebound', 3],
      ['strength', 2],
      ['freeThrow', 1],
      ['offensiveRebound', 1],
    ],
  },
  {
    entryId: 'bodyarmor-prime',
    brandFamily: 'bodyarmor',
    displayName: 'BodyArmor',
    slot: 'fuel',
    tier: 'PRIME',
    eligible: [
      ['defensiveRebound', 3],
      ['strength', 3],
      ['offensiveRebound', 1],
      ['freeThrow', 1],
    ],
  },
  {
    entryId: 'muscle-milk-prime',
    brandFamily: 'muscle-milk',
    displayName: 'Muscle Milk',
    slot: 'fuel',
    tier: 'PRIME',
    eligible: [
      ['strength', 3],
      ['offensiveRebound', 1],
      ['defensiveRebound', 1],
      ['vertical', 1],
    ],
  },
  {
    entryId: 'skratch-buzz',
    brandFamily: 'skratch',
    displayName: 'Skratch',
    slot: 'fuel',
    tier: 'BUZZ',
    eligible: [
      ['defensiveRebound', 3],
      ['offensiveRebound', 2],
      ['strength', 1],
      ['freeThrow', 1],
    ],
  },
  {
    entryId: 'celsius-buzz',
    brandFamily: 'celsius',
    displayName: 'Celsius',
    slot: 'fuel',
    tier: 'BUZZ',
    eligible: [
      ['vertical', 2],
      ['speed', 2],
      ['strength', 1],
      ['freeThrow', 1],
    ],
  },
  {
    entryId: 'powerade-buzz',
    brandFamily: 'powerade',
    displayName: 'Powerade',
    slot: 'fuel',
    tier: 'BUZZ',
    eligible: [
      ['offensiveRebound', 3],
      ['strength', 2],
      ['defensiveRebound', 1],
      ['freeThrow', 1],
    ],
  },
  {
    entryId: 'liquid-iv-buzz',
    brandFamily: 'liquid-iv',
    displayName: 'Liquid I.V.',
    slot: 'fuel',
    tier: 'BUZZ',
    eligible: [
      ['freeThrow', 3],
      ['strength', 1],
      ['defensiveRebound', 1],
      ['offensiveRebound', 1],
    ],
  },
];

export const SEASON_SPONSOR_GEAR_CATALOG: readonly SeasonSponsorGearCatalogEntry[] =
  GEAR_CATALOG_SEEDS.map((seed) =>
    seasonSponsorGearCatalogEntrySchema.parse({
      entryId: seed.entryId,
      brandFamily: seed.brandFamily,
      displayName: seed.displayName,
      slot: seed.slot,
      tier: seed.tier,
      version: SEASON_SPONSOR_GEAR_VERSION,
      eligible: seed.eligible.map(([key, weight]) => ({ key, weight })),
    }),
  );

export function sponsorGearEntryOf(entryId: string): SeasonSponsorGearCatalogEntry {
  const entry = SEASON_SPONSOR_GEAR_CATALOG.find((candidate) => candidate.entryId === entryId);
  if (!entry) throw new Error(`unknown sponsor gear entry ${entryId}`);
  return entry;
}

export function sponsorGearEntriesFor(
  slot: SeasonSponsorSlot,
  tier: SeasonSponsorTier,
): SeasonSponsorGearCatalogEntry[] {
  return SEASON_SPONSOR_GEAR_CATALOG.filter(
    (entry) => entry.slot === slot && entry.tier === tier,
  ).sort((a, b) => (a.entryId < b.entryId ? -1 : 1));
}

export const seasonSponsorOfferSchema = z.object({
  instanceId: z.string().regex(/^sponsor-[0-7]-[0-4]$/),
  entryId: z.string().min(1).max(64),
  brandFamily: z.string().min(1).max(64),
  slot: seasonSponsorSlotSchema,
  tier: seasonSponsorTierSchema,
  boosts: z.array(seasonSponsorBoostSchema).min(1).max(3),
  price: z.number().int().min(1).max(3),
  blockIndex: z.number().int().min(0).max(7),
  expiresAtBlock: z.number().int().min(0).max(7),
});
export type SeasonSponsorOffer = z.infer<typeof seasonSponsorOfferSchema>;

export const seasonSponsorVaultItemSchema = z.object({
  instanceId: z.string().min(1).max(64),
  entryId: z.string().min(1).max(64),
  acquiredBlock: z.number().int().min(0).max(7),
  acquiredByCommandId: commandIdSchema,
});
export type SeasonSponsorVaultItem = z.infer<typeof seasonSponsorVaultItemSchema>;

export const seasonSponsorVaultSchema = z.object({
  schemaVersion: z.literal(1),
  gearVersion: z.literal(SEASON_SPONSOR_GEAR_VERSION),
  items: z.array(seasonSponsorVaultItemSchema).max(40),
});
export type SeasonSponsorVault = z.infer<typeof seasonSponsorVaultSchema>;

export const seasonSponsorBoardSchema = z.object({
  blockIndex: z.number().int().min(0).max(7),
  offers: z.array(seasonSponsorOfferSchema).length(5),
  purchasedInstanceIds: z.array(z.string().min(1).max(64)),
});
export type SeasonSponsorBoard = z.infer<typeof seasonSponsorBoardSchema>;

export const seasonSponsorBoardsSchema = z.object({
  schemaVersion: z.literal(1),
  gearVersion: z.literal(SEASON_SPONSOR_GEAR_VERSION),
  boards: z.array(seasonSponsorBoardSchema).max(8),
});
export type SeasonSponsorBoards = z.infer<typeof seasonSponsorBoardsSchema>;

export const seasonSponsorAppliedSnapshotSchema = z.object({
  instanceId: z.string().min(1).max(64),
  entryId: z.string().min(1).max(64),
  brandFamily: z.string().min(1).max(64),
  slot: seasonSponsorSlotSchema,
  tier: seasonSponsorTierSchema,
  boosts: z.array(seasonSponsorBoostSchema).min(1).max(3),
  appliedBlock: z.number().int().min(0).max(8),
  appliedByCommandId: commandIdSchema,
});
export type SeasonSponsorAppliedSnapshot = z.infer<typeof seasonSponsorAppliedSnapshotSchema>;

export const seasonPlayerSponsorSlotsSchema = z.object({
  shoe: seasonSponsorAppliedSnapshotSchema.nullable(),
  apparel: seasonSponsorAppliedSnapshotSchema.nullable(),
  fuel: seasonSponsorAppliedSnapshotSchema.nullable(),
});
export type SeasonPlayerSponsorSlots = z.infer<typeof seasonPlayerSponsorSlotsSchema>;

export const seasonPlayerSponsorsSchema = z.object({
  schemaVersion: z.literal(1),
  gearVersion: z.literal(SEASON_SPONSOR_GEAR_VERSION),
  slots: z.record(playerVersionIdSchema, seasonPlayerSponsorSlotsSchema),
});
export type SeasonPlayerSponsors = z.infer<typeof seasonPlayerSponsorsSchema>;

export const seasonSponsorGearStateSchema = z.object({
  vault: seasonSponsorVaultSchema,
  boards: seasonSponsorBoardsSchema,
  players: seasonPlayerSponsorsSchema,
});
export type SeasonSponsorGearState = z.infer<typeof seasonSponsorGearStateSchema>;

export function buildEmptySponsorVault(): SeasonSponsorVault {
  return { schemaVersion: 1, gearVersion: SEASON_SPONSOR_GEAR_VERSION, items: [] };
}

export function buildEmptySponsorBoards(): SeasonSponsorBoards {
  return { schemaVersion: 1, gearVersion: SEASON_SPONSOR_GEAR_VERSION, boards: [] };
}

export function buildEmptyPlayerSponsors(): SeasonPlayerSponsors {
  return { schemaVersion: 1, gearVersion: SEASON_SPONSOR_GEAR_VERSION, slots: {} };
}

export function buildEmptySponsorGearState(): SeasonSponsorGearState {
  return {
    vault: buildEmptySponsorVault(),
    boards: buildEmptySponsorBoards(),
    players: buildEmptyPlayerSponsors(),
  };
}

export function normalizeSponsorGearState(state: unknown): SeasonSponsorGearState {
  if (state === undefined || state === null) return buildEmptySponsorGearState();
  const parsed = seasonSponsorGearStateSchema.safeParse(state);
  if (parsed.success) return parsed.data;
  return buildEmptySponsorGearState();
}

export const seasonSponsorLogoEntrySchema = z.object({
  family: z.string().min(1).max(64),
  file: z.string().min(1).max(128),
  contentHash: contentHashSchema,
});
export type SeasonSponsorLogoEntry = z.infer<typeof seasonSponsorLogoEntrySchema>;

export const seasonSponsorsIndexSchema = z.object({
  schemaVersion: z.literal(1),
  gearVersion: z.literal(SEASON_SPONSOR_GEAR_VERSION),
  logos: z.array(seasonSponsorLogoEntrySchema).length(30),
});
export type SeasonSponsorsIndex = z.infer<typeof seasonSponsorsIndexSchema>;
