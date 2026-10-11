import { z } from 'zod';
import { contentHashSchema } from './ids.ts';

export const HAVOC_SCHEMA_VERSION = 1;
export const HAVOC_RULES_VERSION = 'havoc-rules-v1';
export const HAVOC_MUTATION_CATALOG_VERSION = 'havoc-mutations-v1';
export const HAVOC_SEED_DERIVATION_VERSION = 'havoc-seeds-v1';
export const HAVOC_COMPARISON_VERSION = 'havoc-comparison-v1';
export const HAVOC_REPORT_VERSION = 'havoc-report-v1';
export const HAVOC_MVP_INDEX_VERSION = 'havoc-mvp-index-v1';
export const HAVOC_WORKER_WIRE_SCHEMA_VERSION = 1;
export const HAVOC_SAVE_SCHEMA_VERSION = 1;
export const HAVOC_GAME_COUNT = 82;
export const HAVOC_DRAFT_ROUNDS = 5;
export const HAVOC_OFFER_SIZE = 3;
export const HAVOC_REROLL_LIMIT = 1;
export const HAVOC_OVERALL_WINDOW_WIDTH = 3;
export const HAVOC_PERSONAL_FOUL_LIMIT = 6;
export const HAVOC_RETAINED_TAPE_LIMIT = 5;
export const HAVOC_MAX_ACTIVE_PARTICIPANTS = 10;
export const HAVOC_MAX_PARTICIPANTS_PER_TEAM = 15;
export const HAVOC_SEED_ROOT = 'havoc-v1';
export const HAVOC_TIER_PROBABILITIES = {
  1: 0.6,
  2: 0.3,
  3: 0.1,
} as const;
export const HAVOC_MVP_INDEX_WEIGHTS = {
  points: 10,
  rebounds: 12,
  assists: 15,
  steals: 30,
  blocks: 30,
  turnovers: -10,
} as const;
export const HAVOC_ESTIMATED_HEIGHT_BY_SLOT = {
  PG: 74,
  SG: 77,
  SF: 80,
  PF: 82,
  C: 84,
} as const;

export const havocDigestSchema = z.string().regex(/^[0-9a-f]{32}$/);
export type HavocDigest = z.infer<typeof havocDigestSchema>;

export const havocVersionSetSchema = z.object({
  schemaVersion: z.literal(HAVOC_SCHEMA_VERSION),
  rulesVersion: z.literal(HAVOC_RULES_VERSION),
  mutationCatalogVersion: z.literal(HAVOC_MUTATION_CATALOG_VERSION),
  seedDerivationVersion: z.literal(HAVOC_SEED_DERIVATION_VERSION),
  engineVersion: z.string().min(1).max(64),
  profileVersion: z.string().min(1).max(64),
  dataVersion: z.string().min(1).max(64),
  catalogVersion: z.string().min(1).max(64),
  catalogHash: contentHashSchema,
  bracketHash: contentHashSchema,
  profileHash: contentHashSchema,
});
export type HavocVersionSet = z.infer<typeof havocVersionSetSchema>;
