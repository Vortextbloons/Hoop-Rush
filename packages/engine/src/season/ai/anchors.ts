import {
  seasonNamespaceSeed,
  type SeasonAiAnchor,
  type SeasonStrengthBand,
} from '@hoop-rush/data-contracts';
import { createRng } from '../../sim/rng.ts';
import { identityPriorityRolesOf } from './constants.ts';
import { addPoolMember, gatesForAdd, poolTenFeasibleAfterAdd, removePoolMember } from './pool.ts';
import { checkBudget, exhausted, inAnyPool } from './state.ts';
import type { AnchorOption, GenerationState, PoolTeam } from './types.ts';

export function anchorOptionsFor(state: GenerationState, team: PoolTeam): AnchorOption[] {
  const priorityRoles = identityPriorityRolesOf(state.targets, team.identity);
  const options: AnchorOption[] = [];
  for (const candidate of state.canonicalCandidates) {
    if (state.humanOwned.has(candidate.playerVersionId)) continue;
    if (state.claimedIdentities.has(candidate.playerId)) continue;
    const roleTiers = state.roleTiers.get(candidate.playerVersionId);
    if (roleTiers === undefined) continue;
    const roleScores = state.roleScores.get(candidate.playerVersionId);
    for (const role of priorityRoles) {
      if (roleTiers[role] === 'elite') {
        const thresholds = state.thresholds[role];
        options.push({
          versionId: candidate.playerVersionId,
          qualifyingRole: role,
          roleScore: roleScores === undefined ? 0 : roleScores[role],
          threshold: thresholds.elite,
        });
        break;
      }
    }
  }
  return options;
}
export function anchorBranchViolations(
  state: GenerationState,
  order: readonly PoolTeam[],
  optionsByTeam: ReadonlyMap<string, readonly AnchorOption[]>,
  startIndex: number,
): string[] {
  const violations: string[] = [];
  if (state.unassigned.size < state.remainingSlots) {
    violations.push('global scarcity');
  }
  const eliteMaxByBand: Record<SeasonStrengthBand, number> = {
    contender: state.targets.policy.tierRanges.contender.elite[1],
    playoff: state.targets.policy.tierRanges.playoff.elite[1],
    average: state.targets.policy.tierRanges.average.elite[1],
    weaker: state.targets.policy.tierRanges.weaker.elite[1],
  };
  for (const team of order) {
    if (team.tierCounts.elite > eliteMaxByBand[team.band]) {
      violations.push(`${team.franchiseId} elite range exceeded`);
    }
    if (!poolTenFeasibleAfterAdd(state, team, null)) {
      violations.push(`${team.franchiseId} future pool cannot admit a legal ten`);
    }
  }
  for (let i = startIndex; i < order.length; i += 1) {
    const team = order[i];
    if (team === undefined) continue;
    const guaranteed = state.targets.policy.guaranteedAnchors[team.band];
    const have = team.anchors.length;
    const need = Math.max(0, guaranteed - have);
    if (need > 0) {
      const options = optionsByTeam.get(team.franchiseId) ?? [];
      let left = 0;
      for (const option of options) {
        if (!inAnyPool(state, option.versionId)) left += 1;
      }
      if (left < need) {
        violations.push(
          `${team.franchiseId} has ${String(left)} options left for ${String(need)} guarantees`,
        );
      }
    }
  }
  return violations;
}
export function matchGuaranteedAnchors(state: GenerationState): void {
  const teams = state.teamOrder
    .map((teamId) => state.teams.get(teamId))
    .filter((team): team is PoolTeam => team !== undefined);
  const optionsByTeam = new Map<string, readonly AnchorOption[]>();
  const seedRank = new Map<string, number>();
  for (const team of teams) {
    optionsByTeam.set(team.franchiseId, anchorOptionsFor(state, team));
    seedRank.set(
      team.franchiseId,
      createRng(
        seasonNamespaceSeed(state.seed, 'ai-rosters', 'anchors', team.franchiseId, 'team-rank'),
      ).next(),
    );
  }
  const order = [...teams].sort((a, b) => {
    const optionDiff =
      (optionsByTeam.get(a.franchiseId)?.length ?? 0) -
      (optionsByTeam.get(b.franchiseId)?.length ?? 0);
    if (optionDiff !== 0) return optionDiff;
    const rankDiff = (seedRank.get(a.franchiseId) ?? 0) - (seedRank.get(b.franchiseId) ?? 0);
    if (rankDiff !== 0) return rankDiff;
    return a.franchiseId < b.franchiseId ? -1 : 1;
  });
  const branchOrder = new Map<string, string[]>();
  for (const team of teams) {
    const rng = createRng(
      seasonNamespaceSeed(state.seed, 'ai-rosters', 'anchors', team.franchiseId, 'option-order'),
    );
    const options = optionsByTeam.get(team.franchiseId) ?? [];
    const ranked = [...options]
      .map((option) => ({ option, rank: rng.next() }))
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          (a.option.versionId < b.option.versionId
            ? -1
            : a.option.versionId > b.option.versionId
              ? 1
              : 0),
      );
    branchOrder.set(
      team.franchiseId,
      ranked.map((entry) => entry.option.versionId),
    );
  }
  const optionById = new Map<string, Map<string, AnchorOption>>();
  for (const team of teams) {
    const perTeam = new Map<string, AnchorOption>();
    for (const option of optionsByTeam.get(team.franchiseId) ?? []) {
      perTeam.set(option.versionId, option);
    }
    optionById.set(team.franchiseId, perTeam);
  }
  const solve = (index: number): boolean => {
    state.nodes += 1;
    state.nodesByPhase.anchors += 1;
    checkBudget(state);
    if (index >= order.length) return true;
    const team = order[index];
    if (team === undefined) return false;
    const guaranteed = state.targets.policy.guaranteedAnchors[team.band];
    const have = team.anchors.length;
    if (have >= guaranteed) return solve(index + 1);
    const violations = anchorBranchViolations(state, order, optionsByTeam, index);
    if (violations.length > 0) return false;
    const branch = branchOrder.get(team.franchiseId) ?? [];
    const teamOptions = optionById.get(team.franchiseId);
    for (const versionId of branch) {
      if (inAnyPool(state, versionId)) continue;
      const option = teamOptions?.get(versionId);
      if (option === undefined) continue;
      addAnchor(state, team, option, ['ai-rosters', 'anchors', team.franchiseId, 'guaranteed']);
      const after = anchorBranchViolations(state, order, optionsByTeam, index);
      if (after.length === 0 && solve(index)) return true;
      removeAnchor(state, team, versionId);
    }
    return false;
  };
  if (!solve(0)) {
    const failedTeams = order
      .filter((team) => team.anchors.length < state.targets.policy.guaranteedAnchors[team.band])
      .map((team) => team.franchiseId);
    const unmet = order
      .filter((team) => team.anchors.length < state.targets.policy.guaranteedAnchors[team.band])
      .map(
        (team) =>
          `${team.franchiseId} missing ${String(state.targets.policy.guaranteedAnchors[team.band] - team.anchors.length)} guaranteed anchors`,
      );
    throw exhausted(state, 'anchors', failedTeams, unmet);
  }
}
export function addAnchor(
  state: GenerationState,
  team: PoolTeam,
  option: AnchorOption,
  seedPath: string[],
): void {
  const anchor: SeasonAiAnchor = {
    playerVersionId: option.versionId,
    qualifyingRole: option.qualifyingRole,
    percentileTier: 'elite',
    roleScore: option.roleScore,
    percentileThreshold: option.threshold,
    seedPath,
  };
  team.anchors.push(anchor);
  addPoolMember(state, team, option.versionId, seedPath);
}
export function removeAnchor(state: GenerationState, team: PoolTeam, versionId: string): void {
  team.anchors = team.anchors.filter((anchor) => anchor.playerVersionId !== versionId);
  removePoolMember(state, team, versionId);
}
export function bestExtraEliteOption(state: GenerationState, team: PoolTeam): AnchorOption | null {
  const options = anchorOptionsFor(state, team);
  const rng = createRng(
    seasonNamespaceSeed(state.seed, 'ai-rosters', 'anchors', team.franchiseId, 'extra-elite-order'),
  );
  const ranked = [...options]
    .filter((option) => !inAnyPool(state, option.versionId))
    .map((option) => ({ option, rank: rng.next() }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (a.option.versionId < b.option.versionId
          ? -1
          : a.option.versionId > b.option.versionId
            ? 1
            : 0),
    );
  for (const entry of ranked) {
    state.nodes += 1;
    state.nodesByPhase.anchors += 1;
    checkBudget(state);
    const violations = gatesForAdd(state, team, entry.option.versionId);
    if (violations.length === 0) return entry.option;
  }
  return null;
}
export function rollExtraEliteAnchors(state: GenerationState): void {
  for (const teamId of state.teamOrder) {
    const team = state.teams.get(teamId);
    if (team === undefined) continue;
    const probability = state.targets.policy.extraEliteRollProbability[team.band];
    if (probability <= 0) continue;
    state.nodes += 1;
    state.nodesByPhase.anchors += 1;
    checkBudget(state);
    const rng = createRng(
      seasonNamespaceSeed(state.seed, 'ai-rosters', 'anchors', team.franchiseId, 'extra-elite'),
    );
    if (!rng.chance(probability)) continue;
    const option = bestExtraEliteOption(state, team);
    if (option === null) continue;
    addAnchor(state, team, option, ['ai-rosters', 'anchors', team.franchiseId, 'extra-elite']);
  }
}
