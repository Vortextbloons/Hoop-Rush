import { z } from 'zod';
import { franchiseIdSchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import {
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_ROTATION_SIZE,
  SEASON_ROTATION_VERSION,
} from './season-versions.ts';

export const seasonMinutePolicyStrategySchema = z.enum([
  'starter-heavy',
  'balanced',
  'bench-heavy',
]);
export type SeasonMinutePolicyStrategy = z.infer<typeof seasonMinutePolicyStrategySchema>;

export const seasonMinutePolicySchema = z.object({
  policyVersion: z.literal(SEASON_MINUTE_POLICY_VERSION),
  strategy: seasonMinutePolicyStrategySchema,
});
export type SeasonMinutePolicy = z.infer<typeof seasonMinutePolicySchema>;

export const seasonRotationTargetMinutesSchema = z.object({
  playerVersionId: playerVersionIdSchema,
  minutes: z.number().int().min(0).max(48),
});

export const seasonRotationSchema = z.object({
  franchiseId: franchiseIdSchema,

  starters: z.array(playerVersionIdSchema).length(5),

  benchOrder: z.array(playerVersionIdSchema).length(5),

  targetMinutes: z.array(seasonRotationTargetMinutesSchema).length(SEASON_ROTATION_SIZE),

  closingFive: z.array(playerVersionIdSchema).length(5),

  minutePolicy: seasonMinutePolicySchema,
  rotationVersion: z.literal(SEASON_ROTATION_VERSION),
});
export type SeasonRotation = z.infer<typeof seasonRotationSchema>;
