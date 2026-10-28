import { z } from 'zod';
import { contentHashSchema } from './ids.ts';

export const CAP_RUSH_SCHEMA_VERSION = 1;
export const CAP_RUSH_RULES_VERSION = 'cap-rush-rules-v1';
export const CAP_RUSH_SALARY_CURVE_VERSION = 'cap-rush-salary-v1';
export const CAP_RUSH_SEED_DERIVATION_VERSION = 'cap-rush-seeds-v1';
export const CAP_RUSH_REPORT_VERSION = 'cap-rush-report-v1';
export const CAP_RUSH_GAME_COUNT = 82;
export const CAP_RUSH_DRAFT_ROUNDS = 5;
export const CAP_RUSH_OFFER_SIZE = 8;
export const CAP_RUSH_REROLL_LIMIT = 2;
export const CAP_RUSH_MIN_OVERALL = 60;
export const CAP_RUSH_MAX_OVERALL = 99;
export const CAP_RUSH_CAP_LINE_DOLLARS = 120_000_000;
export const CAP_RUSH_FIRST_APRON_DOLLARS = 135_000_000;
export const CAP_RUSH_HARD_LIMIT_DOLLARS = 150_000_000;
export const CAP_RUSH_SEED_ROOT = 'cap-rush-v1';

export const capRushVariantSchema = z.enum(['clash', 'roulette']);
export type CapRushVariant = z.infer<typeof capRushVariantSchema>;

export const capRushPayrollStatusSchema = z.enum([
  'under-cap',
  'first-apron',
  'second-apron',
  'illegal',
]);
export type CapRushPayrollStatus = z.infer<typeof capRushPayrollStatusSchema>;

export const capRushBucketSchema = z.enum(['star', 'strong', 'rotation', 'budget', 'wildcard']);
export type CapRushBucket = z.infer<typeof capRushBucketSchema>;

export interface CapRushSalaryAnchor {
  readonly overall: number;
  readonly thousands: number;
}

export const CAP_RUSH_SALARY_ANCHORS: readonly CapRushSalaryAnchor[] = [
  { overall: 60, thousands: 3_000 },
  { overall: 65, thousands: 4_000 },
  { overall: 70, thousands: 5_000 },
  { overall: 75, thousands: 8_000 },
  { overall: 80, thousands: 13_000 },
  { overall: 85, thousands: 20_000 },
  { overall: 90, thousands: 30_000 },
  { overall: 95, thousands: 46_000 },
  { overall: 98, thousands: 60_000 },
  { overall: 99, thousands: 66_000 },
];

export interface CapRushOfferBucketRule {
  readonly bucket: CapRushBucket;
  readonly count: number;
  readonly minOverall: number;
  readonly maxOverall: number;
}

export const CAP_RUSH_OFFER_RECIPE: readonly CapRushOfferBucketRule[] = [
  { bucket: 'star', count: 1, minOverall: 90, maxOverall: 99 },
  { bucket: 'strong', count: 2, minOverall: 80, maxOverall: 89 },
  { bucket: 'rotation', count: 2, minOverall: 75, maxOverall: 79 },
  { bucket: 'budget', count: 2, minOverall: 60, maxOverall: 74 },
  { bucket: 'wildcard', count: 1, minOverall: 60, maxOverall: 99 },
];

export interface CapRushSpinPurchase {
  readonly priceDollars: number;
  readonly maxEligiblePayrollDollars: number;
  readonly tierOdds: {
    readonly 1: number;
    readonly 2: number;
    readonly 3: number;
  };
}

export const CAP_RUSH_SPIN_PURCHASES = {
  standard: {
    priceDollars: 15_000_000,
    maxEligiblePayrollDollars: 105_000_000,
    tierOdds: { 1: 0.6, 2: 0.3, 3: 0.1 },
  },
  premium: {
    priceDollars: 30_000_000,
    maxEligiblePayrollDollars: 90_000_000,
    tierOdds: { 1: 0.35, 2: 0.4, 3: 0.25 },
  },
} as const satisfies Record<'standard' | 'premium', CapRushSpinPurchase>;

export const capRushSpinPurchaseSchema = z.enum(['standard', 'premium']);
export type CapRushSpinPurchaseId = z.infer<typeof capRushSpinPurchaseSchema>;

export const capRushDigestSchema = z.string().regex(/^[0-9a-f]{32}$/);
export type CapRushDigest = z.infer<typeof capRushDigestSchema>;

export const capRushVersionSetSchema = z.object({
  schemaVersion: z.literal(CAP_RUSH_SCHEMA_VERSION),
  rulesVersion: z.literal(CAP_RUSH_RULES_VERSION),
  salaryCurveVersion: z.literal(CAP_RUSH_SALARY_CURVE_VERSION),
  seedDerivationVersion: z.literal(CAP_RUSH_SEED_DERIVATION_VERSION),
  engineVersion: z.string().min(1).max(64),
  profileVersion: z.string().min(1).max(64),
  dataVersion: z.string().min(1).max(64),
  catalogVersion: z.string().min(1).max(64),
  catalogHash: contentHashSchema,
  bracketHash: contentHashSchema,
  profileHash: contentHashSchema,
});
export type CapRushVersionSet = z.infer<typeof capRushVersionSetSchema>;
