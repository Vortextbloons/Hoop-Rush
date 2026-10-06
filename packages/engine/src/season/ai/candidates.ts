import {
  seasonLeagueSchema,
  seasonNamespaceSeed,
  type SeasonAiAssignment,
  type SeasonAiIdentity,
  type SeasonLeague,
  type SeasonRosterRole,
  type SeasonRosterTargets,
  type Seed,
} from '@hoop-rush/data-contracts';
import { createRng, shuffle } from '../../sim/rng.ts';
import {
  ROLE_COVERAGE_THRESHOLD,
  ROSTER_ROLES,
  identityScore,
  percentileTierOf,
  playerPercentileTier,
  rolePercentileThresholds,
  roleScoresOf,
  type PercentileTier,
} from '../ai-scoring.ts';
import { validateDraftCatalog } from '../catalog-validation.ts';
import { groupMaskOf } from '../roster-rules.ts';
import { BAND_ORDER, IDENTITIES, identityPriorityRolesOf } from './constants.ts';
import { maskCountsOf, roleCoverCountsOf } from './state.ts';
import type { GenerationState, PoolTeam, SeasonAiGenerationInput } from './types.ts';

export class SeasonAiTargetsError extends Error {
  readonly code = 'TARGETS_MISMATCH' as const;
  constructor(message: string) {
    super(message);
    this.name = 'SeasonAiTargetsError';
  }
}
export function validateSeasonRosterTargets(targets: SeasonRosterTargets | undefined): void {
  if (!targets) throw new SeasonAiTargetsError('roster targets missing');
  for (const identity of IDENTITIES) {
    const roles = (
      targets.policy.identityPriorityRoles as Partial<
        Record<SeasonAiIdentity, readonly SeasonRosterRole[]>
      >
    )[identity];
    if (roles === undefined || roles.length === 0) {
      throw new SeasonAiTargetsError(`targets lack priority roles for identity ${identity}`);
    }
  }
  const soloTotal =
    targets.policy.bandQuotas.solo.contender +
    targets.policy.bandQuotas.solo.playoff +
    targets.policy.bandQuotas.solo.average +
    targets.policy.bandQuotas.solo.weaker;
  const duoTotal =
    targets.policy.bandQuotas.duo.contender +
    targets.policy.bandQuotas.duo.playoff +
    targets.policy.bandQuotas.duo.average +
    targets.policy.bandQuotas.duo.weaker;
  if (soloTotal !== 29) {
    throw new SeasonAiTargetsError(`solo band quotas must total 29 (got ${String(soloTotal)})`);
  }
  if (duoTotal !== 28) {
    throw new SeasonAiTargetsError(`duo band quotas must total 28 (got ${String(duoTotal)})`);
  }
}
export function assignAiBandsAndIdentities(input: {
  seed: Seed;
  league: SeasonLeague;
  humanFranchiseIds: readonly string[];
  targets: SeasonRosterTargets;
}): SeasonAiAssignment[] {
  const aiTeams = input.league.teams.filter(
    (team) => !input.humanFranchiseIds.includes(team.franchiseId),
  );
  const bandQuotas =
    input.humanFranchiseIds.length === 2
      ? input.targets.policy.bandQuotas.duo
      : input.targets.policy.bandQuotas.solo;
  const shuffled = shuffle(
    aiTeams.map((team) => team.franchiseId).sort(),
    createRng(seasonNamespaceSeed(input.seed, 'ai-rosters', 'band-order')),
  );
  const identityOffset = createRng(
    seasonNamespaceSeed(input.seed, 'ai-rosters', 'identity-order'),
  ).nextInt(0, IDENTITIES.length - 1);
  const counts = identityCounts(aiTeams.length, identityOffset);
  const identityList: SeasonAiIdentity[] = [];
  for (const identity of IDENTITIES) {
    const count = counts[identity];
    for (let i = 0; i < count; i += 1) identityList.push(identity);
  }
  const assignments: SeasonAiAssignment[] = [];
  let teamIndex = 0;
  for (const band of BAND_ORDER) {
    const quota = bandQuotas[band];
    for (let i = 0; i < quota; i += 1) {
      const franchiseId = shuffled[teamIndex];
      const identity = identityList[teamIndex];
      if (franchiseId === undefined || identity === undefined) {
        throw new Error('AI band assignment exhausted its team list');
      }
      assignments.push({ franchiseId, band, identity });
      teamIndex += 1;
    }
  }
  const humanRows: SeasonAiAssignment[] = input.league.teams
    .filter((team) => input.humanFranchiseIds.includes(team.franchiseId))
    .map((team) => ({
      franchiseId: team.franchiseId,
      band: 'average',
      identity: 'continuity',
    }));
  return [...assignments, ...humanRows];
}
function identityCounts(n: number, offset: number): Record<SeasonAiIdentity, number> {
  const base = Math.floor(n / IDENTITIES.length);
  const extra = n % IDENTITIES.length;
  const counts: Record<SeasonAiIdentity, number> = {
    'star-chaser': base,
    'depth-builder': base,
    'defense-first': base,
    'shooting-first': base,
    continuity: base,
    'active-trader': base,
  };
  const rotated = [...IDENTITIES.slice(offset), ...IDENTITIES.slice(0, offset)];
  for (let i = 0; i < extra; i += 1) {
    const identity = rotated[i];
    if (identity !== undefined) counts[identity] += 1;
  }
  return counts;
}
export function prepareGenerationState(input: SeasonAiGenerationInput): {
  state: GenerationState;
  league: SeasonLeague;
} {
  validateSeasonRosterTargets(input.targets);
  const catalog = validateDraftCatalog(input.catalog);
  const leagueParse = seasonLeagueSchema.safeParse(input.league);
  if (!leagueParse.success) {
    throw new Error('league fails the league schema');
  }
  const league = leagueParse.data;
  if (input.humanRosters.length !== input.humanFranchiseIds.length) {
    throw new Error('human roster count must match human franchise count');
  }
  for (const roster of input.humanRosters) {
    if (roster.playerVersionIds.length !== 10) {
      throw new Error(`human roster ${roster.franchiseId} must have exactly ten players`);
    }
    if (new Set(roster.playerVersionIds).size !== roster.playerVersionIds.length) {
      throw new Error(`human roster ${roster.franchiseId} has duplicate versions`);
    }
  }
  const byId = new Map(
    catalog.candidates.map((candidate) => [candidate.playerVersionId, candidate]),
  );
  const humanOwnedIdentities = new Set<string>();
  const identityOwner = new Map<string, string>();
  for (const roster of input.humanRosters) {
    const identities: string[] = [];
    for (const versionId of roster.playerVersionIds) {
      const candidate = byId.get(versionId);
      if (candidate === undefined) {
        throw new Error(`human roster references unknown version ${versionId}`);
      }
      identities.push(candidate.playerId);
    }
    for (const playerId of identities) {
      const owner = identityOwner.get(playerId);
      if (owner !== undefined && owner !== roster.franchiseId) {
        throw new Error(`human rosters claim identity ${playerId} more than once`);
      }
      identityOwner.set(playerId, roster.franchiseId);
      humanOwnedIdentities.add(playerId);
    }
  }
  const humanOwned = new Set(input.humanRosters.flatMap((roster) => roster.playerVersionIds));
  const canonicalCandidates = [...catalog.candidates].sort((a, b) =>
    a.playerVersionId < b.playerVersionId ? -1 : a.playerVersionId > b.playerVersionId ? 1 : 0,
  );
  const versionsByIdentity = new Map<string, string[]>();
  for (const candidate of canonicalCandidates) {
    const versions = versionsByIdentity.get(candidate.playerId) ?? [];
    versions.push(candidate.playerVersionId);
    versionsByIdentity.set(candidate.playerId, versions);
  }
  const populationScores = canonicalCandidates
    .filter((candidate) => !humanOwned.has(candidate.playerVersionId))
    .map((candidate) => roleScoresOf(candidate));
  const thresholds = rolePercentileThresholds(populationScores);
  const roleScores = new Map<string, Record<SeasonRosterRole, number>>();
  const maskByVersion = new Map<string, number>();
  const coverageMaskByVersion = new Map<string, number>();
  const roleTiers = new Map<string, Record<SeasonRosterRole, PercentileTier>>();
  const poolTiers = new Map<string, PercentileTier>();
  const identityScores = new Map<string, Record<SeasonAiIdentity, number>>();
  const identityPriorityTotals = new Map<string, Record<SeasonAiIdentity, number>>();
  for (const candidate of canonicalCandidates) {
    const scores = roleScoresOf(candidate);
    roleScores.set(candidate.playerVersionId, scores);
    maskByVersion.set(candidate.playerVersionId, groupMaskOf(candidate.positions.playable));
    let coverageMask = 0;
    ROSTER_ROLES.forEach((role, roleIndex) => {
      if (scores[role] >= ROLE_COVERAGE_THRESHOLD) coverageMask |= 1 << roleIndex;
    });
    coverageMaskByVersion.set(candidate.playerVersionId, coverageMask);
    const tiers = percentileTierOf(scores, thresholds);
    roleTiers.set(candidate.playerVersionId, tiers);
    poolTiers.set(candidate.playerVersionId, playerPercentileTier(tiers));
    const identityScoresFor = {} as Record<SeasonAiIdentity, number>;
    const priorityTotalsFor = {} as Record<SeasonAiIdentity, number>;
    for (const identity of IDENTITIES) {
      identityScoresFor[identity] = identityScore(scores, identity);
      let priorityTotal = 0;
      for (const role of identityPriorityRolesOf(input.targets, identity)) {
        priorityTotal += scores[role];
      }
      priorityTotalsFor[identity] = priorityTotal;
    }
    identityScores.set(candidate.playerVersionId, identityScoresFor);
    identityPriorityTotals.set(candidate.playerVersionId, priorityTotalsFor);
  }
  const assignments = new Map(
    assignAiBandsAndIdentities({
      seed: input.seed,
      league,
      humanFranchiseIds: input.humanFranchiseIds,
      targets: input.targets,
    }).map((assignment) => [assignment.franchiseId, assignment]),
  );
  const teamOrder = league.teams
    .filter((team) => !input.humanFranchiseIds.includes(team.franchiseId))
    .map((team) => team.franchiseId)
    .sort();
  const zeroTierCounts = (): Record<PercentileTier, number> => ({
    elite: 0,
    strong: 0,
    useful: 0,
    depth: 0,
  });
  const teams = new Map<string, PoolTeam>();
  for (const franchiseId of teamOrder) {
    const assignment = assignments.get(franchiseId);
    if (!assignment) throw new Error(`no AI assignment for ${franchiseId}`);
    teams.set(franchiseId, {
      franchiseId,
      band: assignment.band,
      identity: assignment.identity,
      pool: [],
      groupCounts: { guards: 0, forwards: 0, centers: 0 },
      coverageMask: 0,
      tierCounts: zeroTierCounts(),
      outliers: 0,
      anchors: [],
      seedPaths: [],
      memberPaths: new Map(),
      repairCount: 0,
      selections: null,
    });
  }
  const initialUnassigned = canonicalCandidates
    .filter(
      (candidate) =>
        !humanOwned.has(candidate.playerVersionId) && !humanOwnedIdentities.has(candidate.playerId),
    )
    .map((candidate) => candidate.playerVersionId);
  const initialMaskCounts = maskCountsOf(initialUnassigned, maskByVersion);
  const state: GenerationState = {
    seed: input.seed,
    catalog,
    byId,
    maskByVersion,
    roleScores,
    coverageMaskByVersion,
    roleTiers,
    poolTiers,
    identityScores,
    identityPriorityTotals,
    thresholds,
    humanOwned,
    claimedIdentities: new Set(humanOwnedIdentities),
    versionsByIdentity,
    unassigned: new Set(initialUnassigned),
    unassignedMaskCountsArr: initialMaskCounts,
    unassignedRoleCoverCounts: roleCoverCountsOf(initialUnassigned, coverageMaskByVersion),
    remainingSlots: teamOrder.length * input.targets.policy.poolSize,
    teams,
    teamOrder,
    targets: input.targets,
    canonicalCandidates,
    nodes: 0,
    nodesByPhase: { anchors: 0, 'pool-fill': 0, selection: 0 },
    phase: 'anchors',
    selectionFloor: 0,
    backtracks: 0,
    bans: new Set(),
    assignments,
    onProgress: input.onProgress,
    ...(input.projection !== undefined ? { projection: input.projection } : {}),
  };
  return { state, league };
}
