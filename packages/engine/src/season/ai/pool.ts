import { seasonNamespaceSeed, type SeasonRosterRole } from '@hoop-rush/data-contracts';
import { assertNever } from '../../sim/assert-never.ts';
import { createRng, shuffle } from '../../sim/rng.ts';
import { BAND_CEILING_PENALTY, ROSTER_ROLES, type PercentileTier } from '../ai-scoring.ts';
import {
  legalFiveAfterAnyRemoval,
  rosterGroupCounts,
  validateSeasonRoster,
} from '../roster-rules.ts';
import { POOL_COMPOSITION_TARGETS, identityPriorityRolesOf } from './constants.ts';
import {
  coverageFeasibleFromPool,
  memberReachCapped,
  reachableAfterFixedAndFills,
} from './reachability.ts';
import {
  checkBudget,
  claimIdentity,
  enterUnassigned,
  exhausted,
  identityScoreOf,
  inAnyPool,
  leaveUnassigned,
  membersOf,
  playerIdOf,
  releaseIdentity,
  reportProgress,
  roleCoverCountsOf,
  roleScoresOfIds,
  uncoveredRoles,
  uniqueIdentities,
} from './state.ts';
import type { GenerationState, PoolSnapshot, PoolTeam } from './types.ts';

export class PoolFillDeadlock extends Error {
  readonly teamId: string;
  readonly round: number;
  constructor(teamId: string, round: number) {
    super(`pool fill deadlock at round ${String(round)} for ${teamId}`);
    this.name = 'PoolFillDeadlock';
    this.teamId = teamId;
    this.round = round;
  }
}
export function poolAdmitsTenExact(state: GenerationState, team: PoolTeam): boolean {
  const anchorIds = team.anchors.map((anchor) => anchor.playerVersionId);
  const anchorCounts = rosterGroupCounts(membersOf(state, anchorIds));
  const anchorSet = new Set(anchorIds);
  const rest = team.pool.filter((id) => !anchorSet.has(id));
  const picks = 10 - team.anchors.length;
  if (!memberReachCapped(state, { ...POOL_COMPOSITION_TARGETS }, anchorCounts, rest, picks)) {
    return false;
  }
  if (
    !memberReachCapped(
      state,
      { guards: 2, forwards: 2, centers: 1 },
      { guards: 0, forwards: 0, centers: 0 },
      team.pool,
      5,
    )
  ) {
    return false;
  }
  return true;
}
export function poolTenFeasibleAfterAdd(
  state: GenerationState,
  team: PoolTeam,
  versionId: string | null,
): boolean {
  const anchorIds = team.anchors.map((anchor) => anchor.playerVersionId);
  const anchorSet = new Set(anchorIds);
  const anchorCounts = rosterGroupCounts(membersOf(state, anchorIds));
  const fixedMasks: number[] = [];
  for (const memberId of team.pool) {
    if (anchorSet.has(memberId)) continue;
    const mask = state.maskByVersion.get(memberId) ?? 0;
    if (mask !== 0) fixedMasks.push(mask);
  }
  const unassignedMasks = [...state.unassignedMaskCountsArr];
  if (versionId !== null) {
    const addMask = state.maskByVersion.get(versionId) ?? 0;
    if (addMask !== 0) fixedMasks.push(addMask);
    if (addMask !== 0) {
      unassignedMasks[addMask] = Math.max(0, (unassignedMasks[addMask] ?? 0) - 1);
    }
  }
  const poolSize = state.targets.policy.poolSize;
  const slotsToFill = Math.max(0, poolSize - team.pool.length - (versionId !== null ? 1 : 0));
  const picksForTen = 10 - team.anchors.length;
  if (
    !reachableAfterFixedAndFills(
      { ...POOL_COMPOSITION_TARGETS },
      anchorCounts,
      fixedMasks,
      unassignedMasks,
      slotsToFill,
      picksForTen,
    )
  ) {
    return false;
  }
  if (
    !reachableAfterFixedAndFills(
      { guards: 2, forwards: 2, centers: 1 },
      { guards: 0, forwards: 0, centers: 0 },
      fixedMasks,
      unassignedMasks,
      slotsToFill,
      picksForTen,
    )
  ) {
    return false;
  }
  return true;
}
export function poolCoverageFeasible(
  state: GenerationState,
  team: PoolTeam,
  versionId: string | null,
  includeUnassigned: boolean,
): boolean {
  let poolMask = team.coverageMask;
  if (versionId !== null) {
    poolMask |= state.coverageMaskByVersion.get(versionId) ?? 0;
  }
  if (poolMask === 0xff) return true;
  if (!includeUnassigned) return false;
  let unassignedMask = 0;
  for (let role = 0; role < 8; role += 1) {
    if ((state.unassignedRoleCoverCounts[role] ?? 0) > 0) unassignedMask |= 1 << role;
  }
  return (poolMask | unassignedMask) === 0xff;
}
export function lackingCoverageMask(state: GenerationState): number {
  let lacking = 0xff;
  for (const teamId of state.teamOrder) {
    const t = state.teams.get(teamId);
    if (t === undefined) continue;
    lacking &= ~t.coverageMask;
  }
  return lacking;
}
export function coverageScarcityAfterWithLacking(
  state: GenerationState,
  lacking: number,
  versionId: string,
): boolean {
  const probeMask = state.coverageMaskByVersion.get(versionId) ?? 0;
  const stillLacking = lacking & ~probeMask;
  if (stillLacking === 0) return true;
  for (let role = 0; role < 8; role += 1) {
    if ((stillLacking & (1 << role)) === 0) continue;
    if ((state.unassignedRoleCoverCounts[role] ?? 0) <= 0) return false;
    if ((probeMask & (1 << role)) !== 0) return false;
  }
  return true;
}
export function coverageScarcityAfter(
  state: GenerationState,
  team: PoolTeam,
  versionId: string,
): boolean {
  void team;
  return coverageScarcityAfterWithLacking(state, lackingCoverageMask(state), versionId);
}
export function poolTenFeasibleAfterAddExact(
  state: GenerationState,
  team: PoolTeam,
  versionId: string | null,
): boolean {
  const anchorIds = team.anchors.map((anchor) => anchor.playerVersionId);
  const anchorSet = new Set(anchorIds);
  const anchorCounts = rosterGroupCounts(membersOf(state, anchorIds));
  const members: string[] = [];
  for (const memberId of team.pool) {
    if (anchorSet.has(memberId)) continue;
    members.push(memberId);
  }
  if (versionId !== null) members.push(versionId);
  const picks = 10 - team.anchors.length;
  if (!memberReachCapped(state, { ...POOL_COMPOSITION_TARGETS }, anchorCounts, members, picks)) {
    return false;
  }
  if (
    !memberReachCapped(
      state,
      { guards: 2, forwards: 2, centers: 1 },
      { guards: 0, forwards: 0, centers: 0 },
      [...team.pool, ...(versionId !== null ? [versionId] : [])],
      5,
    )
  ) {
    return false;
  }
  const capValue = state.targets.policy.bandPoolScoreCaps[team.band];
  let anchorOutliers = 0;
  for (const anchorId of anchorIds) {
    if (identityScoreOf(state, anchorId, team.identity) > capValue) anchorOutliers += 1;
  }
  if (
    !memberReachCapped(state, { ...POOL_COMPOSITION_TARGETS }, anchorCounts, members, picks, {
      identity: team.identity,
      capValue,
      startOutliers: anchorOutliers,
      maxOutliers: state.targets.policy.maxRosterStrengthOutliers,
    })
  ) {
    return false;
  }
  return true;
}
export function gatesForAdd(state: GenerationState, team: PoolTeam, versionId: string): string[] {
  const failures: string[] = [];
  if (state.unassigned.size < state.remainingSlots) {
    failures.push('global scarcity');
  }
  const addMask = state.maskByVersion.get(versionId) ?? 0;
  if (addMask !== 0 && !positionScarcityAfter(state, team, addMask)) {
    failures.push('position scarcity');
  }
  if (!poolCoverageFeasible(state, team, versionId, true)) {
    failures.push('role coverage infeasible');
  }
  if (!coverageScarcityAfter(state, team, versionId)) {
    failures.push('coverage scarcity');
  }
  const playerId = playerIdOf(state, versionId);
  if (playerId !== undefined && state.claimedIdentities.has(playerId)) {
    failures.push('identity already claimed');
  }
  const slotsLeft = state.targets.policy.poolSize - team.pool.length - 1;
  if (slotsLeft <= 0) {
    if (!poolTenFeasibleAfterAddExact(state, team, versionId)) {
      failures.push('pool cannot admit a legal ten');
    }
  } else if (!poolTenFeasibleAfterAdd(state, team, versionId)) {
    failures.push('pool cannot admit a legal ten');
  }
  return failures;
}
export function addPoolMember(
  state: GenerationState,
  team: PoolTeam,
  versionId: string,
  seedPath: string[],
): void {
  team.pool.push(versionId);
  team.memberPaths.set(versionId, seedPath);
  leaveUnassigned(state, versionId);
  claimIdentity(state, versionId);
  const mask = state.maskByVersion.get(versionId);
  const coverageMask = state.coverageMaskByVersion.get(versionId) ?? 0;
  team.coverageMask |= coverageMask;
  if (mask !== undefined && (mask & 1) !== 0) team.groupCounts.guards += 1;
  if (mask !== undefined && (mask & 2) !== 0) team.groupCounts.forwards += 1;
  if (mask !== undefined && (mask & 4) !== 0) team.groupCounts.centers += 1;
  state.remainingSlots -= 1;
  const tier = state.poolTiers.get(versionId) ?? 'depth';
  team.tierCounts[tier] += 1;
  const cap = state.targets.policy.bandPoolScoreCaps[team.band];
  if (identityScoreOf(state, versionId, team.identity) > cap) team.outliers += 1;
  const pathKey = JSON.stringify(seedPath);
  if (!team.seedPaths.includes(pathKey)) team.seedPaths.push(pathKey);
}
export function removePoolMember(state: GenerationState, team: PoolTeam, versionId: string): void {
  const index = team.pool.indexOf(versionId);
  if (index < 0) throw new Error(`pool ${team.franchiseId} does not contain ${versionId}`);
  team.pool.splice(index, 1);
  team.memberPaths.delete(versionId);
  enterUnassigned(state, versionId);
  releaseIdentity(state, versionId);
  const mask = state.maskByVersion.get(versionId);
  if (mask !== undefined && (mask & 1) !== 0)
    team.groupCounts.guards = Math.max(0, team.groupCounts.guards - 1);
  if (mask !== undefined && (mask & 2) !== 0)
    team.groupCounts.forwards = Math.max(0, team.groupCounts.forwards - 1);
  if (mask !== undefined && (mask & 4) !== 0)
    team.groupCounts.centers = Math.max(0, team.groupCounts.centers - 1);
  team.coverageMask = 0;
  for (const memberId of team.pool) {
    team.coverageMask |= state.coverageMaskByVersion.get(memberId) ?? 0;
  }
  state.remainingSlots += 1;
  const tier = state.poolTiers.get(versionId) ?? 'depth';
  team.tierCounts[tier] = Math.max(0, team.tierCounts[tier] - 1);
  const cap = state.targets.policy.bandPoolScoreCaps[team.band];
  if (identityScoreOf(state, versionId, team.identity) > cap) {
    team.outliers = Math.max(0, team.outliers - 1);
  }
}
const TIER_DEFICIT_FACTOR: Record<PercentileTier, number> = {
  elite: 3,
  strong: 2,
  useful: 1,
  depth: 0,
};
export function weakestRoles(
  poolRoleScores: Record<SeasonRosterRole, number>,
  count: number,
): SeasonRosterRole[] {
  return [...ROSTER_ROLES].sort((a, b) => poolRoleScores[a] - poolRoleScores[b]).slice(0, count);
}
export function poolPickScore(
  state: GenerationState,
  team: PoolTeam,
  versionId: string,
  rngRank: number,
  priorityRoles: readonly SeasonRosterRole[],
  weakest: readonly SeasonRosterRole[],
  poolCounts: {
    guards: number;
    forwards: number;
    centers: number;
  },
): number {
  const identity = identityScoreOf(state, versionId, team.identity);
  let score = identity;
  const cap = state.targets.policy.bandPoolScoreCaps[team.band];
  if (identity > cap) {
    score -= (identity - cap) * BAND_CEILING_PENALTY;
    if (team.outliers + 1 > state.targets.policy.maxPoolStrengthOutliers) {
      score -= (team.outliers + 1 - state.targets.policy.maxPoolStrengthOutliers) * 6;
    }
  }
  const memberScores = state.roleScores.get(versionId);
  const priorityTotal = state.identityPriorityTotals.get(versionId)?.[team.identity] ?? 0;
  score += (0.6 * priorityTotal) / Math.max(1, priorityRoles.length);
  let weakTotal = 0;
  for (const role of weakest) weakTotal += memberScores?.[role] ?? 0;
  score += (1.6 * weakTotal) / Math.max(1, weakest.length);
  const tier = state.poolTiers.get(versionId) ?? 'depth';
  const ranges = state.targets.policy.tierRanges[team.band];
  if (tier !== 'depth') {
    const tierRange = ranges[tier];
    const tierDeficit = Math.max(0, tierRange[0] - team.tierCounts[tier]);
    score += tierDeficit * TIER_DEFICIT_FACTOR[tier];
    const cumulative = tierOverage(state, team, tier, 1);
    if (cumulative > tierRange[1]) score -= (cumulative - tierRange[1]) * TIER_DEFICIT_FACTOR[tier];
  }
  const mask = state.maskByVersion.get(versionId) ?? 0;
  let positionHelp = 0;
  if (Math.max(0, POOL_COMPOSITION_TARGETS.guards - poolCounts.guards) > 0 && (mask & 1) !== 0)
    positionHelp += 1;
  if (Math.max(0, POOL_COMPOSITION_TARGETS.forwards - poolCounts.forwards) > 0 && (mask & 2) !== 0)
    positionHelp += 1;
  if (Math.max(0, POOL_COMPOSITION_TARGETS.centers - poolCounts.centers) > 0 && (mask & 4) !== 0)
    positionHelp += 1;
  score += positionHelp * 0.4;
  score += rngRank * 2.5;
  return score;
}
export function tierOverage(
  state: GenerationState,
  team: PoolTeam,
  tier: PercentileTier,
  extra: number,
): number {
  const elite = team.tierCounts.elite + (tier === 'elite' ? extra : 0);
  const strong = elite + team.tierCounts.strong + (tier === 'strong' ? extra : 0);
  const useful = strong + team.tierCounts.useful + (tier === 'useful' ? extra : 0);
  switch (tier) {
    case 'elite':
      return elite;
    case 'strong':
      return strong;
    case 'useful':
      return useful;
    case 'depth':
      return elite + strong + useful + team.tierCounts.depth + extra;
    default: {
      const exhaustive: never = tier;
      return assertNever(exhaustive, 'unknown percentile tier');
    }
  }
}
export function pickForPool(state: GenerationState, team: PoolTeam, round: number): string | null {
  if (team.pool.length >= state.targets.policy.poolSize) return null;
  if (state.unassigned.size < state.remainingSlots) return null;
  const feasibleMasks = new Set<number>();
  const slotsLeft = state.targets.policy.poolSize - team.pool.length - 1;
  for (let mask = 1; mask <= 7; mask += 1) {
    if ((state.unassignedMaskCountsArr[mask] ?? 0) === 0) continue;
    if (!positionScarcityAfter(state, team, mask)) continue;
    const probeId = probeForMask(state, team, mask);
    if (probeId === undefined) continue;
    const feasible =
      slotsLeft <= 0
        ? poolTenFeasibleAfterAddExact(state, team, probeId)
        : poolTenFeasibleAfterAdd(state, team, probeId);
    if (feasible) feasibleMasks.add(mask);
  }
  if (feasibleMasks.size === 0) return null;
  const candidates = state.canonicalCandidates;
  const rngRanks = new Array<number>(candidates.length);
  const rng = createRng(
    seasonNamespaceSeed(
      state.seed,
      'ai-rosters',
      'pool-fill',
      String(round),
      team.franchiseId,
      'candidate-order',
    ),
  );
  for (let i = 0; i < candidates.length; i += 1) {
    rngRanks[i] = rng.next();
  }
  const poolRoleScores = roleScoresOfIds(state, team.pool);
  const priorityRoles = identityPriorityRolesOf(state.targets, team.identity);
  const weakest = weakestRoles(poolRoleScores, 2);
  const poolCounts = team.groupCounts;
  const lacking = lackingCoverageMask(state);
  const teamPrefix = `${team.franchiseId}:`;
  let best:
    | {
        id: string;
        score: number;
      }
    | undefined;
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (candidate === undefined) continue;
    const id = candidate.playerVersionId;
    const mask = state.maskByVersion.get(id) ?? 0;
    if (mask === 0 || !feasibleMasks.has(mask)) continue;
    if (!state.unassigned.has(id)) continue;
    if (state.claimedIdentities.has(candidate.playerId)) continue;
    if (state.bans.has(teamPrefix + id)) continue;
    if (!poolCoverageFeasible(state, team, id, true)) continue;
    if (!coverageScarcityAfterWithLacking(state, lacking, id)) continue;
    const score = poolPickScore(
      state,
      team,
      id,
      rngRanks[i] ?? 0,
      priorityRoles,
      weakest,
      poolCounts,
    );
    if (best === undefined || score > best.score || (score === best.score && id < best.id)) {
      best = { id, score };
    }
  }
  if (best === undefined) return null;
  state.nodes += 1;
  state.nodesByPhase['pool-fill'] += 1;
  checkBudget(state);
  return best.id;
}
export function probeForMask(
  state: GenerationState,
  team: PoolTeam,
  mask: number,
): string | undefined {
  for (const candidate of state.canonicalCandidates) {
    const id = candidate.playerVersionId;
    if (!state.unassigned.has(id)) continue;
    if (state.bans.has(`${team.franchiseId}:${id}`)) continue;
    if ((state.maskByVersion.get(id) ?? 0) === mask) return id;
  }
  return undefined;
}
export function positionScarcityAfter(
  state: GenerationState,
  team: PoolTeam,
  mask: number,
): boolean {
  const need = { guards: 0, forwards: 0, centers: 0 };
  for (const teamId of state.teamOrder) {
    const t = state.teams.get(teamId);
    if (t === undefined) continue;
    const counts = t.groupCounts;
    const addToTeam = t === team;
    const g = counts.guards + (addToTeam && (mask & 1) !== 0 ? 1 : 0);
    const f = counts.forwards + (addToTeam && (mask & 2) !== 0 ? 1 : 0);
    const c = counts.centers + (addToTeam && (mask & 4) !== 0 ? 1 : 0);
    need.guards += Math.max(0, POOL_COMPOSITION_TARGETS.guards - g);
    need.forwards += Math.max(0, POOL_COMPOSITION_TARGETS.forwards - f);
    need.centers += Math.max(0, POOL_COMPOSITION_TARGETS.centers - c);
  }
  const counts = state.unassignedMaskCountsArr;
  const supply = {
    guards:
      (counts[1] ?? 0) +
      (counts[3] ?? 0) +
      (counts[5] ?? 0) +
      (counts[7] ?? 0) -
      ((mask & 1) !== 0 ? 1 : 0),
    forwards:
      (counts[2] ?? 0) +
      (counts[3] ?? 0) +
      (counts[6] ?? 0) +
      (counts[7] ?? 0) -
      ((mask & 2) !== 0 ? 1 : 0),
    centers: (counts[4] ?? 0) + (counts[6] ?? 0) - ((mask & 4) !== 0 ? 1 : 0),
  };
  return (
    supply.guards >= need.guards &&
    supply.forwards >= need.forwards &&
    supply.centers >= need.centers
  );
}
export function fillPools(state: GenerationState): void {
  const poolSize = state.targets.policy.poolSize;
  for (let round = 0; round < poolSize; round += 1) {
    const order = shuffle(
      [...state.teamOrder],
      createRng(
        seasonNamespaceSeed(state.seed, 'ai-rosters', 'pool-fill', String(round), 'team-order'),
      ),
    );
    for (const teamId of order) {
      const team = state.teams.get(teamId);
      if (team === undefined || team.pool.length >= poolSize) continue;
      const pick = pickForPool(state, team, round);
      if (pick === null) throw new PoolFillDeadlock(teamId, round);
      addPoolMember(state, team, pick, ['ai-rosters', 'pool-fill', String(round), teamId]);
    }
    reportProgress(state, { phase: 'pool-fill', completed: round + 1, total: poolSize });
  }
}
export function snapshotPools(state: GenerationState): PoolSnapshot {
  return {
    pools: state.teamOrder.map((teamId) => {
      const team = state.teams.get(teamId);
      if (team === undefined) throw new Error(`missing team ${teamId}`);
      return {
        franchiseId: team.franchiseId,
        pool: [...team.pool],
        tierCounts: { ...team.tierCounts },
        outliers: team.outliers,
        anchors: [...team.anchors],
        seedPaths: [...team.seedPaths],
        memberPaths: [...team.memberPaths.entries()],
        repairCount: team.repairCount,
      };
    }),
    unassigned: [...state.unassigned],
    unassignedMaskCountsArr: [...state.unassignedMaskCountsArr],
    remainingSlots: state.remainingSlots,
    claimedIdentities: [...state.claimedIdentities],
  };
}
export function restorePools(state: GenerationState, snapshot: PoolSnapshot): void {
  state.unassigned = new Set(snapshot.unassigned);
  state.unassignedMaskCountsArr = [...snapshot.unassignedMaskCountsArr];
  state.remainingSlots = snapshot.remainingSlots;
  state.claimedIdentities = new Set(snapshot.claimedIdentities);
  for (const entry of snapshot.pools) {
    const team = state.teams.get(entry.franchiseId);
    if (team === undefined) throw new Error(`missing team ${entry.franchiseId}`);
    team.pool = [...entry.pool];
    team.tierCounts = { ...entry.tierCounts };
    team.outliers = entry.outliers;
    team.anchors = [...entry.anchors];
    team.seedPaths = [...entry.seedPaths];
    team.memberPaths = new Map(entry.memberPaths);
    team.repairCount = entry.repairCount;
  }
  state.unassignedRoleCoverCounts = roleCoverCountsOf(
    state.unassigned,
    state.coverageMaskByVersion,
  );
  for (const teamId of state.teamOrder) {
    const team = state.teams.get(teamId);
    if (team === undefined) continue;
    team.groupCounts = { guards: 0, forwards: 0, centers: 0 };
    team.coverageMask = 0;
    for (const memberId of team.pool) {
      const mask = state.maskByVersion.get(memberId);
      if (mask !== undefined && (mask & 1) !== 0) team.groupCounts.guards += 1;
      if (mask !== undefined && (mask & 2) !== 0) team.groupCounts.forwards += 1;
      if (mask !== undefined && (mask & 4) !== 0) team.groupCounts.centers += 1;
      team.coverageMask |= state.coverageMaskByVersion.get(memberId) ?? 0;
    }
  }
}
export function localPoolRepair(state: GenerationState, teamId: string): boolean {
  const team = state.teams.get(teamId);
  if (team === undefined) return false;
  const anchorSet = new Set(team.anchors.map((anchor) => anchor.playerVersionId));
  const original = [...team.pool];
  for (const memberId of original) {
    if (anchorSet.has(memberId)) continue;
    removePoolMember(state, team, memberId);
    for (const candidate of state.canonicalCandidates) {
      const id = candidate.playerVersionId;
      if (!state.unassigned.has(id) || state.bans.has(`${teamId}:${id}`)) continue;
      state.nodes += 1;
      state.nodesByPhase['pool-fill'] += 1;
      checkBudget(state);
      if (gatesForAdd(state, team, id).length === 0) {
        addPoolMember(state, team, id, ['ai-rosters', 'pool-repair', teamId, memberId]);
        const exactOk = poolAdmitsTenExact(state, team);
        if (exactOk) {
          team.repairCount += 1;
          return true;
        }
        removePoolMember(state, team, id);
      }
    }
    addPoolMember(state, team, memberId, ['ai-rosters', 'pool-repair', teamId, 'restore']);
  }
  return false;
}
export function crossPoolRepair(state: GenerationState, teamId: string): boolean {
  const team = state.teams.get(teamId);
  if (team === undefined) return false;
  for (const donorId of state.teamOrder) {
    if (donorId === teamId) continue;
    const donor = state.teams.get(donorId);
    if (donor === undefined) continue;
    const donorAnchorSet = new Set(donor.anchors.map((anchor) => anchor.playerVersionId));
    for (const memberId of [...donor.pool]) {
      if (state.bans.has(`${teamId}:${memberId}`)) continue;
      if (donorAnchorSet.has(memberId)) continue;
      state.nodes += 1;
      state.nodesByPhase['pool-fill'] += 1;
      checkBudget(state);
      removePoolMember(state, donor, memberId);
      const donorOk = poolAdmitsTenExact(state, donor);
      const addFailures = gatesForAdd(state, team, memberId);
      if (donorOk && !inAnyPool(state, memberId) && addFailures.length === 0) {
        let swapOut: string | null = null;
        if (team.pool.length >= state.targets.policy.poolSize) {
          for (const candidateOut of [...team.pool]) {
            removePoolMember(state, team, candidateOut);
            addPoolMember(state, team, memberId, ['ai-rosters', 'pool-repair', teamId, memberId]);
            if (poolAdmitsTenExact(state, team)) {
              swapOut = candidateOut;
              break;
            }
            removePoolMember(state, team, memberId);
            addPoolMember(state, team, candidateOut, [
              'ai-rosters',
              'pool-repair',
              teamId,
              'restore',
            ]);
          }
          if (swapOut === null) {
            addPoolMember(state, donor, memberId, [
              'ai-rosters',
              'pool-repair',
              donorId,
              'restore',
            ]);
            continue;
          }
        } else {
          addPoolMember(state, team, memberId, ['ai-rosters', 'pool-repair', teamId, memberId]);
          if (!poolAdmitsTenExact(state, team)) {
            removePoolMember(state, team, memberId);
            addPoolMember(state, donor, memberId, [
              'ai-rosters',
              'pool-repair',
              donorId,
              'restore',
            ]);
            continue;
          }
        }
        team.repairCount += 1;
        return true;
      }
      addPoolMember(state, donor, memberId, ['ai-rosters', 'pool-repair', donorId, 'restore']);
    }
  }
  return false;
}
export function poolViolations(state: GenerationState, teamId: string): string[] {
  const team = state.teams.get(teamId);
  if (team === undefined) return ['missing team'];
  const violations: string[] = [];
  const poolSize = state.targets.policy.poolSize;
  if (team.pool.length !== poolSize) {
    violations.push(`pool has ${String(team.pool.length)} of ${String(poolSize)} members`);
  }
  if (new Set(team.pool).size !== team.pool.length) violations.push('pool contains duplicates');
  if (!uniqueIdentities(state, team.pool)) violations.push('pool contains duplicate identities');
  if (!poolAdmitsTenExact(state, team)) {
    violations.push('pool admits no removal-robust ten');
  }
  if (!poolCoverageFeasible(state, team, null, false)) {
    violations.push('pool cannot cover all eight roles');
  }
  return violations;
}
export function legalTenExists(state: GenerationState, members: readonly string[]): boolean {
  const ordered = [...members].sort();
  const picked: string[] = [];
  const rec = (index: number): boolean => {
    if (picked.length === 10) {
      const roster = membersOf(state, picked);
      return (
        validateSeasonRoster(roster).length === 0 &&
        legalFiveAfterAnyRemoval(roster) &&
        uncoveredRoles(roleScoresOfIds(state, picked)).length === 0
      );
    }
    const pickedCounts = rosterGroupCounts(membersOf(state, picked));
    const slotsLeft = 10 - picked.length;
    for (let i = index; i < ordered.length; i += 1) {
      const id = ordered[i];
      if (id === undefined) continue;
      const remaining = ordered.slice(i + 1);
      const mask = state.maskByVersion.get(id) ?? 0;
      const probeCounts = {
        guards: pickedCounts.guards + ((mask & 1) !== 0 ? 1 : 0),
        forwards: pickedCounts.forwards + ((mask & 2) !== 0 ? 1 : 0),
        centers: pickedCounts.centers + ((mask & 4) !== 0 ? 1 : 0),
      };
      if (
        !memberReachCapped(
          state,
          { guards: 2, forwards: 2, centers: 1 },
          probeCounts,
          remaining,
          slotsLeft - 1,
        )
      ) {
        continue;
      }
      const afterPicked = [...picked, id];
      const uncoveredAfter = uncoveredRoles(roleScoresOfIds(state, afterPicked));
      if (!coverageFeasibleFromPool(state, uncoveredAfter, remaining, slotsLeft - 1)) {
        continue;
      }
      picked.push(id);
      if (rec(i + 1)) return true;
      picked.pop();
    }
    return false;
  };
  return rec(0);
}
export function fillPoolsWithRepair(state: GenerationState): void {
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const snapshot = snapshotPools(state);
    try {
      fillPools(state);
    } catch (error) {
      if (!(error instanceof PoolFillDeadlock)) throw error;
      state.backtracks += 1;
      if (localPoolRepair(state, error.teamId)) continue;
      if (crossPoolRepair(state, error.teamId)) continue;
      restorePools(state, snapshot);
      const team = state.teams.get(error.teamId);
      if (team !== undefined) {
        const round = Math.min(state.targets.policy.poolSize - 1, team.pool.length);
        const next = pickForPool(state, team, round);
        if (next !== null) state.bans.add(`${error.teamId}:${next}`);
      }
      continue;
    }
    const violators = state.teamOrder.filter(
      (teamId) =>
        poolViolations(state, teamId).length > 0 ||
        !legalTenExists(state, state.teams.get(teamId)?.pool ?? []),
    );
    if (violators.length === 0) return;
    const repaired = violators.some((teamId) => {
      if (localPoolRepair(state, teamId)) return true;
      if (crossPoolRepair(state, teamId)) return true;
      return false;
    });
    if (repaired) continue;
    restorePools(state, snapshot);
    const team = state.teams.get(violators[0] ?? '');
    if (team !== undefined) {
      const round = Math.min(state.targets.policy.poolSize - 1, team.pool.length);
      const next = pickForPool(state, team, round);
      if (next !== null) state.bans.add(`${team.franchiseId}:${next}`);
    }
    state.backtracks += 1;
  }
  const failedTeams = state.teamOrder.filter((teamId) => poolViolations(state, teamId).length > 0);
  throw exhausted(
    state,
    'pool-fill',
    failedTeams,
    failedTeams.map((teamId) => poolViolations(state, teamId).join('; ')),
  );
}
