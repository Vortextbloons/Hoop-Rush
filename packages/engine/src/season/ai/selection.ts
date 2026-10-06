import {
  seasonDigestHex,
  seasonNamespaceSeed,
  type EraSimulationProfile,
  type ProjectionModelArtifact,
  type SeasonRosterRole,
} from '@hoop-rush/data-contracts';
import { createRng } from '../../sim/rng.ts';
import { searchRosterRotationCandidates } from '../../projection/index.ts';
import { BAND_CEILING_PENALTY, ROLE_COVERAGE_THRESHOLD, identityScore } from '../ai-scoring.ts';
import {
  legalFiveAfterAnyRemoval,
  rosterGroupCounts,
  validateSeasonRoster,
} from '../roster-rules.ts';
import { buildMinimalRotation, validateSeasonRotation } from '../rotation.ts';
import { coverageFeasibleFromPool, memberReachCapped } from './reachability.ts';
import {
  budgetForPhase,
  exhausted,
  identityScoreOf,
  membersOf,
  playerIdOf,
  reportProgress,
  roleScoresOfIds,
  selectionBudgetExceeded,
  uncoveredRoles,
  uniqueIdentities,
} from './state.ts';
import type { GenerationState, PoolTeam } from './types.ts';

export function rosterLegal(
  state: GenerationState,
  team: PoolTeam,
  ids: readonly string[],
): boolean {
  if (ids.length !== 10) return false;
  if (!uniqueIdentities(state, ids)) return false;
  const members = membersOf(state, ids);
  if (validateSeasonRoster(members).length > 0) return false;
  if (!legalFiveAfterAnyRemoval(members)) return false;
  if (uncoveredRoles(roleScoresOfIds(state, ids)).length > 0) return false;
  let rotation;
  try {
    rotation = buildMinimalRotation({ franchiseId: team.franchiseId, members });
  } catch {
    return false;
  }
  const playable = new Map(
    ids.map((id) => [id, state.byId.get(id)?.positions.playable ?? ([] as const)]),
  );
  return validateSeasonRotation(rotation, playable).length === 0;
}
export function rosterOutlierCount(
  state: GenerationState,
  team: PoolTeam,
  ids: readonly string[],
): number {
  const cap = state.targets.policy.bandPoolScoreCaps[team.band];
  let outliers = 0;
  for (const id of ids) {
    if (identityScoreOf(state, id, team.identity) > cap) outliers += 1;
  }
  return outliers;
}
export function rosterOutlierBudgetOk(
  state: GenerationState,
  team: PoolTeam,
  ids: readonly string[],
): boolean {
  return rosterOutlierCount(state, team, ids) <= state.targets.policy.maxRosterStrengthOutliers;
}
export function selectionRanks(state: GenerationState, team: PoolTeam): Map<string, number> {
  const ranks = new Map<string, number>();
  const rng = createRng(
    seasonNamespaceSeed(state.seed, 'ai-rosters', 'selection', team.franchiseId, 'candidate-order'),
  );
  for (const candidate of state.canonicalCandidates) {
    ranks.set(candidate.playerVersionId, rng.next());
  }
  return ranks;
}
export function selectionPickScore(
  state: GenerationState,
  team: PoolTeam,
  picked: readonly string[],
  id: string,
  uncovered: readonly SeasonRosterRole[],
  rngRanks: ReadonlyMap<string, number>,
): number {
  const trialScores = roleScoresOfIds(state, [...picked, id]);
  let score = identityScore(trialScores, team.identity);
  const memberScores = state.roleScores.get(id);
  if (uncovered.length > 0) {
    let total = 0;
    for (const role of uncovered) total += memberScores?.[role] ?? 0;
    score += (1.6 * total) / uncovered.length;
  }
  const cap = state.targets.policy.bandPoolScoreCaps[team.band];
  const identity = identityScoreOf(state, id, team.identity);
  if (identity > cap) score -= (identity - cap) * BAND_CEILING_PENALTY;
  score += (rngRanks.get(id) ?? 0) * 0.25;
  return score;
}
export function greedySelection(state: GenerationState, team: PoolTeam): string[] | null {
  const picked = [...team.anchors.map((anchor) => anchor.playerVersionId)];
  const rngRanks = selectionRanks(state, team);
  const sortedPool = [...team.pool].sort();
  while (picked.length < 10) {
    const slotsLeft = 10 - picked.length - 1;
    const pickedCounts = rosterGroupCounts(membersOf(state, picked));
    const pickedRoleScores = roleScoresOfIds(state, picked);
    const uncovered = uncoveredRoles(pickedRoleScores);
    let best:
      | {
          id: string;
          score: number;
        }
      | undefined;
    for (const id of sortedPool) {
      if (picked.includes(id)) continue;
      const candidateId = playerIdOf(state, id);
      if (
        candidateId !== undefined &&
        picked.some((pickedId) => playerIdOf(state, pickedId) === candidateId)
      ) {
        continue;
      }
      const mask = state.maskByVersion.get(id) ?? 0;
      const probeCounts = {
        guards: pickedCounts.guards + ((mask & 1) !== 0 ? 1 : 0),
        forwards: pickedCounts.forwards + ((mask & 2) !== 0 ? 1 : 0),
        centers: pickedCounts.centers + ((mask & 4) !== 0 ? 1 : 0),
      };
      const remaining = team.pool.filter(
        (memberId) => !picked.includes(memberId) && memberId !== id,
      );
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
      if (
        !memberReachCapped(
          state,
          { guards: 2, forwards: 2, centers: 1 },
          { guards: 0, forwards: 0, centers: 0 },
          [...picked, id, ...remaining],
          5,
        )
      ) {
        continue;
      }
      const memberScores = state.roleScores.get(id);
      const uncoveredAfter =
        memberScores === undefined
          ? uncovered
          : uncovered.filter((role) => memberScores[role] < ROLE_COVERAGE_THRESHOLD);
      if (!coverageFeasibleFromPool(state, uncoveredAfter, remaining, slotsLeft)) continue;
      if (!rosterOutlierBudgetOk(state, team, [...picked, id])) continue;
      const score = selectionPickScore(state, team, picked, id, uncovered, rngRanks);
      if (best === undefined || score > best.score || (score === best.score && id < best.id)) {
        best = { id, score };
      }
    }
    if (best === undefined) return null;
    picked.push(best.id);
    state.nodes += 1;
    state.nodesByPhase.selection += 1;
    if (selectionBudgetExceeded(state)) return null;
  }
  return picked;
}
export function rosterSelectionScore(
  state: GenerationState,
  team: PoolTeam,
  ten: readonly string[],
): number {
  const roleScores = roleScoresOfIds(state, ten);
  let score = identityScore(roleScores, team.identity);
  const uncovered = uncoveredRoles(roleScores);
  score -= uncovered.length * 2;
  score -= rosterOutlierCount(state, team, ten) * BAND_CEILING_PENALTY;
  const ranges = state.targets.policy.tierRanges[team.band];
  let elite = 0;
  let strong = 0;
  let useful = 0;
  for (const id of ten) {
    const tier = state.poolTiers.get(id) ?? 'depth';
    if (tier === 'elite') elite += 1;
    else if (tier === 'strong') strong += 1;
    else if (tier === 'useful') useful += 1;
  }
  score += Math.max(0, ranges.elite[0] - elite) * 0.5;
  score += Math.max(0, ranges.strong[0] - (elite + strong)) * 0.5;
  score += Math.max(0, ranges.useful[0] - (elite + strong + useful)) * 0.5;
  if (elite > ranges.elite[1]) score -= (elite - ranges.elite[1]) * 1.5;
  if (elite + strong > ranges.strong[1]) {
    score -= (elite + strong - ranges.strong[1]) * 1.5;
  }
  if (elite + strong + useful > ranges.useful[1]) {
    score -= (elite + strong + useful - ranges.useful[1]) * 1.5;
  }
  return score;
}
export function improveSelection(
  state: GenerationState,
  team: PoolTeam,
  ten: readonly string[],
): string[] {
  let current = [...ten];
  let bestScore = rosterSelectionScore(state, team, current);
  const pool = [...team.pool].sort();
  for (;;) {
    if (selectionBudgetExceeded(state)) return current;
    let improved = false;
    for (const outId of current) {
      for (const inId of pool) {
        if (current.includes(inId)) continue;
        state.nodes += 1;
        state.nodesByPhase.selection += 1;
        if (selectionBudgetExceeded(state)) return current;
        const trial = current.filter((id) => id !== outId).concat(inId);
        if (!rosterLegal(state, team, trial)) continue;
        if (!rosterOutlierBudgetOk(state, team, trial)) continue;
        const trialScore = rosterSelectionScore(state, team, trial);
        if (trialScore > bestScore) {
          current = trial;
          bestScore = trialScore;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
    if (!improved) return current;
  }
}
export function bestTenDfs(
  state: GenerationState,
  team: PoolTeam,
  members: readonly string[],
  incumbent: string[] | null,
): string[] | null {
  const ordered = [...members].sort((a, b) => {
    const covA = state.coverageMaskByVersion.get(a) ?? 0;
    const covB = state.coverageMaskByVersion.get(b) ?? 0;
    const bits = (mask: number): number => {
      let count = 0;
      for (let bit = 0; bit < 8; bit += 1) if ((mask & (1 << bit)) !== 0) count += 1;
      return count;
    };
    const bitsDiff = bits(covB) - bits(covA);
    if (bitsDiff !== 0) return bitsDiff;
    const maskA = state.maskByVersion.get(a) ?? 0;
    const maskB = state.maskByVersion.get(b) ?? 0;
    const groupA = (maskA & 4) !== 0 ? 0 : (maskA & 2) !== 0 ? 1 : 2;
    const groupB = (maskB & 4) !== 0 ? 0 : (maskB & 2) !== 0 ? 1 : 2;
    if (groupA !== groupB) return groupA - groupB;
    return a < b ? -1 : 1;
  });
  let best = incumbent;
  const picked: string[] = [];
  let found = false;
  const rec = (index: number): void => {
    if (found) return;
    state.nodes += 1;
    state.nodesByPhase.selection += 1;
    if (selectionBudgetExceeded(state)) return;
    if (picked.length === 10) {
      if (rosterLegal(state, team, picked) && rosterOutlierBudgetOk(state, team, picked)) {
        best = [...picked];
        found = true;
      }
      return;
    }
    const pickedCounts = rosterGroupCounts(membersOf(state, picked));
    const slotsLeft = 10 - picked.length;
    for (let i = index; i < ordered.length; i += 1) {
      const id = ordered[i];
      if (id === undefined) continue;
      const candidateId = playerIdOf(state, id);
      if (
        candidateId !== undefined &&
        picked.some((pickedId) => playerIdOf(state, pickedId) === candidateId)
      ) {
        continue;
      }
      const afterPicked = [...picked, id];
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
      if (
        !memberReachCapped(
          state,
          { guards: 2, forwards: 2, centers: 1 },
          { guards: 0, forwards: 0, centers: 0 },
          [...afterPicked, ...remaining],
          5,
        )
      ) {
        continue;
      }
      const uncoveredAfter = uncoveredRoles(roleScoresOfIds(state, afterPicked));
      if (!coverageFeasibleFromPool(state, uncoveredAfter, ordered.slice(i + 1), slotsLeft - 1)) {
        continue;
      }
      if (!rosterOutlierBudgetOk(state, team, afterPicked)) continue;
      picked.push(id);
      rec(i + 1);
      picked.pop();
    }
  };
  rec(0);
  return best;
}
export function bestRosterFromPool(state: GenerationState, team: PoolTeam): string[] | null {
  const greedy = greedySelection(state, team);
  if (
    greedy !== null &&
    rosterLegal(state, team, greedy) &&
    rosterOutlierBudgetOk(state, team, greedy)
  ) {
    const improved = improveSelection(state, team, greedy);
    if (rosterLegal(state, team, improved) && rosterOutlierBudgetOk(state, team, improved)) {
      return improved;
    }
  }
  return bestTenDfs(
    state,
    team,
    team.pool,
    greedy !== null &&
      rosterLegal(state, team, greedy) &&
      rosterOutlierBudgetOk(state, team, greedy)
      ? greedy
      : null,
  );
}
export function bestRosterFromPoolProjection(
  state: GenerationState,
  team: PoolTeam,
  eraProfile: EraSimulationProfile,
  model: ProjectionModelArtifact,
): string[] | null {
  const anchors = team.anchors.map((anchor) => anchor.playerVersionId);
  let search: ReturnType<typeof searchRosterRotationCandidates>;
  try {
    search = searchRosterRotationCandidates({
      catalog: state.catalog,
      locked: anchors,
      available: team.pool,
      seed: seasonDigestHex(`${state.seed}\u0000ai-projection\u0000${team.franchiseId}`),
      eraProfile,
      model,
      caps: { completeCandidates: 8, rotationsPerRoster: 8 },
    });
  } catch {
    return null;
  }
  for (const candidate of search.ranked) {
    const ids = candidate.projection.minutes.map((row) => row.playerVersionId);
    if (ids.length !== 10) continue;
    if (!anchors.every((anchor) => ids.includes(anchor))) continue;
    if (!rosterLegal(state, team, ids)) continue;
    if (!rosterOutlierBudgetOk(state, team, ids)) continue;
    return [...ids];
  }
  return null;
}
export function selectRosters(state: GenerationState): void {
  const teamCount = Math.max(1, state.teamOrder.length);
  const perTeam = Math.max(150, Math.floor(budgetForPhase(state, 'selection') / teamCount));
  const done: string[] = [];
  for (const teamId of state.teamOrder) {
    const team = state.teams.get(teamId);
    if (team === undefined) continue;
    state.selectionFloor = state.nodesByPhase.selection + perTeam;
    const projection = state.projection;
    const projected =
      projection === undefined
        ? null
        : bestRosterFromPoolProjection(state, team, projection.eraProfile, projection.model);
    const ten = projected ?? bestRosterFromPool(state, team);
    if (ten === null) {
      throw exhausted(
        state,
        'selection',
        [teamId],
        [`no legal roster selected from the pool of ${teamId}`],
      );
    }
    team.selections = ten;
    done.push(teamId);
    reportProgress(state, {
      phase: 'selection',
      completed: done.length,
      total: state.teamOrder.length,
      teamsCompleted: [...done],
    });
  }
}
