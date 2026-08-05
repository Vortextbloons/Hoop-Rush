import {
  SEASON_AI_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROTATION_VERSION,
  seasonLeagueGenerationResultSchema,
  seasonLeagueSchema,
  seasonNamespaceSeed,
  type SeasonAiAssignment,
  type SeasonDraftCatalog,
  type SeasonLeague,
  type SeasonLeagueGenerationResult,
  type SeasonRosterCalibrationRun,
  type SeasonRosterEvaluation,
  type SeasonRosterRole,
  type SeasonRosterTargets,
  type SeasonStrengthBand,
  type Seed,
} from '@hoop-rush/data-contracts';
import { createRng, shuffle } from '../sim/rng.ts';
import { validateDraftCatalog } from './catalog-validation.ts';
import { buildMinimalRotation } from './rotation.ts';
import { seasonGenerationDigest } from './digest.ts';
import {
  completionTargetsMet,
  groupMaskOf,
  legalFiveAfterAnyRemoval,
  rosterFeasibleFromCounts,
  rosterGroupCounts,
  validateSeasonRoster,
  type SeasonRosterMemberInput,
} from './roster-rules.ts';
import {
  BAND_CEILING_PENALTY,
  BAND_SCORE_CEILINGS,
  BAND_SELECTION_BIAS,
  ROSTER_ROLES,
  ROLE_COVERAGE_THRESHOLD,
  identityScore,
  overallReportOf,
  roleScoresOf,
  type SeasonScoreMember,
} from './ai-scoring.ts';

/**
 * Deterministic AI league generation (spec/2.0/03, season-ai-v1,
 * roster-generation-v1, M2.1). Strength bands receive fixed quotas and the
 * six decision identities differ in count by at most one; candidates are
 * scored from detailed possession inputs with future-legality pruning and an
 * exact role-coverage feasibility DP, then repaired and, when needed,
 * backtracked under the versioned node budget. Generation never duplicates a
 * version and never relaxes legality.
 */

export const SOLO_BAND_QUOTAS = {
  contender: 4,
  playoff: 8,
  average: 10,
  weaker: 7,
} as const;

/** Two-human generation removes one team from the largest quota (average). */
export const DUO_BAND_QUOTAS = {
  contender: 4,
  playoff: 8,
  average: 9,
  weaker: 7,
} as const;

export const AI_GENERATION_NODE_BUDGET = 100_000;

export const BAND_ORDER: readonly SeasonStrengthBand[] = [
  'contender',
  'playoff',
  'average',
  'weaker',
];

const IDENTITIES = [
  'star-chaser',
  'depth-builder',
  'defense-first',
  'shooting-first',
  'continuity',
  'active-trader',
] as const;

export type SeasonAiIdentity = (typeof IDENTITIES)[number];

function groupMask(playable: readonly string[]): number {
  return groupMaskOf(playable as readonly ('PG' | 'SG' | 'SF' | 'PF' | 'C')[]);
}

/** Identity counts for n AI teams: every identity within one of the rest. */
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
  // The rotated identity list decides which identities receive the extra
  // team; the smaller-count set rotates with the root seed.
  const rotated = [...IDENTITIES.slice(offset), ...IDENTITIES.slice(0, offset)];
  for (let i = 0; i < extra; i += 1) {
    const identity = rotated[i];
    if (identity !== undefined) counts[identity] += 1;
  }
  return counts;
}

/** Band + identity assignment for all 30 franchises for a run seed. */
export function assignAiBandsAndIdentities(input: {
  seed: Seed;
  league: SeasonLeague;
  humanFranchiseIds: readonly string[];
}): SeasonAiAssignment[] {
  const aiTeams = input.league.teams.filter(
    (team) => !input.humanFranchiseIds.includes(team.franchiseId),
  );
  const quotas = input.humanFranchiseIds.length === 2 ? DUO_BAND_QUOTAS : SOLO_BAND_QUOTAS;
  const shuffled = shuffle(
    aiTeams.map((team) => team.franchiseId),
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
    for (let i = 0; i < quotas[band]; i += 1) {
      const franchiseId = shuffled[teamIndex];
      const identity = identityList[teamIndex];
      if (franchiseId === undefined || identity === undefined) {
        throw new Error('AI band assignment exhausted its team list');
      }
      assignments.push({ franchiseId, band, identity });
      teamIndex += 1;
    }
  }
  // Human franchises are informational placeholders; they never consume AI
  // quota slots or identity counts.
  const humanRows: SeasonAiAssignment[] = input.league.teams
    .filter((team) => input.humanFranchiseIds.includes(team.franchiseId))
    .map((team) => ({
      franchiseId: team.franchiseId,
      band: 'average',
      identity: 'continuity',
    }));
  return [...assignments, ...humanRows];
}

