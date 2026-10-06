import {
  SEASON_AI_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  franchiseIdSchema,
  type SeasonAiIdentity,
  type SeasonGenerationDiagnostics,
  type SeasonRosterRole,
  type SeasonRosterTargets,
} from '@hoop-rush/data-contracts';
import { assertNever } from '../../sim/assert-never.ts';
import { ROSTER_ROLES, ROLE_COVERAGE_THRESHOLD, identityScore } from '../ai-scoring.ts';
import type { SeasonRosterMemberInput } from '../roster-rules.ts';
import type {
  GenerationState,
  SeasonAiGenerationPhase,
  SeasonAiGenerationProgress,
} from './types.ts';

export class SeasonAiGenerationError extends Error {
  readonly code = 'GENERATION_EXHAUSTED' as const;
  readonly diagnostics: SeasonGenerationDiagnostics;
  readonly phase: SeasonAiGenerationPhase;
  readonly allocationState: string;
  readonly repairs: number;
  constructor(input: {
    diagnostics: SeasonGenerationDiagnostics;
    phase: SeasonAiGenerationPhase;
    allocationState: string;
    repairs: number;
    message?: string;
  }) {
    super(input.message ?? `AI roster generation exhausted its node budget (phase ${input.phase})`);
    this.name = 'SeasonAiGenerationError';
    this.diagnostics = input.diagnostics;
    this.phase = input.phase;
    this.allocationState = input.allocationState;
    this.repairs = input.repairs;
  }
}

