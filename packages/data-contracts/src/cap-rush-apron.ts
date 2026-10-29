import { z } from 'zod';
import { positionSchema } from './positions.ts';
import { havocInstanceIdSchema } from './havoc-profile.ts';
import {
  CAP_RUSH_SCHEMA_VERSION,
  capRushPayrollStatusSchema,
  type CapRushPayrollStatus,
} from './cap-rush-versions.ts';

export const CAP_RUSH_CLASH_ISOLATION_EVERY = 6;
export const CAP_RUSH_HERO_BALL_ISOLATION_EVERY = 3;
export const CAP_RUSH_STRIKE_EVERY = 6;

export const capRushApronMechanicSchema = z.enum(['isolation', 'strike']);
export type CapRushApronMechanic = z.infer<typeof capRushApronMechanicSchema>;

export const capRushIsolationReasonSchema = z.enum(['give-me-the-ball', 'hero-ball']);
export type CapRushIsolationReason = z.infer<typeof capRushIsolationReasonSchema>;

export const capRushApronSideSchema = z.enum(['home', 'away']);
export type CapRushApronSide = z.infer<typeof capRushApronSideSchema>;

export const capRushIsolationFactSchema = z.object({
  schemaVersion: z.literal(CAP_RUSH_SCHEMA_VERSION),
  kind: z.literal('isolation'),
  side: capRushApronSideSchema,
  possessionOrdinal: z.number().int().min(1),
  reason: capRushIsolationReasonSchema,
  targetInstanceId: havocInstanceIdSchema,
  targetSlot: positionSchema,
  payrollStatus: capRushPayrollStatusSchema,
});
export type CapRushIsolationFact = z.infer<typeof capRushIsolationFactSchema>;

export const capRushStrikeFactSchema = z.object({
  schemaVersion: z.literal(CAP_RUSH_SCHEMA_VERSION),
  kind: z.literal('strike'),
  side: capRushApronSideSchema,
  possessionOrdinal: z.number().int().min(1),
  targetInstanceId: havocInstanceIdSchema,
  targetSlot: positionSchema,
});
export type CapRushStrikeFact = z.infer<typeof capRushStrikeFactSchema>;

export const capRushApronFactSchema = z.discriminatedUnion('kind', [
  capRushIsolationFactSchema,
  capRushStrikeFactSchema,
]);
export type CapRushApronFact = z.infer<typeof capRushApronFactSchema>;

export interface CapRushApronRules {
  readonly payrollStatus: Extract<CapRushPayrollStatus, 'first-apron' | 'second-apron'>;
}

export function capRushIsolationEvery(rules: CapRushApronRules): number | null {
  return rules.payrollStatus === 'second-apron'
    ? CAP_RUSH_HERO_BALL_ISOLATION_EVERY
    : CAP_RUSH_CLASH_ISOLATION_EVERY;
}

export function capRushIsolationReason(rules: CapRushApronRules): CapRushIsolationReason {
  return rules.payrollStatus === 'second-apron' ? 'hero-ball' : 'give-me-the-ball';
}

export function capRushStrikeApplies(rules: CapRushApronRules): boolean {
  return rules.payrollStatus === 'second-apron';
}

export function capRushIsolationDue(rules: CapRushApronRules, ordinal: number): boolean {
  const every = capRushIsolationEvery(rules);
  if (every === null) return false;
  if (!Number.isInteger(ordinal) || ordinal < 1) {
    throw new Error(
      `cap rush possession ordinal must be a positive integer (got ${String(ordinal)})`,
    );
  }
  return ordinal % every === 0;
}

export function capRushStrikeDue(rules: CapRushApronRules, ordinal: number): boolean {
  if (!capRushStrikeApplies(rules)) return false;
  if (!Number.isInteger(ordinal) || ordinal < 1) {
    throw new Error(
      `cap rush possession ordinal must be a positive integer (got ${String(ordinal)})`,
    );
  }
  return ordinal % CAP_RUSH_STRIKE_EVERY === 0;
}