/** Per-roster strength evaluation from possession inputs. */
export function evaluateSeasonRoster(input: {
  franchiseId: string;
  band: SeasonAiAssignment['band'];
  identity: SeasonAiAssignment['identity'];
  members: readonly SeasonScoreMember[];
}): SeasonRosterEvaluation {
  const roleScores: Record<SeasonRosterRole, number> = {
    'primary-creation': 0,
    'secondary-creation': 0,
    'perimeter-shooting': 0,
    'rim-finishing-interior-scoring': 0,
    'perimeter-defense': 0,
    'interior-defense': 0,
    'offensive-rebounding': 0,
    'defensive-rebounding': 0,
  };
  for (const member of input.members) {
    const scores = roleScoresOf(member);
    for (const role of ROSTER_ROLES) {
      roleScores[role] = Math.max(roleScores[role], scores[role]);
    }
  }
  const rolesCovered = ROSTER_ROLES.filter((role) => roleScores[role] >= ROLE_COVERAGE_THRESHOLD);
  return {
    franchiseId: input.franchiseId,
    band: input.band,
    identity: input.identity,
    strengthScore: identityScore(roleScores, input.identity),
    roleScores,
    rolesCovered,
    overallReport: overallReportOf(input.members),
  };
}

export class SeasonAiGenerationError extends Error {
  readonly code = 'GENERATION_EXHAUSTED' as const;
  readonly diagnostics: SeasonLeagueGenerationResult['diagnostics'];

  constructor(
    diagnostics: SeasonLeagueGenerationResult['diagnostics'],
    message = 'AI roster generation exhausted its node budget',
  ) {
    super(message);
    this.name = 'SeasonAiGenerationError';
    this.diagnostics = diagnostics;
  }
}

export interface SeasonAiGenerationInput {
  seed: Seed;
  catalog: SeasonDraftCatalog;
  league: SeasonLeague;
  /** Human franchises are excluded from AI generation. */
  humanFranchiseIds: readonly string[];
  /** Finalized human ownership (version ids per human franchise). */
  humanRosters: ReadonlyArray<{ franchiseId: string; playerVersionIds: string[] }>;
  targets: SeasonRosterTargets | null;
}

interface GenerationContext {
  catalog: SeasonDraftCatalog;
  byId: Map<string, SeasonDraftCatalog['candidates'][number]>;
  /** Precomputed role scores per candidate (possession inputs only). */
  roleScoresByVersion: Map<string, Record<SeasonRosterRole, number>>;
  /** Precomputed coarse group mask per candidate. */
  maskByVersion: Map<string, number>;
  /**
   * Precomputed 8-bit role-coverage mask per candidate (bit i set when
   * ROSTER_ROLES[i] is covered); the exact-coverage DP ANDs this with the
   * uncovered subset instead of rescanning per role.
   */
  coverageMaskByVersion: Map<string, number>;
  /** Candidates bucketed by coarse group mask, each bucket in catalog order. */
  byMask: string[][];
  /** Per-team seeded candidate ranks, computed once (seed and team are fixed). */
  ranksByTeam: Map<string, Map<string, number>>;
  /** Precomputed identity scores (one per identity) per candidate. */
  identityScoresByVersion: Map<string, Record<SeasonAiIdentity, number>>;
  seed: Seed;
  assignments: Map<string, SeasonAiAssignment>;
  rosters: Map<string, string[]>;
  unowned: Set<string>;
  /** Per-mask counts of unowned candidates, refreshed after every pick. */
  availableMaskCounts: number[];
  nodes: number;
  nodeBudget: number;
  teamsRepaired: number;
  backtracks: number;
  humanFranchiseIds: readonly string[];
}

function candidateScore(
  ctx: GenerationContext,
  candidateId: string,
  team: { band: SeasonStrengthBand; identity: SeasonAiIdentity },
  scores: Record<SeasonRosterRole, number> | undefined,
  uncovered: readonly SeasonRosterRole[],
  rngRanks: Map<string, number>,
): number {
  if (scores === undefined) return -Infinity;
  const identity =
    ctx.identityScoresByVersion.get(candidateId)?.[team.identity] ??
    identityScore(scores, team.identity);
  let score = identity + BAND_SELECTION_BIAS[team.band];
  const ceiling = BAND_SCORE_CEILINGS[team.band];
  if (identity > ceiling) {
    score -= (identity - ceiling) * BAND_CEILING_PENALTY;
  }
  if (uncovered.length > 0) {
    let uncoveredTotal = 0;
    for (const role of uncovered) uncoveredTotal += scores[role];
    score += (1.6 * uncoveredTotal) / uncovered.length;
  }
  const rank = rngRanks.get(candidateId) ?? 0;
  return score + rank * 1e-9;
}