export function reportProgress(state: GenerationState, progress: SeasonAiGenerationProgress): void {
  try {
    state.onProgress?.(progress);
  } catch {
    return;
  }
}
export function memberOf(state: GenerationState, versionId: string): SeasonRosterMemberInput {
  const candidate = state.byId.get(versionId);
  if (candidate === undefined) {
    throw new Error(`catalog is missing roster version ${versionId}`);
  }
  return { playerVersionId: versionId, playable: candidate.positions.playable };
}
export function membersOf(
  state: GenerationState,
  versionIds: readonly string[],
): SeasonRosterMemberInput[] {
  return versionIds.map((versionId) => memberOf(state, versionId));
}
export function playerIdOf(state: GenerationState, versionId: string): string | undefined {
  return state.byId.get(versionId)?.playerId;
}
export function uniqueIdentities(state: GenerationState, versionIds: readonly string[]): boolean {
  const identities = new Set<string>();
  for (const versionId of versionIds) {
    const playerId = playerIdOf(state, versionId);
    if (playerId === undefined) return false;
    if (identities.has(playerId)) return false;
    identities.add(playerId);
  }
  return true;
}
export function inAnyPool(state: GenerationState, versionId: string): boolean {
  return !state.unassigned.has(versionId) && !state.humanOwned.has(versionId);
}
export function leaveUnassigned(state: GenerationState, versionId: string): void {
  if (!state.unassigned.has(versionId)) return;
  state.unassigned.delete(versionId);
  const mask = state.maskByVersion.get(versionId);
  if (mask !== undefined && mask !== 0) {
    state.unassignedMaskCountsArr[mask] = (state.unassignedMaskCountsArr[mask] ?? 0) - 1;
  }
  const coverageMask = state.coverageMaskByVersion.get(versionId) ?? 0;
  for (let role = 0; role < 8; role += 1) {
    if ((coverageMask & (1 << role)) !== 0) {
      state.unassignedRoleCoverCounts[role] = (state.unassignedRoleCoverCounts[role] ?? 0) - 1;
    }
  }
}
export function enterUnassigned(state: GenerationState, versionId: string): void {
  if (state.unassigned.has(versionId) || state.humanOwned.has(versionId)) return;
  state.unassigned.add(versionId);
  const mask = state.maskByVersion.get(versionId);
  if (mask !== undefined && mask !== 0) {
    state.unassignedMaskCountsArr[mask] = (state.unassignedMaskCountsArr[mask] ?? 0) + 1;
  }
  const coverageMask = state.coverageMaskByVersion.get(versionId) ?? 0;
  for (let role = 0; role < 8; role += 1) {
    if ((coverageMask & (1 << role)) !== 0) {
      state.unassignedRoleCoverCounts[role] = (state.unassignedRoleCoverCounts[role] ?? 0) + 1;
    }
  }
}
export function claimIdentity(state: GenerationState, versionId: string): void {
  const playerId = playerIdOf(state, versionId);
  if (playerId === undefined) return;
  state.claimedIdentities.add(playerId);
  for (const sibling of state.versionsByIdentity.get(playerId) ?? []) {
    if (sibling !== versionId) leaveUnassigned(state, sibling);
  }
}
export function releaseIdentity(state: GenerationState, versionId: string): void {
  const playerId = playerIdOf(state, versionId);
  if (playerId === undefined) return;
  state.claimedIdentities.delete(playerId);
  for (const sibling of state.versionsByIdentity.get(playerId) ?? []) {
    if (sibling !== versionId) enterUnassigned(state, sibling);
  }
}
export function zeroScores(): Record<SeasonRosterRole, number> {
  return {
    'primary-creation': 0,
    'secondary-creation': 0,
    'perimeter-shooting': 0,
    'rim-finishing-interior-scoring': 0,
    'perimeter-defense': 0,
    'interior-defense': 0,
    'offensive-rebounding': 0,
    'defensive-rebounding': 0,
  };
}
export function roleScoresOfIds(
  state: GenerationState,
  versionIds: readonly string[],
): Record<SeasonRosterRole, number> {
  const roleScores = zeroScores();
  for (const versionId of versionIds) {
    const scores = state.roleScores.get(versionId);
    if (scores === undefined) continue;
    for (const role of ROSTER_ROLES) {
      roleScores[role] = Math.max(roleScores[role], scores[role]);
    }
  }
  return roleScores;
}
export function identityScoreOf(
  state: GenerationState,
  versionId: string,
  identity: SeasonAiIdentity,
): number {
  const cached = state.identityScores.get(versionId)?.[identity];
  if (cached !== undefined) return cached;
  const scores = state.roleScores.get(versionId);
  if (scores === undefined) return 0;
  return identityScore(scores, identity);
}
export function uncoveredRoles(roleScores: Record<SeasonRosterRole, number>): SeasonRosterRole[] {
  return ROSTER_ROLES.filter((role) => roleScores[role] < ROLE_COVERAGE_THRESHOLD);
}
export function maskCountsOf(
  versionIds: readonly string[],
  maskByVersion: ReadonlyMap<string, number>,
): number[] {
  const counts = new Array<number>(8).fill(0);
  for (const versionId of versionIds) {
    const mask = maskByVersion.get(versionId) ?? 0;
    if (mask !== 0) counts[mask] = (counts[mask] ?? 0) + 1;
  }
  return counts;
}
export function roleCoverCountsOf(
  versionIds: Iterable<string>,
  coverageMaskByVersion: ReadonlyMap<string, number>,
): number[] {
  const counts = new Array<number>(8).fill(0);
  for (const id of versionIds) {
    const coverageMask = coverageMaskByVersion.get(id) ?? 0;
    for (let role = 0; role < 8; role += 1) {
      if ((coverageMask & (1 << role)) !== 0) counts[role] = (counts[role] ?? 0) + 1;
    }
  }
  return counts;
}
export function checkBudget(state: GenerationState): void {
  const budget = budgetForPhase(state, state.phase);
  if (state.nodesByPhase[state.phase] > budget) {
    throw exhausted(state, state.phase, [], [`${state.phase} node budget exceeded`]);
  }
}
export function budgetForPhase(state: GenerationState, phase: SeasonAiGenerationPhase): number {
  const budgets = state.targets.policy.nodeBudgets;
  switch (phase) {
    case 'anchors':
      return budgets.anchorMatching;
    case 'pool-fill':
      return budgets.poolRepair;
    case 'selection':
      return budgets.rosterSelection;
    default: {
      const exhaustive: never = phase;
      return assertNever(exhaustive, `unknown generation phase for ${state.seed}`);
    }
  }
}
export function selectionBudgetExceeded(state: GenerationState): boolean {
  return state.nodesByPhase.selection > state.selectionFloor;
}
export function canonicalAllocationState(state: GenerationState): string {
  const pools = state.teamOrder.map((teamId) => {
    const team = state.teams.get(teamId);
    if (team === undefined) return null;
    return {
      franchiseId: team.franchiseId,
      band: team.band,
      identity: team.identity,
      pool: [...team.pool].sort(),
      anchors: team.anchors.map((anchor) => anchor.playerVersionId).sort(),
      selections: team.selections !== null ? [...team.selections].sort() : null,
      repairCount: team.repairCount,
    };
  });
  return JSON.stringify({
    phase: state.phase,
    nodes: state.nodes,
    nodesByPhase: state.nodesByPhase,
    backtracks: state.backtracks,
    unassignedCount: state.unassigned.size,
    pools,
  });
}
export function exhausted(
  state: GenerationState,
  phase: SeasonAiGenerationPhase,
  failedTeams: string[],
  unmetConstraints: string[],
): SeasonAiGenerationError {
  return new SeasonAiGenerationError({
    diagnostics: {
      seed: state.seed,
      aiVersion: SEASON_AI_VERSION,
      rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
      teamsGenerated: state.teamOrder.length,
      teamsRepaired: totalRepairs(state),
      backtracks: state.backtracks,
      nodesVisited: state.nodes,
      nodeBudget: nodeBudgetOf(state.targets),
      failedTeams: failedTeams.map((team) => franchiseIdSchema.parse(team)),
      unmetConstraints,
    },
    phase,
    allocationState: canonicalAllocationState(state),
    repairs: totalRepairs(state),
  });
}
export function totalRepairs(state: GenerationState): number {
  let total = 0;
  for (const teamId of state.teamOrder) {
    const team = state.teams.get(teamId);
    if (team === undefined) continue;
    total += team.repairCount;
  }
  return total;
}
export function nodeBudgetOf(targets: SeasonRosterTargets): number {
  return (
    targets.policy.nodeBudgets.anchorMatching +
    targets.policy.nodeBudgets.poolRepair +
    targets.policy.nodeBudgets.rosterSelection
  );
}
