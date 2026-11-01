import { z } from 'zod';
import { contentHashSchema } from './ids.ts';
import {
  CAP_RUSH_CAP_LINE_DOLLARS,
  CAP_RUSH_HARD_LIMIT_DOLLARS,
  capRushBucketSchema,
  capRushVariantSchema,
} from './cap-rush-versions.ts';

export const CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION = 1;
export const CAP_RUSH_MULTIPLAYER_VERSION = 'cap-rush-multiplayer-v2';
export const CAP_RUSH_MULTIPLAYER_RULES_VERSION = 'cap-rush-multiplayer-rules-v3';
export const CAP_RUSH_MULTIPLAYER_MARKET_VERSION = 'cap-rush-multiplayer-market-v1';
export const CAP_RUSH_MULTIPLAYER_PRICING_VERSION = 'cap-rush-multiplayer-pricing-v1';
export const CAP_RUSH_MULTIPLAYER_SEED_DERIVATION_VERSION = 'cap-rush-multiplayer-seeds-v1';
export const CAP_RUSH_MULTIPLAYER_SEED_ROOT = 'cap-rush-multiplayer-v1';
export const CAP_RUSH_MULTIPLAYER_SAVE_SCHEMA_VERSION = 1;
export const CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION = 1;
export const CAP_RUSH_MULTIPLAYER_POSTSEASON_VERSION = 'cap-rush-multiplayer-postseason-v1';
export const CAP_RUSH_MULTIPLAYER_REPORT_VERSION = 'cap-rush-multiplayer-report-v1';

export const CAP_RUSH_MULTIPLAYER_SEAT_COUNT = 2;
export const CAP_RUSH_MULTIPLAYER_MARKET_SIZE = 60;
export const CAP_RUSH_MULTIPLAYER_POOL_SIZE = 12;
export const CAP_RUSH_MULTIPLAYER_AUCTION_MS = 60_000;
export const CAP_RUSH_MULTIPLAYER_MIN_EXTENSION_MS = 10_000;
export const CAP_RUSH_MULTIPLAYER_BID_INCREMENT_DOLLARS = 100_000;
export const CAP_RUSH_MULTIPLAYER_MAX_GENERATION_ATTEMPTS = 128;
export const CAP_RUSH_MULTIPLAYER_HUMAN_GAMES = 162;
export const CAP_RUSH_MULTIPLAYER_AI_GAMES = 1068;
export const CAP_RUSH_MULTIPLAYER_LEAGUE_GAMES = 1230;
export const CAP_RUSH_MULTIPLAYER_DISCOUNT_BELOW_90 = 65;
export const CAP_RUSH_MULTIPLAYER_DISCOUNT_AT_LEAST_90 = 35;
export const CAP_RUSH_MULTIPLAYER_HARD_LIMIT_DOLLARS = CAP_RUSH_HARD_LIMIT_DOLLARS;
export const CAP_RUSH_MULTIPLAYER_CAP_LINE_DOLLARS = CAP_RUSH_CAP_LINE_DOLLARS;
export const CAP_RUSH_MULTIPLAYER_BLOCK_ENDPOINTS = [20, 40, 60, 82] as const;
export const CAP_RUSH_MULTIPLAYER_BLOCK_COUNT = CAP_RUSH_MULTIPLAYER_BLOCK_ENDPOINTS.length;

export const capRushMultiplayerSeatIdSchema = z.enum(['p1', 'p2']);
export type CapRushMultiplayerSeatId = z.infer<typeof capRushMultiplayerSeatIdSchema>;

export const capRushMultiplayerVariantSchema = capRushVariantSchema;
export type CapRushMultiplayerVariant = z.infer<typeof capRushMultiplayerVariantSchema>;

export const capRushMultiplayerPhaseSchema = z.enum([
  'lobby',
  'recruiting',
  'preparation',
  'locking',
  'season',
  'postseason',
  'completed',
  'integrity-failed',
  'expired',
]);
export type CapRushMultiplayerPhase = z.infer<typeof capRushMultiplayerPhaseSchema>;

export const capRushMultiplayerBlockChoiceSchema = z.enum(['sim', 'simcast']);
export type CapRushMultiplayerBlockChoice = z.infer<typeof capRushMultiplayerBlockChoiceSchema>;

export interface CapRushMultiplayerBucketRule {
  readonly bucket: z.infer<typeof capRushBucketSchema>;
  readonly count: number;
  readonly minOverall: number;
  readonly maxOverall: number;
}

export const CAP_RUSH_MULTIPLAYER_BUCKET_RECIPE: readonly CapRushMultiplayerBucketRule[] = [
  { bucket: 'elite', count: 2, minOverall: 95, maxOverall: 99 },
  { bucket: 'star', count: 2, minOverall: 90, maxOverall: 99 },
  { bucket: 'strong', count: 2, minOverall: 80, maxOverall: 89 },
  { bucket: 'rotation', count: 2, minOverall: 75, maxOverall: 79 },
  { bucket: 'budget', count: 2, minOverall: 60, maxOverall: 74 },
  { bucket: 'wildcard', count: 2, minOverall: 40, maxOverall: 99 },
];

export const capRushMultiplayerVersionLocksSchema = z.object({
  schemaVersion: z.literal(CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION),
  multiplayerVersion: z.literal(CAP_RUSH_MULTIPLAYER_VERSION),
  rulesVersion: z.literal(CAP_RUSH_MULTIPLAYER_RULES_VERSION),
  marketVersion: z.literal(CAP_RUSH_MULTIPLAYER_MARKET_VERSION),
  pricingVersion: z.literal(CAP_RUSH_MULTIPLAYER_PRICING_VERSION),
  seedDerivationVersion: z.literal(CAP_RUSH_MULTIPLAYER_SEED_DERIVATION_VERSION),
  engineVersion: z.string().min(1).max(64),
  profileVersion: z.string().min(1).max(64),
  dataVersion: z.string().min(1).max(64),
  catalogVersion: z.string().min(1).max(64),
  catalogHash: contentHashSchema,
  bracketHash: contentHashSchema,
  profileHash: contentHashSchema,
});
export type CapRushMultiplayerVersionLocks = z.infer<typeof capRushMultiplayerVersionLocksSchema>;

export const capRushMultiplayerSettingsSchema = z.object({
  schemaVersion: z.literal(CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION),
  variant: capRushMultiplayerVariantSchema,
  versionLocks: capRushMultiplayerVersionLocksSchema,
});
export type CapRushMultiplayerSettings = z.infer<typeof capRushMultiplayerSettingsSchema>;

export const capRushMultiplayerSetupSchema = z.object({
  variant: capRushMultiplayerVariantSchema,
});
export type CapRushMultiplayerSetup = z.infer<typeof capRushMultiplayerSetupSchema>;