/** Exact role-coverage feasibility: can `slots` picks cover all uncovered roles? */
function coverageFeasible(
  ctx: GenerationContext,
  uncovered: readonly SeasonRosterRole[],
  slots: number,
): boolean {
  if (uncovered.length === 0) return true;
  if (uncovered.length > slots) return false;
  // Bit positions follow ROSTER_ROLES order, so the mask of the uncovered
  // subset is the candidate's precomputed coverage mask AND the subset mask.
  let subsetMask = 0;
  for (const role of uncovered) {
    const index = ROSTER_ROLES.indexOf(role);
    if (index >= 0) subsetMask |= 1 << index;
  }
  const maskCounts = new Array<number>(1 << uncovered.length).fill(0);
  for (const candidate of ctx.catalog.candidates) {
    if (!ctx.unowned.has(candidate.playerVersionId)) continue;
    const covered = ctx.coverageMaskByVersion.get(candidate.playerVersionId);
    if (covered === undefined) continue;
    const masked = covered & subsetMask;
    if (masked !== 0) maskCounts[masked] = (maskCounts[masked] ?? 0) + 1;
  }
  const full = (1 << uncovered.length) - 1;
  const reachable = new Uint8Array((slots + 1) * (full + 1));
  reachable[0] = 1;
  for (let mask = 1; mask <= full; mask += 1) {
    const count = maskCounts[mask] ?? 0;
    if (count === 0) continue;
    for (let used = slots - 1; used >= 0; used -= 1) {
      const maxAdd = Math.min(count, slots - used);
      for (let covered = full; covered >= 0; covered -= 1) {
        const idx = used * (full + 1) + covered;
        if (reachable[idx] === 0) continue;
        for (let add = 1; add <= maxAdd; add += 1) {
          const nidx = (used + add) * (full + 1) + (covered | mask);
          reachable[nidx] = 1;
        }
      }
    }
  }
  return reachable[slots * (full + 1) + full] === 1;
}

function membersOf(
  ctx: GenerationContext,
  versionIds: readonly string[],
): SeasonRosterMemberInput[] {
  const members: SeasonRosterMemberInput[] = [];
  for (const versionId of versionIds) {
    const candidate = ctx.byId.get(versionId);
    if (candidate === undefined) {
      throw new Error(`catalog is missing roster version ${versionId}`);
    }
    members.push({ playerVersionId: versionId, playable: candidate.positions.playable });
  }
  return members;
}

function rosterRoleScores(
  ctx: GenerationContext,
  versionIds: readonly string[],
): Record<SeasonRosterRole, number> {
  const roleScores: Record<SeasonRosterRole, number> = {
    'primary-creation': 0,
    'secondary-creation': 0,
    'perimeter-shooting': 0,
    'rim-finishing-interior-scoring': 0,
    'perimeter-defense': 0,
    'interior-defense': 0,
    'offensive-rebounding': 0,
    'defensive-rebounding': 0,
  };
  for (const versionId of versionIds) {
    const scores = ctx.roleScoresByVersion.get(versionId);
    if (scores === undefined) continue;
    for (const role of ROSTER_ROLES) {
      roleScores[role] = Math.max(roleScores[role], scores[role]);
    }
  }
  return roleScores;
}

function uncoveredRoles(roleScores: Record<SeasonRosterRole, number>): SeasonRosterRole[] {
  return ROSTER_ROLES.filter((role) => roleScores[role] < ROLE_COVERAGE_THRESHOLD);
}

/** Deterministic seeded ranks for candidate tie-breaking (canonical draws). */
function candidateRanks(ctx: GenerationContext, teamId: string): Map<string, number> {
  const cached = ctx.ranksByTeam.get(teamId);
  if (cached !== undefined) return cached;
  const rng = createRng(seasonNamespaceSeed(ctx.seed, 'ai-rosters', 'candidate-order', teamId));
  const canonical = [...ctx.catalog.candidates].sort((a, b) =>
    a.playerVersionId < b.playerVersionId ? -1 : 1,
  );
  const ranks = new Map<string, number>();
  canonical.forEach((candidate) => {
    ranks.set(candidate.playerVersionId, rng.next());
  });
  ctx.ranksByTeam.set(teamId, ranks);
  return ranks;
}

/** Recomputes per-mask counts of unowned candidates (after ownership changes). */
function refreshAvailableCounts(ctx: GenerationContext): void {
  const counts = new Array<number>(8).fill(0);
  for (const candidate of ctx.catalog.candidates) {
    if (!ctx.unowned.has(candidate.playerVersionId)) continue;
    const mask = ctx.maskByVersion.get(candidate.playerVersionId) ?? 0;
    if (mask !== 0) counts[mask] = (counts[mask] ?? 0) + 1;
  }
  ctx.availableMaskCounts = counts;
}

