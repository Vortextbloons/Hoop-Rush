import type {
  SeasonAiIdentity,
  SeasonRosterRole,
  SeasonRosterTargets,
  SeasonStrengthBand,
} from '@hoop-rush/data-contracts';
import { ROSTER_ROLES } from '../ai-scoring.ts';

export const SOLO_BAND_QUOTAS = {
  contender: 4,
  playoff: 8,
  average: 10,
  weaker: 7,
} as const;
export const DUO_BAND_QUOTAS = {
  contender: 4,
  playoff: 8,
  average: 9,
  weaker: 7,
} as const;
export const AI_GENERATION_NODE_BUDGET = 100000;
export const BAND_ORDER: readonly SeasonStrengthBand[] = [
  'contender',
  'playoff',
  'average',
  'weaker',
];
export const IDENTITIES: readonly SeasonAiIdentity[] = [
  'star-chaser',
  'depth-builder',
  'defense-first',
  'shooting-first',
  'continuity',
  'active-trader',
];
export const DEFAULT_IDENTITY_PRIORITY_ROLES: Record<
  SeasonAiIdentity,
  readonly SeasonRosterRole[]
> = {
  'star-chaser': ['primary-creation', 'secondary-creation', 'rim-finishing-interior-scoring'],
  'shooting-first': ['perimeter-shooting'],
  'defense-first': ['perimeter-defense', 'interior-defense'],
  'depth-builder': ROSTER_ROLES,
  continuity: ROSTER_ROLES,
  'active-trader': ROSTER_ROLES,
};
export const FIVE_COVERAGE_TARGETS: readonly number[] = [1, 1, 1, 1, 1];
export const POOL_COMPOSITION_TARGETS: readonly number[] = [2, 2, 2, 2, 2];
export const ZERO_POSITION_COUNTS: readonly number[] = [0, 0, 0, 0, 0];
export function identityPriorityRolesOf(
  targets: SeasonRosterTargets,
  identity: SeasonAiIdentity,
): readonly SeasonRosterRole[] {
  const roles = (
    targets.policy.identityPriorityRoles as Partial<
      Record<SeasonAiIdentity, readonly SeasonRosterRole[]>
    >
  )[identity];
  if (roles !== undefined && roles.length > 0) return roles;
  return DEFAULT_IDENTITY_PRIORITY_ROLES[identity];
}