/** Greedy pick for one team at one slot with future-legality pruning. */
function pickForTeam(
  ctx: GenerationContext,
  team: { franchiseId: string; band: SeasonStrengthBand; identity: SeasonAiIdentity },
  slot: number,
  excluded: ReadonlySet<string>,
): void {
  const ownedIds = ctx.rosters.get(team.franchiseId) ?? [];
  const remaining = 10 - ownedIds.length;
  const ownedMembers = membersOf(ctx, ownedIds);
  const roleScores = rosterRoleScores(ctx, ownedIds);
  const uncovered = uncoveredRoles(roleScores);
  const ownedCounts = rosterGroupCounts(ownedMembers);

  // One pass over the unowned candidates: bucket probes by mask and build the
  // per-mask counts used by every feasibility probe. Buckets are prebuilt in
  // catalog order, so the first unowned entry per mask is the same probe the
  // full-catalog scan would find.
  const availableMaskCounts = new Array<number>(8).fill(0);
  const probeByMask = new Array<string | undefined>(8).fill(undefined);
  for (let mask = 1; mask <= 7; mask += 1) {
    const bucket = ctx.byMask[mask];
    if (bucket === undefined) continue;
    for (const candidateId of bucket) {
      if (!ctx.unowned.has(candidateId) || excluded.has(candidateId)) continue;
      availableMaskCounts[mask] = (availableMaskCounts[mask] ?? 0) + 1;
      if (probeByMask[mask] === undefined) probeByMask[mask] = candidateId;
    }
  }
  ctx.availableMaskCounts = availableMaskCounts;

  // Future-legality pruning by group mask: at most seven DP probes, each
  // reusing the precomputed per-mask counts minus the probed candidate.
  const feasibleMasks = new Set<number>();
  for (let mask = 1; mask <= 7; mask += 1) {
    const probeId = probeByMask[mask];
    if (probeId === undefined) continue;
    ctx.nodes += 1;
    const probeCounts = { ...ownedCounts };
    if ((mask & 1) !== 0) probeCounts.guards += 1;
    if ((mask & 2) !== 0) probeCounts.forwards += 1;
    if ((mask & 4) !== 0) probeCounts.centers += 1;
    const adjusted = [...availableMaskCounts];
    adjusted[mask] = (adjusted[mask] ?? 0) - 1;
    if (rosterFeasibleFromCounts(probeCounts, adjusted, remaining - 1)) {
      feasibleMasks.add(mask);
    }
  }

  const rngRanks = candidateRanks(ctx, team.franchiseId);
  const guardDeficit = Math.max(0, 4 - ownedCounts.guards);
  const forwardDeficit = Math.max(0, 4 - ownedCounts.forwards);
  const centerDeficit = Math.max(0, 3 - ownedCounts.centers);
  const maxDeficit = Math.max(guardDeficit, forwardDeficit, centerDeficit);
  const mostDeficient = new Set<number>();
  if (guardDeficit === maxDeficit && guardDeficit > 0) mostDeficient.add(1);
  if (forwardDeficit === maxDeficit && forwardDeficit > 0) mostDeficient.add(2);
  if (centerDeficit === maxDeficit && centerDeficit > 0) mostDeficient.add(4);
  const mostDeficientList = [...mostDeficient];
  const uncoveredExists = uncovered.length > 0;
  // Role-coverage feasibility with the remaining slots (including this one).
  if (uncoveredExists) {
    if (!coverageFeasible(ctx, uncovered, remaining)) {
      throw new BacktrackSignal(team.franchiseId, 'coverage infeasible');
    }
  }
  // One pass over the feasible-mask buckets: filter, score, and track the
  // best candidate. The winner is the same the map+sort produces (score
  // descending, version id ascending on exact ties), without materializing
  // or sorting the candidate list.
  let best: { candidate: SeasonDraftCatalog['candidates'][number]; score: number } | undefined;
  for (const mask of feasibleMasks) {
    const bucket = ctx.byMask[mask];
    if (bucket === undefined) continue;
    for (const candidateId of bucket) {
      if (!ctx.unowned.has(candidateId) || excluded.has(candidateId)) continue;
      const scores = ctx.roleScoresByVersion.get(candidateId);
      if (scores === undefined) continue;
      if (uncoveredExists) {
        const coversNew = uncovered.some((role) => scores[role] >= ROLE_COVERAGE_THRESHOLD);
        if (!coversNew) continue;
      }
      // Every pick must help the most-deficient completion group so guards
      // and centers can never fall behind the remaining slot budget and teams
      // cannot hoard scarce coverage.
      if (mostDeficientList.length > 0) {
        const helpsMost = mostDeficientList.some((group) => (mask & group) !== 0);
        if (!helpsMost) continue;
      }
      const candidate = ctx.byId.get(candidateId);
      if (candidate === undefined) continue;
      const score = candidateScore(ctx, candidateId, team, scores, uncovered, rngRanks);
      if (
        best === undefined ||
        score > best.score ||
        (score === best.score && candidateId.localeCompare(best.candidate.playerVersionId) < 0)
      ) {
        best = { candidate, score };
      }
    }
  }
  if (best === undefined) {
    throw new BacktrackSignal(team.franchiseId, 'no legal candidate at slot');
  }
  ctx.unowned.delete(best.candidate.playerVersionId);
  ctx.rosters.set(team.franchiseId, [...ownedIds, best.candidate.playerVersionId]);
  const pickedMask = ctx.maskByVersion.get(best.candidate.playerVersionId) ?? 0;
  if (pickedMask !== 0) {
    ctx.availableMaskCounts[pickedMask] = (ctx.availableMaskCounts[pickedMask] ?? 0) - 1;
  }
}

class BacktrackSignal extends Error {
  readonly teamId: string;
  readonly reason: string;

  constructor(teamId: string, reason: string) {
    super(`backtrack ${teamId}: ${reason}`);
    this.name = 'BacktrackSignal';
    this.teamId = teamId;
    this.reason = reason;
  }
}

function rosterViolations(ctx: GenerationContext, teamId: string): string[] {
  const ids = ctx.rosters.get(teamId) ?? [];
  if (ids.length !== 10) return ['roster is not full'];
  const members = membersOf(ctx, ids);
  const failures = validateSeasonRoster(members);
  if (!completionTargetsMet(members)) failures.push('completion target missed');
  const uncovered = uncoveredRoles(rosterRoleScores(ctx, ids));
  if (uncovered.length > 0) {
    failures.push(`uncovered roles: ${uncovered.join(',')}`);
  }
  return failures;
}

/** Deterministic repair: unassigned swaps first, then cross-team swaps. */
function repairPass(ctx: GenerationContext, aiTeams: readonly { franchiseId: string }[]): boolean {
  let changed = false;
  for (const team of aiTeams) {
    const violations = rosterViolations(ctx, team.franchiseId);
    if (violations.length === 0) continue;
    const ids = ctx.rosters.get(team.franchiseId) ?? [];
    const roleScores = rosterRoleScores(ctx, ids);
    const uncovered = uncoveredRoles(roleScores);
    // Try unassigned candidates first: swap out the member whose removal
    // most helps (weakest contribution to an uncovered role).
    const removable = [...ids].sort((a, b) => {
      const scoreA = scoreContribution(ctx, a, uncovered);
      const scoreB = scoreContribution(ctx, b, uncovered);
      return scoreA - scoreB;
    });
    // The unassigned pool cannot change while this team is being repaired
    // (ownership only moves on a successful swap, which breaks out), so it
    // is filtered and sorted once per team instead of once per removable.
    const unassigned = ctx.catalog.candidates
      .filter((c) => ctx.unowned.has(c.playerVersionId))
      .sort((a, b) => b.summaryRatings.overallRating - a.summaryRatings.overallRating);
    for (const removeId of removable) {
      const remaining = ids.filter((id) => id !== removeId);
      for (const candidate of unassigned) {
        ctx.nodes += 1;
        const trial = [...remaining, candidate.playerVersionId];
        const members = membersOf(ctx, trial);
        if (
          validateSeasonRoster(members).length === 0 &&
          completionTargetsMet(members) &&
          uncoveredRoles(rosterRoleScores(ctx, trial)).length === 0
        ) {
          ctx.rosters.set(team.franchiseId, trial);
          ctx.unowned.add(removeId);
          ctx.unowned.delete(candidate.playerVersionId);
          refreshAvailableCounts(ctx);
          ctx.teamsRepaired += 1;
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
  return changed;
}

/** Contribution of a member to the currently uncovered roles (lower is worse). */
function scoreContribution(
  ctx: GenerationContext,
  versionId: string,
  uncovered: readonly SeasonRosterRole[],
): number {
  const candidate = ctx.byId.get(versionId);
  if (candidate === undefined) return 0;
  const scores = roleScoresOf(candidate);
  if (uncovered.length === 0) {
    return identityScore(scores, 'continuity');
  }
  let total = 0;
  for (const role of uncovered) total += scores[role];
  return total / uncovered.length;
}

/** True when the team roster with `versionId` swapped out stays fully legal. */
function teamLegalWithout(ctx: GenerationContext, teamId: string, versionId: string): boolean {
  const ids = (ctx.rosters.get(teamId) ?? []).filter((id) => id !== versionId);
  if (ids.length !== 9) return false;
  const members = membersOf(ctx, ids);
  const counts = rosterGroupCounts(members);
  return (
    validateSeasonRoster(members).length === 0 &&
    legalFiveAfterAnyRemoval(members) &&
    rosterFeasibleFromCounts(counts, ctx.availableMaskCounts, 1)
  );
}

/**
 * Cross-team repair: a violating team takes a version from a donor team that
 * can still complete without it. Deterministic order: violating teams in
 * league order, donors in league order, versions in donor-roster order.
 */
function crossTeamRepairPass(
  ctx: GenerationContext,
  aiTeams: readonly { franchiseId: string }[],
): boolean {
  let changed = false;
  for (const team of aiTeams) {
    const violations = rosterViolations(ctx, team.franchiseId);
    if (violations.length === 0) continue;
    const teamIds = ctx.rosters.get(team.franchiseId) ?? [];
    const roleScores = rosterRoleScores(ctx, teamIds);
    const uncovered = uncoveredRoles(roleScores);
    // The weakest member is the swap candidate when the team is full.
    const removable = [...teamIds].sort((a, b) => {
      const scoreA = scoreContribution(ctx, a, uncovered);
      const scoreB = scoreContribution(ctx, b, uncovered);
      return scoreA - scoreB;
    });
    for (const donor of aiTeams) {
      if (donor.franchiseId === team.franchiseId) continue;
      const donorIds = ctx.rosters.get(donor.franchiseId) ?? [];
      for (const versionId of donorIds) {
        if (!teamLegalWithout(ctx, donor.franchiseId, versionId)) continue;
        const base = teamIds.length === 10 ? teamIds.filter((id) => id !== removable[0]) : teamIds;
        const trial = [...base, versionId];
        const members = membersOf(ctx, trial);
        if (
          trial.length === 10 &&
          validateSeasonRoster(members).length === 0 &&
          completionTargetsMet(members) &&
          uncoveredRoles(rosterRoleScores(ctx, trial)).length === 0
        ) {
          ctx.rosters.set(team.franchiseId, trial);
          ctx.rosters.set(
            donor.franchiseId,
            donorIds.filter((id) => id !== versionId),
          );
          if (teamIds.length === 10) {
            const removed = removable[0];
            if (removed !== undefined) {
              ctx.unowned.add(removed);
            }
          }
          refreshAvailableCounts(ctx);
          ctx.teamsRepaired += 1;
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
  return changed;
}

/**
 * Generates the remaining AI league atomically. Throws
 * `SeasonAiGenerationError` on node-budget exhaustion with full diagnostics.
 */
export function generateAiLeague(input: SeasonAiGenerationInput): SeasonLeagueGenerationResult {
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
  const byId = new Map(catalog.candidates.map((c) => [c.playerVersionId, c]));
  for (const roster of input.humanRosters) {
    for (const versionId of roster.playerVersionIds) {
      if (!byId.has(versionId)) {
        throw new Error(`human roster references unknown version ${versionId}`);
      }
    }
  }
  const humanOwned = new Set(input.humanRosters.flatMap((r) => r.playerVersionIds));
  const roleScoresByVersion = new Map<string, Record<SeasonRosterRole, number>>();
  const maskByVersion = new Map<string, number>();
  const coverageMaskByVersion = new Map<string, number>();
  const byMask: string[][] = Array.from({ length: 8 }, () => []);
  const identityScoresByVersion = new Map<string, Record<SeasonAiIdentity, number>>();
  for (const candidate of catalog.candidates) {
    const scores = roleScoresOf(candidate);
    roleScoresByVersion.set(candidate.playerVersionId, scores);
    const mask = groupMask(candidate.positions.playable);
    maskByVersion.set(candidate.playerVersionId, mask);
    const bucket = byMask[mask];
    if (bucket !== undefined) bucket.push(candidate.playerVersionId);
    let coverageMask = 0;
    ROSTER_ROLES.forEach((role, roleIndex) => {
      if (scores[role] >= ROLE_COVERAGE_THRESHOLD) coverageMask |= 1 << roleIndex;
    });
    coverageMaskByVersion.set(candidate.playerVersionId, coverageMask);
    const identityScores = {} as Record<SeasonAiIdentity, number>;
    for (const identity of IDENTITIES) {
      identityScores[identity] = identityScore(scores, identity);
    }
    identityScoresByVersion.set(candidate.playerVersionId, identityScores);
  }
  const ctx: GenerationContext = {
    catalog,
    byId,
    roleScoresByVersion,
    maskByVersion,
    coverageMaskByVersion,
    byMask,
    ranksByTeam: new Map(),
    identityScoresByVersion,
    seed: input.seed,
    assignments: new Map(
      assignAiBandsAndIdentities({
        seed: input.seed,
        league,
        humanFranchiseIds: input.humanFranchiseIds,
      }).map((a) => [a.franchiseId, a]),
    ),
    rosters: new Map(),
    unowned: new Set(
      catalog.candidates.map((c) => c.playerVersionId).filter((id) => !humanOwned.has(id)),
    ),
    availableMaskCounts: new Array<number>(8).fill(0),
    nodes: 0,
    nodeBudget: AI_GENERATION_NODE_BUDGET,
    teamsRepaired: 0,
    backtracks: 0,
    humanFranchiseIds: input.humanFranchiseIds,
  };
  const aiTeams = league.teams
    .filter((team) => !input.humanFranchiseIds.includes(team.franchiseId))
    .map((team) => {
      const assignment = ctx.assignments.get(team.franchiseId);
      if (!assignment) throw new Error(`no AI assignment for ${team.franchiseId}`);
      return {
        franchiseId: team.franchiseId,
        band: assignment.band,
        identity: assignment.identity,
      };
    });

  const throwIfExhausted = (): void => {
    if (ctx.nodes > ctx.nodeBudget) {
      const failedTeams = aiTeams
        .filter((team) => rosterViolations(ctx, team.franchiseId).length > 0)
        .map((team) => team.franchiseId);
      throw new SeasonAiGenerationError({
        seed: input.seed,
        aiVersion: SEASON_AI_VERSION,
        rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
        teamsGenerated: [...ctx.rosters.keys()].length,
        teamsRepaired: ctx.teamsRepaired,
        backtracks: ctx.backtracks,
        nodesVisited: ctx.nodes,
        nodeBudget: ctx.nodeBudget,
        failedTeams,
        unmetConstraints: failedTeams.map((teamId) => rosterViolations(ctx, teamId).join('; ')),
      });
    }
  };

  // Greedy: process teams sequentially in band order (contenders first),
  // seeded within each band. Within one team's ten consecutive picks the
  // feasibility proof is monotone — no other team consumes the candidates
  // the proof relies on — so a team's picks can never dead-end.
  try {
    for (const band of BAND_ORDER) {
      const bandTeams = aiTeams.filter((team) => team.band === band);
      const order = shuffle(
        bandTeams.map((team) => team.franchiseId),
        createRng(seasonNamespaceSeed(input.seed, 'ai-rosters', 'team-order', band)),
      );
      for (const franchiseId of order) {
        const team = bandTeams.find((t) => t.franchiseId === franchiseId);
        if (!team) throw new Error('team order resolved outside the band');
        for (let slot = 0; slot < 10; slot += 1) {
          pickForTeam(ctx, team, slot, new Set());
          throwIfExhausted();
        }
      }
    }
    // Repair passes: unassigned swaps first, then cross-team swaps.
    for (let pass = 0; pass < 3; pass += 1) {
      const repaired = repairPass(ctx, aiTeams);
      const crossRepaired = crossTeamRepairPass(ctx, aiTeams);
      if (!repaired && !crossRepaired) break;
      throwIfExhausted();
    }
  } catch (error) {
    if (error instanceof BacktrackSignal) {
      ctx.backtracks += 1;
      // Deterministic backtrack: regenerate the affected team, excluding the
      // choices that led to the failure, bounded by the node budget.
      const affected = error.teamId;
      const excluded = new Set<string>();
      let regenerated = false;
      for (let attempt = 0; attempt < 5 && !regenerated; attempt += 1) {
        const previous = ctx.rosters.get(affected) ?? [];
        for (const versionId of previous) {
          ctx.unowned.add(versionId);
        }
        refreshAvailableCounts(ctx);
        ctx.rosters.delete(affected);
        const team = aiTeams.find((t) => t.franchiseId === affected);
        if (!team) throw error;
        for (const slot of previous.keys()) {
          ctx.nodes += 1;
          try {
            pickForTeam(ctx, team, slot, excluded);
          } catch (inner) {
            if (inner instanceof BacktrackSignal) break;
            throw inner;
          }
        }
        const violations = rosterViolations(ctx, affected);
        if (violations.length === 0) {
          regenerated = true;
        } else {
          for (const versionId of previous) excluded.add(versionId);
          for (const versionId of ctx.rosters.get(affected) ?? []) ctx.unowned.add(versionId);
          refreshAvailableCounts(ctx);
          ctx.rosters.delete(affected);
        }
        throwIfExhausted();
      }
      if (!regenerated) {
        throw new SeasonAiGenerationError({
          seed: input.seed,
          aiVersion: SEASON_AI_VERSION,
          rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
          teamsGenerated: [...ctx.rosters.keys()].length,
          teamsRepaired: ctx.teamsRepaired,
          backtracks: ctx.backtracks,
          nodesVisited: ctx.nodes,
          nodeBudget: ctx.nodeBudget,
          failedTeams: [affected],
          unmetConstraints: rosterViolations(ctx, affected),
        });
      }
    } else {
      throw error;
    }
  }

  // Final validation: every AI roster legal and complete.
  const failedTeams: string[] = [];
  for (const team of aiTeams) {
    const violations = rosterViolations(ctx, team.franchiseId);
    if (violations.length > 0) {
      failedTeams.push(team.franchiseId);
    }
  }
  if (failedTeams.length > 0) {
    throw new SeasonAiGenerationError({
      seed: input.seed,
      aiVersion: SEASON_AI_VERSION,
      rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
      teamsGenerated: [...ctx.rosters.keys()].length,
      teamsRepaired: ctx.teamsRepaired,
      backtracks: ctx.backtracks,
      nodesVisited: ctx.nodes,
      nodeBudget: ctx.nodeBudget,
      failedTeams,
      unmetConstraints: failedTeams.map((teamId) => rosterViolations(ctx, teamId).join('; ')),
    });
  }

  return finalizeResult(ctx, league, input.humanFranchiseIds, input.humanRosters);
}

function finalizeResult(
  ctx: GenerationContext,
  league: SeasonLeague,
  humanFranchiseIds: readonly string[],
  humanRosters: readonly { franchiseId: string; playerVersionIds: string[] }[],
): SeasonLeagueGenerationResult {
  const rosters = league.teams.map((team) => {
    const aiIds = ctx.rosters.get(team.franchiseId);
    const ids =
      aiIds ?? humanRosters.find((r) => r.franchiseId === team.franchiseId)?.playerVersionIds;
    if (!ids) throw new Error(`no roster resolved for ${team.franchiseId}`);
    const players = ids.map((playerVersionId) => {
      const candidate = ctx.byId.get(playerVersionId);
      if (!candidate) throw new Error(`missing candidate ${playerVersionId}`);
      return {
        playerVersionId,
        playerId: candidate.playerId,
        franchiseId: candidate.franchiseId,
        eraId: candidate.eraId,
        seasonKey: candidate.seasonKey,
        displayName: candidate.displayName,
      };
    });
    return { franchiseId: team.franchiseId, players };
  });
  const ownership = rosters.flatMap((roster) =>
    roster.players.map((player) => ({
      playerVersionId: player.playerVersionId,
      ownerFranchiseId: roster.franchiseId,
    })),
  );
  const rotations = rosters.map((roster) => {
    const members = roster.players.map((player) => {
      const candidate = ctx.byId.get(player.playerVersionId);
      if (!candidate) throw new Error(`missing candidate ${player.playerVersionId}`);
      return { playerVersionId: player.playerVersionId, playable: candidate.positions.playable };
    });
    return buildMinimalRotation({ franchiseId: roster.franchiseId, members });
  });
  const aiAssignments = [...ctx.assignments.values()];
  const evaluations = rosters.map((roster) => {
    const assignment = ctx.assignments.get(roster.franchiseId);
    const members = roster.players.map((player) => {
      const candidate = ctx.byId.get(player.playerVersionId);
      if (!candidate) throw new Error(`missing candidate ${player.playerVersionId}`);
      return {
        playable: candidate.positions.playable,
        detailedRatings: candidate.detailedRatings,
        tendencies: candidate.tendencies,
        overall: candidate.summaryRatings.overallRating,
      };
    });
    return evaluateSeasonRoster({
      franchiseId: roster.franchiseId,
      band: assignment?.band ?? 'average',
      identity: assignment?.identity ?? 'continuity',
      members,
    });
  });
  const digest = seasonGenerationDigest({
    seed: ctx.seed,
    aiVersion: SEASON_AI_VERSION,
    rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
    rotationVersion: SEASON_ROTATION_VERSION,
    rosters,
    ownership,
    rotations,
    aiAssignments,
  });
  const result: SeasonLeagueGenerationResult = {
    schemaVersion: 1,
    seed: ctx.seed,
    aiVersion: SEASON_AI_VERSION,
    rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
    rotationVersion: SEASON_ROTATION_VERSION,
    rosters,
    ownership,
    rotations,
    aiAssignments,
    evaluations,
    diagnostics: {
      seed: ctx.seed,
      aiVersion: SEASON_AI_VERSION,
      rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
      teamsGenerated: aiTeamsCount(ctx, humanFranchiseIds),
      teamsRepaired: ctx.teamsRepaired,
      backtracks: ctx.backtracks,
      nodesVisited: ctx.nodes,
      nodeBudget: ctx.nodeBudget,
      failedTeams: [],
      unmetConstraints: [],
    },
    digest,
  };
  void humanFranchiseIds;
  return seasonLeagueGenerationResultSchema.parse(result);
}

function aiTeamsCount(ctx: GenerationContext, humanFranchiseIds: readonly string[]): number {
  void ctx;
  return 30 - humanFranchiseIds.length;
}

/**
 * Generates and evaluates a calibration cohort of complete leagues. Each
 * run is independent: no shared RNG stream, no order dependence.
 */
export function runSeasonRosterCalibrationSeeds(input: {
  seeds: readonly Seed[];
  catalog: SeasonDraftCatalog;
  league: SeasonLeague;
  humanRosters: ReadonlyArray<{ franchiseId: string; playerVersionIds: string[] }>;
  targets?: SeasonRosterTargets | null;
}): SeasonRosterCalibrationRun[] {
  return input.seeds.map((seed) => {
    let generation: SeasonLeagueGenerationResult;
    try {
      generation = generateAiLeague({
        seed,
        catalog: input.catalog,
        league: input.league,
        humanFranchiseIds: input.humanRosters.map((r) => r.franchiseId),
        humanRosters: input.humanRosters,
        targets: input.targets ?? null,
      });
    } catch (error) {
      if (error instanceof SeasonAiGenerationError) {
        return {
          seed,
          teams: [],
          repairs: 0,
          backtracks: error.diagnostics.backtracks,
          nodesVisited: error.diagnostics.nodesVisited,
          failed: true,
          diagnostics: error.diagnostics,
        };
      }
      throw error;
    }
    return {
      seed,
      teams: generation.evaluations.map((evaluation) => ({
        franchiseId: evaluation.franchiseId,
        band: evaluation.band,
        identity: evaluation.identity,
        strengthScore: evaluation.strengthScore,
        rolesCovered: evaluation.rolesCovered.length,
        roleIds: evaluation.rolesCovered,
      })),
      repairs: generation.diagnostics.teamsRepaired,
      backtracks: generation.diagnostics.backtracks,
      nodesVisited: generation.diagnostics.nodesVisited,
      failed: false,
      diagnostics: null,
    };
  });
}
