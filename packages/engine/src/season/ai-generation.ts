import {
  SEASON_AI_VERSION,
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_TARGETS_VERSION,
  SEASON_ROTATION_VERSION,
  seasonDigestHex,
  seasonLeagueGenerationResultSchema,
  seasonLeagueSchema,
  seasonNamespaceSeed,
  type EraSimulationProfile,
  type ProjectionModelArtifact,
  type SeasonAiAnchor,
  type SeasonAiAssignment,
  type SeasonAiIdentity,
  type SeasonAiPool,
  type SeasonDraftCatalog,
  type SeasonGenerationDiagnostics,
  type SeasonLeague,
  type SeasonLeagueGenerationResult,
  type SeasonMinutePlanSummary,
  type SeasonRosterCalibrationRun,
  type SeasonRosterEvaluation,
  type SeasonRosterRole,
  type SeasonRosterTargets,
  type SeasonStrengthBand,
  type Seed,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { createRng, shuffle } from '../sim/rng.ts';
import {
  ProjectionCache,
  projectSeasonRoster,
  searchRosterRotationCandidates,
} from '../projection/index.ts';
import { validateDraftCatalog } from './catalog-validation.ts';
import {
  buildMinutePlanCandidates,
  minutePlanHorizonGames,
  type MinutePlanPlayerInput,
} from './minute-plan.ts';
import { buildMinimalRotation, validateSeasonRotation } from './rotation.ts';
import { seasonGenerationDigest } from './digest.ts';
import {
  completionTargetsMet,
  groupMaskOf,
  rosterGroupCounts,
  validateSeasonRoster,
  type SeasonRosterMemberInput,
} from './roster-rules.ts';
import {
  BAND_CEILING_PENALTY,
  ROSTER_ROLES,
  ROLE_COVERAGE_THRESHOLD,
  identityScore,
  overallReportOf,
  percentileTierOf,
  playerPercentileTier,
  rolePercentileThresholds,
  roleScoresOf,
  type PercentileTier,
  type RoleThresholds,
  type SeasonScoreMember,
} from './ai-scoring.ts';
/**
 * Deterministic AI league generation (spec/2.0/03, season-ai-v2,
 * roster-generation-v2, M2.4). A league-wide private-pool allocator replaces
 * the v1 team-at-a-time greedy: role percentiles over the canonical non-human
 * population drive anchors and tier mixtures; anchors are matched together
 * under exact-version exclusivity; the 20-member private pools are filled in
 * league-wide seeded rounds under tier ranges, band score caps, global
 * scarcity, and ten-player legality feasibility; and each roster is selected
 * from its own finalized pool. Generation never duplicates a version, never
 * reads packaged Overall, and never relaxes a rule: failures repair
 * deterministically and then throw `SeasonAiGenerationError` with the
 * failing phase and the last canonical allocation state.
 */

/** Solo-human band quotas (kept as the v1 export; targets.policy is authoritative). */
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

/** Legacy total node budget; v2 uses targets.policy.nodeBudgets. */
export const AI_GENERATION_NODE_BUDGET = 100_000;

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

/**
 * Fallback identity priority roles (roster-targets-v2 policy is
 * authoritative; the table only covers a stale targets artifact).
 */
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

/** Priority roles of one identity from the targets policy (fallback table). */
export function identityPriorityRolesOf(
  targets: SeasonRosterTargets,
  identity: SeasonAiIdentity,
): readonly SeasonRosterRole[] {
  const roles = (
    targets.policy.identityPriorityRoles as unknown as Record<string, SeasonRosterRole[]>
  )[identity];
  if (roles !== undefined && roles.length > 0) return roles;
  return DEFAULT_IDENTITY_PRIORITY_ROLES[identity];
}

export type SeasonAiGenerationPhase = 'anchors' | 'pool-fill' | 'selection';

/** Typed rejection for a null or mismatched roster-targets artifact. */
export class SeasonAiTargetsError extends Error {
  readonly code = 'TARGETS_MISMATCH' as const;

  constructor(message: string) {
    super(message);
    this.name = 'SeasonAiTargetsError';
  }
}

/** Validates the v2 targets artifact before any allocation. */
export function validateSeasonRosterTargets(targets: SeasonRosterTargets): void {
  // The version literals are enforced at the boundary: read them through an
  // untyped view so a null or mismatched artifact is rejected at runtime.
  const raw = targets as unknown as Record<string, unknown> | null;
  if (raw === null || typeof raw !== 'object') {
    throw new SeasonAiTargetsError('roster targets are required for roster-generation-v2');
  }
  if (raw.schemaVersion !== 2) {
    throw new SeasonAiTargetsError(
      `roster targets schemaVersion must be 2 (got ${String(raw.schemaVersion)})`,
    );
  }
  if (raw.targetsVersion !== SEASON_ROSTER_TARGETS_VERSION) {
    throw new SeasonAiTargetsError(
      `roster targets version mismatch: expected ${SEASON_ROSTER_TARGETS_VERSION}, got ${String(raw.targetsVersion)}`,
    );
  }
  const calibration = raw.calibration as Record<string, unknown> | undefined;
  if (calibration === undefined || calibration.aiVersion !== SEASON_AI_VERSION) {
    throw new SeasonAiTargetsError(
      `targets aiVersion mismatch: expected ${SEASON_AI_VERSION}, got ${String(calibration?.aiVersion)}`,
    );
  }
  if (calibration.rosterGenerationVersion !== SEASON_ROSTER_GENERATION_VERSION) {
    throw new SeasonAiTargetsError(
      `targets rosterGenerationVersion mismatch: expected ${SEASON_ROSTER_GENERATION_VERSION}, got ${String(calibration.rosterGenerationVersion)}`,
    );
  }
  const policy = raw.policy as Record<string, unknown> | undefined;
  const priorityRoles = policy?.['identityPriorityRoles'] as
    Record<string, SeasonRosterRole[]> | undefined;
  for (const identity of IDENTITIES) {
    const roles = priorityRoles?.[identity];
    if (roles === undefined || roles.length === 0) {
      throw new SeasonAiTargetsError(`targets lack priority roles for identity ${identity}`);
    }
  }
  const bandQuotas = policy?.['bandQuotas'] as Record<string, Record<string, number>> | undefined;
  const soloTotal = quotaTotal(bandQuotas, 'solo');
  const duoTotal = quotaTotal(bandQuotas, 'duo');
  if (soloTotal !== 29) {
    throw new SeasonAiTargetsError(`solo band quotas must total 29 (got ${String(soloTotal)})`);
  }
  if (duoTotal !== 28) {
    throw new SeasonAiTargetsError(`duo band quotas must total 28 (got ${String(duoTotal)})`);
  }
}

function quotaTotal(
  bandQuotas: Record<string, Record<string, number>> | undefined,
  key: string,
): number {
  const quotas = bandQuotas?.[key];
  if (quotas === undefined) return -1;
  return (
    (quotas.contender ?? 0) + (quotas.playoff ?? 0) + (quotas.average ?? 0) + (quotas.weaker ?? 0)
  );
}

/** Per-roster strength evaluation from possession inputs (unchanged seam). */
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

/**
 * Projection milestone shadow mode: runs the bounded projection search over
 * every AI pool and records compact summaries on the evaluations. Selection
 * is never changed; the summary records how the current selection compares
 * to the projection-ranked best candidate of the same pool.
 */
export function attachAiProjectionSummaries(input: {
  generation: SeasonLeagueGenerationResult;
  catalog: SeasonDraftCatalog;
  eraProfile: EraSimulationProfile;
  model: ProjectionModelArtifact;
  seed: string;
}): SeasonLeagueGenerationResult {
  const { generation, catalog, eraProfile, model, seed } = input;
  const byId = new Map(
    generation.rosters.map((roster) => [
      roster.franchiseId,
      roster.players.map((entry) => entry.playerVersionId),
    ]),
  );
  const rotationById = new Map(
    generation.rotations.map((rotation) => [rotation.franchiseId, rotation]),
  );
  const playerById = new Map(
    catalog.candidates.map((candidate) => [
      candidate.playerVersionId,
      {
        playerId: candidate.playerId,
        playerVersionId: candidate.playerVersionId,
        displayName: candidate.displayName,
        positions: candidate.positions.playable,
        heightInches: candidate.heightInches,
        weightLbs: candidate.weightLbs,
        ratings: candidate.detailedRatings,
        tendencies: candidate.tendencies,
        ...(candidate.anchors !== undefined ? { anchors: candidate.anchors } : {}),
        ...(candidate.reconstructedThreePoint !== undefined
          ? { reconstructedThreePoint: candidate.reconstructedThreePoint }
          : {}),
      } satisfies SimulationPlayer,
    ]),
  );
  const evaluations = generation.evaluations.map((evaluation) => {
    const pool = generation.aiPools.find(
      (candidate) => candidate.franchiseId === evaluation.franchiseId,
    );
    if (pool === undefined) return evaluation;
    const search = searchRosterRotationCandidates({
      catalog,
      locked: [],
      available: pool.playerVersionIds,
      seed: seasonDigestHex(`${seed}\u0000ai-projection\u0000${evaluation.franchiseId}`),
      eraProfile,
      model,
      // Shadow evaluation is evidence, not exhaustive search: tight per-call
      // caps keep 29 pools tractable (the artifact policy is multi-minute per
      // pool at the base projection's current cost).
      caps: { completeCandidates: 8, rotationsPerRoster: 8 },
    });
    const selected = byId.get(evaluation.franchiseId) ?? [];
    const rotation = rotationById.get(evaluation.franchiseId);
    let selectedNetRating = 0;
    if (rotation !== undefined) {
      try {
        const selectedPlayers: SimulationPlayer[] = [];
        for (const id of selected) {
          const player = playerById.get(id);
          if (player !== undefined) selectedPlayers.push(player);
        }
        if (selectedPlayers.length === 10) {
          const projection = projectSeasonRoster(
            {
              roster: selectedPlayers.map((player) => ({ player })),
              rotation,
              eraProfile,
              model,
            },
            { cache: searchCache },
          );
          selectedNetRating = projection.metrics.netRating;
        }
      } catch {
        selectedNetRating = 0;
      }
    }
    const best = search.ranked[0];
    const bestRoster =
      best === undefined ? null : best.projection.minutes.map((row) => row.playerVersionId);
    const selectedSorted = [...selected].sort().join(',');
    const bestSorted = bestRoster === null ? null : [...bestRoster].sort().join(',');
    const selectedIsBest =
      selectedSorted !== '' && bestSorted !== null && selectedSorted === bestSorted;
    const searchDigest = seasonDigestHex(
      JSON.stringify({
        seed: search.audit.seed,
        lens: search.audit.lens,
        rotationsEvaluated: search.audit.rotationsEvaluated,
        nodeCount: search.audit.nodeCount,
        selected: selectedSorted,
        best: bestSorted,
      }),
    );
    return {
      ...evaluation,
      projectionSummary: {
        modelVersion: model.modelVersion,
        selectedNetRating,
        bestNetRating: best?.projection.metrics.netRating ?? null,
        selectedIsBest,
        searchDigest,
      },
    };
  });
  return { ...generation, evaluations };
}

/** Shared cache across AI shadow searches (bounded, per-call). */
const searchCache = new ProjectionCache();

export interface SeasonAiGenerationInput {
  seed: Seed;
  catalog: SeasonDraftCatalog;
  league: SeasonLeague;
  /** Human franchises are excluded from AI generation. */
  humanFranchiseIds: readonly string[];
  /** Finalized human ownership (version ids per human franchise). */
  humanRosters: ReadonlyArray<{ franchiseId: string; playerVersionIds: string[] }>;
  /** Required v2 roster targets; validated before any allocation. */
  targets: SeasonRosterTargets;
  /**
   * Projection milestone (optional shadow mode): when present, generation
   * runs the projection search over every AI pool AFTER the current
   * selection phases and records compact projection summaries on the
   * evaluations. Shadow mode never changes selection: band quotas, anchor
   * guarantees, ownership, pool membership, legality, role coverage, outlier
   * caps, node budgets, and repair/backtracking rules are untouched. Absent
   * means byte-identical output to projection-free generation.
   */
  projection?: {
    eraProfile: EraSimulationProfile;
    model: ProjectionModelArtifact;
  };
}

/** Band + identity assignment for all 30 franchises for a run seed. */
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
  // Canonical base order so the seeded shuffle never depends on the input
  // league's array order.
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
  const rotated = [...IDENTITIES.slice(offset), ...IDENTITIES.slice(0, offset)];
  for (let i = 0; i < extra; i += 1) {
    const identity = rotated[i];
    if (identity !== undefined) counts[identity] += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Internal generation state
// ---------------------------------------------------------------------------

/** One AI team's private pool state (anchors live inside the pool). */
interface PoolTeam {
  franchiseId: string;
  band: SeasonStrengthBand;
  identity: SeasonAiIdentity;
  /** Insertion order; anchors first, then round picks and repairs. */
  pool: string[];
  /** Position group counts of the pool, maintained incrementally. */
  groupCounts: { guards: number; forwards: number; centers: number };
  /** Union of role-coverage masks across the pool, maintained incrementally. */
  coverageMask: number;
  /** Pool tier mixture, maintained incrementally (highest tier per member). */
  tierCounts: Record<PercentileTier, number>;
  /** Pool members whose identity score exceeds the band pool score cap. */
  outliers: number;
  anchors: SeasonAiAnchor[];
  /** Deduplicated seed paths that determined this pool. */
  seedPaths: string[];
  /** The seed path that brought each pool member into the pool. */
  memberPaths: Map<string, string[]>;
  repairCount: number;
  selections: string[] | null;
}

interface GenerationState {
  seed: Seed;
  catalog: SeasonDraftCatalog;
  byId: Map<string, SeasonDraftCatalog['candidates'][number]>;
  maskByVersion: Map<string, number>;
  roleScores: Map<string, Record<SeasonRosterRole, number>>;
  /** Bitmask of the roles a candidate covers (score >= coverage threshold). */
  coverageMaskByVersion: Map<string, number>;
  roleTiers: Map<string, Record<SeasonRosterRole, PercentileTier>>;
  /** Highest tier across roles per candidate (its pool tier). */
  poolTiers: Map<string, PercentileTier>;
  identityScores: Map<string, Record<SeasonAiIdentity, number>>;
  /** Per-candidate sums of identity priority role scores (precomputed once). */
  identityPriorityTotals: Map<string, Record<SeasonAiIdentity, number>>;
  thresholds: Record<SeasonRosterRole, RoleThresholds>;
  humanOwned: Set<string>;
  /** Candidates not human-owned and not inside any pool. */
  unassigned: Set<string>;
  /** Incremental per-mask counts of `unassigned` (kept in sync). */
  unassignedMaskCountsArr: number[];
  /** Per-role counts of unassigned candidates covering that role (kept in sync). */
  unassignedRoleCoverCounts: number[];
  /** Incremental total of remaining pool slots across every team. */
  remainingSlots: number;
  teams: Map<string, PoolTeam>;
  /** AI franchise ids sorted canonically (order-invariant iteration). */
  teamOrder: string[];
  targets: SeasonRosterTargets;
  /** Candidates sorted by playerVersionId ascending (canonical iteration). */
  canonicalCandidates: readonly SeasonDraftCatalog['candidates'][number][];
  assignments: Map<string, SeasonAiAssignment>;
  nodes: number;
  nodesByPhase: Record<SeasonAiGenerationPhase, number>;
  phase: SeasonAiGenerationPhase;
  /** Per-team selection node floor (fair share of the rosterSelection budget). */
  selectionFloor: number;
  backtracks: number;
  /** Backtracking bans keyed `${teamId}:${versionId}`. */
  bans: Set<string>;
}

function memberOf(state: GenerationState, versionId: string): SeasonRosterMemberInput {
  const candidate = state.byId.get(versionId);
  if (candidate === undefined) {
    throw new Error(`catalog is missing roster version ${versionId}`);
  }
  return { playerVersionId: versionId, playable: candidate.positions.playable };
}

function membersOf(
  state: GenerationState,
  versionIds: readonly string[],
): SeasonRosterMemberInput[] {
  return versionIds.map((versionId) => memberOf(state, versionId));
}

function zeroScores(): Record<SeasonRosterRole, number> {
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

function roleScoresOfIds(
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

function identityScoreOf(
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

function uncoveredRoles(roleScores: Record<SeasonRosterRole, number>): SeasonRosterRole[] {
  return ROSTER_ROLES.filter((role) => roleScores[role] < ROLE_COVERAGE_THRESHOLD);
}

function maskCountsOf(
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

/**
 * Exact reachability of a legal G,G,F,F,C five from counts: the capped DP
 * over (guards <= 2, forwards <= 2, centers <= 1) proves a legal slot
 * assignment exists among owned members plus up to `remainingPicks` picks
 * from the available per-mask counts.
 */
export function fiveReachableFromCounts(
  ownedCounts: { guards: number; forwards: number; centers: number },
  availableMaskCounts: readonly number[],
  remainingPicks: number,
): boolean {
  if (!Number.isInteger(remainingPicks) || remainingPicks < 0) {
    throw new Error(`remainingPicks must be a nonnegative integer (got ${String(remainingPicks)})`);
  }
  const targetG = 2;
  const targetF = 2;
  const targetC = 1;
  const startG = Math.min(targetG, ownedCounts.guards);
  const startF = Math.min(targetF, ownedCounts.forwards);
  const startC = Math.min(targetC, ownedCounts.centers);
  if (startG >= targetG && startF >= targetF && startC >= targetC) return true;
  const usedBase = 18;
  const stateCount = usedBase * (remainingPicks + 1);
  const reachable = new Uint8Array(stateCount);
  reachable[startG * 6 + startF * 2 + startC] = 1;
  for (let mask = 1; mask <= 7; mask += 1) {
    const count = availableMaskCounts[mask] ?? 0;
    if (count === 0) continue;
    for (let used = remainingPicks - 1; used >= 0; used -= 1) {
      const maxAdd = Math.min(count, remainingPicks - used);
      for (let g = targetG; g >= 0; g -= 1) {
        for (let f = targetF; f >= 0; f -= 1) {
          for (let c = targetC; c >= 0; c -= 1) {
            const idx = used * usedBase + g * 6 + f * 2 + c;
            if (reachable[idx] === 0) continue;
            for (let add = 1; add <= maxAdd; add += 1) {
              const ng = Math.min(targetG, g + ((mask & 1) !== 0 ? add : 0));
              const nf = Math.min(targetF, f + ((mask & 2) !== 0 ? add : 0));
              const nc = Math.min(targetC, c + ((mask & 4) !== 0 ? add : 0));
              reachable[(used + add) * usedBase + ng * 6 + nf * 2 + nc] = 1;
            }
          }
        }
      }
    }
    if (reachable[remainingPicks * usedBase + targetG * 6 + targetF * 2 + targetC] === 1) {
      return true;
    }
  }
  return reachable[remainingPicks * usedBase + targetG * 6 + targetF * 2 + targetC] === 1;
}

/**
 * Fill-gate reachability: the fixed pool members (each counted once) are
 * combined with up to `slotsToFill` picks from the unassigned per-mask
 * counts. The fixed stage is uncapped by design — it only proves the pool
 * can still reach the completion targets with the remaining supply; the
 * exact ten-slot accounting happens at the final validation and repair
 * boundaries via the used-capped per-member DP.
 */
function reachableAfterFixedAndFills(
  targets: { guards: number; forwards: number; centers: number },
  startCounts: { guards: number; forwards: number; centers: number },
  fixedMasks: readonly number[],
  unassignedMasks: readonly number[],
  slotsToFill: number,
  maxUnassignedPicks: number,
): boolean {
  const targetG = targets.guards;
  const targetF = targets.forwards;
  const targetC = targets.centers;
  const usedBase = (targetG + 1) * (targetF + 1) * (targetC + 1);
  const capG = (g: number): number => Math.min(targetG, g);
  const capF = (f: number): number => Math.min(targetF, f);
  const capC = (c: number): number => Math.min(targetC, c);
  const stateIndex = (g: number, f: number, c: number): number =>
    g * (targetF + 1) * (targetC + 1) + f * (targetC + 1) + c;
  let reachable = new Uint8Array(usedBase);
  reachable[
    stateIndex(capG(startCounts.guards), capF(startCounts.forwards), capC(startCounts.centers))
  ] = 1;
  for (const mask of fixedMasks) {
    if (mask === 0) continue;
    const next = new Uint8Array(usedBase);
    for (let g = targetG; g >= 0; g -= 1) {
      for (let f = targetF; f >= 0; f -= 1) {
        for (let c = targetC; c >= 0; c -= 1) {
          const idx = stateIndex(g, f, c);
          if (reachable[idx] === 0) continue;
          next[idx] = 1;
          next[
            stateIndex(
              capG(g + ((mask & 1) !== 0 ? 1 : 0)),
              capF(f + ((mask & 2) !== 0 ? 1 : 0)),
              capC(c + ((mask & 4) !== 0 ? 1 : 0)),
            )
          ] = 1;
        }
      }
    }
    reachable = next;
  }
  const maxPicks = Math.min(slotsToFill, maxUnassignedPicks);
  if (maxPicks <= 0) {
    return reachable[stateIndex(targetG, targetF, targetC)] === 1;
  }
  // Unassigned picks: the per-mask pass is order-sensitive, so the mask
  // passes are repeated to a fixpoint (bounded by the pick budget).
  const withPicks = new Uint8Array(usedBase * (maxPicks + 1));
  for (let g = targetG; g >= 0; g -= 1) {
    for (let f = targetF; f >= 0; f -= 1) {
      for (let c = targetC; c >= 0; c -= 1) {
        const idx = stateIndex(g, f, c);
        if (reachable[idx] === 0) continue;
        withPicks[stateIndex(g, f, c)] = 1;
      }
    }
  }
  for (let pass = 0; pass <= maxPicks; pass += 1) {
    const before = new Uint8Array(withPicks);
    for (let mask = 1; mask <= 7; mask += 1) {
      const count = unassignedMasks[mask] ?? 0;
      if (count === 0) continue;
      for (let used = maxPicks - 1; used >= 0; used -= 1) {
        const maxAdd = Math.min(count, maxPicks - used);
        if (maxAdd <= 0) continue;
        for (let g = targetG; g >= 0; g -= 1) {
          for (let f = targetF; f >= 0; f -= 1) {
            for (let c = targetC; c >= 0; c -= 1) {
              const base = used * usedBase + stateIndex(g, f, c);
              if (before[base] === 0) continue;
              for (let add = 1; add <= maxAdd; add += 1) {
                const ng = capG(g + ((mask & 1) !== 0 ? add : 0));
                const nf = capF(f + ((mask & 2) !== 0 ? add : 0));
                const nc = capC(c + ((mask & 4) !== 0 ? add : 0));
                withPicks[(used + add) * usedBase + stateIndex(ng, nf, nc)] = 1;
              }
            }
          }
        }
      }
    }
    for (let used = 0; used <= maxPicks; used += 1) {
      if (withPicks[used * usedBase + stateIndex(targetG, targetF, targetC)] === 1) return true;
    }
    let unchanged = true;
    for (let i = 0; i < withPicks.length; i += 1) {
      if (withPicks[i] !== before[i]) {
        unchanged = false;
        break;
      }
    }
    if (unchanged) break;
  }
  for (let used = 0; used <= maxPicks; used += 1) {
    if (withPicks[used * usedBase + stateIndex(targetG, targetF, targetC)] === 1) return true;
  }
  return false;
}

/**
 * Exact ten admission of a pool: the ten (anchors plus up to `10 - anchors`
 * other members) must reach the completion targets and field a legal five.
 * Used at the final pool validation and the repair boundaries, where the
 * ten-slot accounting must be exact.
 */
function poolAdmitsTenExact(state: GenerationState, team: PoolTeam): boolean {
  const anchorIds = team.anchors.map((anchor) => anchor.playerVersionId);
  const anchorCounts = rosterGroupCounts(membersOf(state, anchorIds));
  const anchorSet = new Set(anchorIds);
  const rest = team.pool.filter((id) => !anchorSet.has(id));
  const picks = 10 - team.anchors.length;
  if (
    !memberReachCapped(state, { guards: 4, forwards: 4, centers: 3 }, anchorCounts, rest, picks)
  ) {
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

/**
 * Exact ten-feasibility of a team's pool after adding `versionId` (or of the
 * pool as it stands when `versionId` is null): the ten contains the anchors,
 * so the completion 4/4/3 must be reachable from the anchors plus the pool's
 * fixed members plus at most the team's remaining pool slots of unassigned
 * picks; a legal five must be reachable among any five of the ten under the
 * same fill budget.
 */
function poolTenFeasibleAfterAdd(
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
    // The probe is still inside the unassigned counts; remove it once.
    if (addMask !== 0) {
      unassignedMasks[addMask] = Math.max(0, (unassignedMasks[addMask] ?? 0) - 1);
    }
  }
  const poolSize = state.targets.policy.poolSize;
  const slotsToFill = Math.max(0, poolSize - team.pool.length - (versionId !== null ? 1 : 0));
  const picksForTen = 10 - team.anchors.length;
  if (
    !reachableAfterFixedAndFills(
      { guards: 4, forwards: 4, centers: 3 },
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

/**
 * Role-coverage feasibility of a team's pool: the union of the roles the
 * pool members (plus the probe) cover must cover all eight roles. While the
 * pool is still filling, remaining unassigned candidates may still complete
 * the coverage; once the pool is full the union must stand alone. The
 * unassigned side is the precomputed per-role cover counts, which are
 * exactly the union of the unassigned coverage masks (a role is covered by
 * the supply iff at least one unassigned candidate covers it).
 */
function poolCoverageFeasible(
  state: GenerationState,
  team: PoolTeam,
  versionId: string | null,
  includeUnassigned: boolean,
): boolean {
  let poolMask = 0;
  const ids = versionId !== null ? [...team.pool, versionId] : team.pool;
  for (const id of ids) {
    poolMask |= state.coverageMaskByVersion.get(id) ?? 0;
  }
  if (poolMask === 0xff) return true;
  if (!includeUnassigned) return false;
  let unassignedMask = 0;
  for (let role = 0; role < 8; role += 1) {
    if ((state.unassignedRoleCoverCounts[role] ?? 0) > 0) unassignedMask |= 1 << role;
  }
  return (poolMask | unassignedMask) === 0xff;
}

/**
 * Role-coverage scarcity across the league: after the pick, the remaining
 * unassigned candidates must still cover every role that at least one pool
 * lacks (the probe covers the picking team's own gap). This stops pools from
 * deferring their role coverage until the supply runs out. The unassigned
 * union comes from the precomputed per-role cover counts.
 */
function coverageScarcityAfter(state: GenerationState, team: PoolTeam, versionId: string): boolean {
  let lacking = 0xff;
  for (const teamId of state.teamOrder) {
    const t = state.teams.get(teamId);
    if (t === undefined) continue;
    lacking &= ~t.coverageMask;
  }
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

/**
 * Exact ten-feasibility of a team's pool after adding `versionId` (or of the
 * pool as it stands when `versionId` is null): the ten contains the anchors,
 * so the completion 4/4/3 must be reachable from the anchors plus the pool's
 * fixed members (used-capped per-member DP, order-independent), and a legal
 * five must be reachable among any five of the pool's members.
 */
function poolTenFeasibleAfterAddExact(
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
  if (
    !memberReachCapped(state, { guards: 4, forwards: 4, centers: 3 }, anchorCounts, members, picks)
  ) {
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
  // The selection phase enforces maxRosterStrengthOutliers as a hard gate, so
  // the pool must admit a legal ten inside the band's strength outlier
  // budget. Anchors are fixed members and count toward the budget.
  const capValue = state.targets.policy.bandPoolScoreCaps[team.band];
  let anchorOutliers = 0;
  for (const anchorId of anchorIds) {
    if (identityScoreOf(state, anchorId, team.identity) > capValue) anchorOutliers += 1;
  }
  if (
    !memberReachCappedWithOutlierBudget(
      state,
      team,
      { guards: 4, forwards: 4, centers: 3 },
      anchorCounts,
      anchorOutliers,
      members,
      picks,
      state.targets.policy.maxRosterStrengthOutliers,
    )
  ) {
    return false;
  }
  return true;
}

/** Violations of the pool hard gates for adding `versionId` to `team`. */
function gatesForAdd(state: GenerationState, team: PoolTeam, versionId: string): string[] {
  const failures: string[] = [];
  // Global scarcity: one candidate must remain for every remaining pool slot
  // across the league after this pick.
  if (state.unassigned.size < state.remainingSlots) {
    failures.push('global scarcity');
  }
  // Position-level scarcity: the pick must not starve any team's completion.
  const addMask = state.maskByVersion.get(versionId) ?? 0;
  if (addMask !== 0 && !positionScarcityAfter(state, team, addMask)) {
    failures.push('position scarcity');
  }
  // Role coverage: the pool must stay able to cover all eight roles.
  if (!poolCoverageFeasible(state, team, versionId, true)) {
    failures.push('role coverage infeasible');
  }
  // League-wide coverage scarcity: the pick must not starve the remaining
  // pools of a role nobody covers yet.
  if (!coverageScarcityAfter(state, team, versionId)) {
    failures.push('coverage scarcity');
  }
  // Exact ten feasibility: the pool (anchors + fixed members) must admit a
  // legal ten with the remaining fill budget. With at most two slots left
  // the check is exact (used-capped per-member DP); earlier the uncapped
  // gate proves reachability with the remaining supply.
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

function addPoolMember(
  state: GenerationState,
  team: PoolTeam,
  versionId: string,
  seedPath: string[],
): void {
  team.pool.push(versionId);
  team.memberPaths.set(versionId, seedPath);
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

function removePoolMember(state: GenerationState, team: PoolTeam, versionId: string): void {
  const index = team.pool.indexOf(versionId);
  if (index < 0) throw new Error(`pool ${team.franchiseId} does not contain ${versionId}`);
  team.pool.splice(index, 1);
  team.memberPaths.delete(versionId);
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
  if (mask !== undefined && (mask & 1) !== 0)
    team.groupCounts.guards = Math.max(0, team.groupCounts.guards - 1);
  if (mask !== undefined && (mask & 2) !== 0)
    team.groupCounts.forwards = Math.max(0, team.groupCounts.forwards - 1);
  if (mask !== undefined && (mask & 4) !== 0)
    team.groupCounts.centers = Math.max(0, team.groupCounts.centers - 1);
  // A removed member's coverage cannot be subtracted from a union, so the
  // pool coverage mask is recomputed from the remaining pool.
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

function checkBudget(state: GenerationState): void {
  const budget = budgetForPhase(state, state.phase);
  if (state.nodesByPhase[state.phase] > budget) {
    throw exhausted(state, state.phase, [], [`${state.phase} node budget exceeded`]);
  }
}

/** The node budget of one phase (targets keys map onto phases). */
function budgetForPhase(state: GenerationState, phase: SeasonAiGenerationPhase): number {
  const budgets = state.targets.policy.nodeBudgets;
  switch (phase) {
    case 'anchors':
      return budgets.anchorMatching;
    case 'pool-fill':
      return budgets.poolRepair;
    case 'selection':
      return budgets.rosterSelection;
  }
}

/** True when a phase has consumed its node budget (selection stops early). */
function selectionBudgetExceeded(state: GenerationState): boolean {
  return state.nodesByPhase.selection > state.selectionFloor;
}

/** Canonical snapshot of the last allocation state for error reporting. */
function canonicalAllocationState(state: GenerationState): string {
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

function exhausted(
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
      failedTeams,
      unmetConstraints,
    },
    phase,
    allocationState: canonicalAllocationState(state),
    repairs: totalRepairs(state),
  });
}

function totalRepairs(state: GenerationState): number {
  let total = 0;
  for (const teamId of state.teamOrder) {
    const team = state.teams.get(teamId);
    if (team === undefined) continue;
    total += team.repairCount;
  }
  return total;
}

function nodeBudgetOf(targets: SeasonRosterTargets): number {
  return (
    targets.policy.nodeBudgets.anchorMatching +
    targets.policy.nodeBudgets.poolRepair +
    targets.policy.nodeBudgets.rosterSelection
  );
}

class PoolFillDeadlock extends Error {
  readonly teamId: string;
  readonly round: number;

  constructor(teamId: string, round: number) {
    super(`pool fill deadlock at round ${String(round)} for ${teamId}`);
    this.name = 'PoolFillDeadlock';
    this.teamId = teamId;
    this.round = round;
  }
}

// ---------------------------------------------------------------------------
// Phase 1: anchors
// ---------------------------------------------------------------------------

interface AnchorOption {
  versionId: string;
  qualifyingRole: SeasonRosterRole;
  roleScore: number;
  threshold: number;
}

/** Eligible anchor options for one team (elite in an identity priority role). */
function anchorOptionsFor(state: GenerationState, team: PoolTeam): AnchorOption[] {
  const priorityRoles = identityPriorityRolesOf(state.targets, team.identity);
  const options: AnchorOption[] = [];
  for (const candidate of state.canonicalCandidates) {
    if (state.humanOwned.has(candidate.playerVersionId)) continue;
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

/** Exact-version exclusivity: the candidate is not inside any pool yet. */
function inAnyPool(state: GenerationState, versionId: string): boolean {
  return !state.unassigned.has(versionId) && !state.humanOwned.has(versionId);
}

/**
 * Prune after (or before) a reservation: every team must still be able to
 * reach its guarantee, no band's elite range may be exceeded, the global
 * scarcity bound must hold, and every team's future pool must stay
 * ten-feasible. Returns the violation strings; empty means the branch can
 * still be completed.
 */
function anchorBranchViolations(
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
    // Every team's future pool must stay ten-feasible: later reservations
    // shrink the availability of earlier teams too.
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

/**
 * Deterministic bounded matching of the guaranteed anchors across every team.
 * Teams are processed by fewest eligible options, then seeded team rank, then
 * franchiseId. Each branch reserves one candidate; branches that prevent
 * another guarantee or make any team's future pool infeasible are pruned.
 */
function matchGuaranteedAnchors(state: GenerationState): void {
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
  // Options are per team: the same candidate can be an anchor option for
  // several teams, each with a different qualifying priority role. A global
  // version->option map would let the last team's option overwrite the
  // recorded qualifying role for earlier teams.
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
      // Stay on this team until its whole guarantee is placed: recursing on
      // the same index fills the second contender anchor, the single playoff
      // anchor, and so on before the next team is processed.
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

function addAnchor(
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

function removeAnchor(state: GenerationState, team: PoolTeam, versionId: string): void {
  team.anchors = team.anchors.filter((anchor) => anchor.playerVersionId !== versionId);
  removePoolMember(state, team, versionId);
}

/** Best eligible extra-elite option for a team, or null. */
function bestExtraEliteOption(state: GenerationState, team: PoolTeam): AnchorOption | null {
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

/**
 * One extra-elite roll per team from a named seed. Extra anchors pass the
 * same exclusivity, tier-range, scarcity, and ten-feasibility gates.
 */
function rollExtraEliteAnchors(state: GenerationState): void {
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

// ---------------------------------------------------------------------------
// Phase 2: league-wide private-pool filling
// ---------------------------------------------------------------------------

const TIER_DEFICIT_FACTOR: Record<PercentileTier, number> = {
  elite: 3,
  strong: 2,
  useful: 1,
  depth: 0,
};

/** The k weakest roles of the current pool (lowest role max scores). */
function weakestRoles(
  poolRoleScores: Record<SeasonRosterRole, number>,
  count: number,
): SeasonRosterRole[] {
  return [...ROSTER_ROLES].sort((a, b) => poolRoleScores[a] - poolRoleScores[b]).slice(0, count);
}

/**
 * Weighted seeded ranking of a pool candidate (hard gates already passed).
 * The band tier ranges guide the pool mixture softly: deficits toward the
 * tier minimums add weight, and picking beyond a tier maximum is penalized
 * (never rejected) so pools keep a spread of tiers. `priorityRoles`,
 * `weakest`, and `poolCounts` are per-pick invariants computed once by the
 * caller; the identity priority total is precomputed per candidate.
 */
function poolPickScore(
  state: GenerationState,
  team: PoolTeam,
  versionId: string,
  rngRanks: ReadonlyMap<string, number>,
  priorityRoles: readonly SeasonRosterRole[],
  weakest: readonly SeasonRosterRole[],
  poolCounts: { guards: number; forwards: number; centers: number },
): number {
  const identity = identityScoreOf(state, versionId, team.identity);
  let score = identity;
  const cap = state.targets.policy.bandPoolScoreCaps[team.band];
  if (identity > cap) {
    score -= (identity - cap) * BAND_CEILING_PENALTY;
    // Soft over-budget penalty when the pool would exceed its outlier budget.
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
    // Cumulative-or-better overage penalty (soft).
    const cumulative = tierOverage(state, team, tier, 1);
    if (cumulative > tierRange[1]) score -= (cumulative - tierRange[1]) * TIER_DEFICIT_FACTOR[tier];
  }
  const completion = state.targets.policy.completionTargets;
  const mask = state.maskByVersion.get(versionId) ?? 0;
  let positionHelp = 0;
  if (Math.max(0, completion.guards - poolCounts.guards) > 0 && (mask & 1) !== 0) positionHelp += 1;
  if (Math.max(0, completion.forwards - poolCounts.forwards) > 0 && (mask & 2) !== 0)
    positionHelp += 1;
  if (Math.max(0, completion.centers - poolCounts.centers) > 0 && (mask & 4) !== 0)
    positionHelp += 1;
  score += positionHelp * 0.4;
  // Seeded ranking: the per-round candidate rank meaningfully orders
  // near-equal candidates so different seeds produce different pools.
  score += (rngRanks.get(versionId) ?? 0) * 2.5;
  return score;
}

/** Cumulative-or-better tier count of a team's pool after `extra` members. */
function tierOverage(
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
    default:
      return elite + strong + useful + team.tierCounts.depth + extra;
  }
}

/**
 * Best gated candidate for one team at one round, or null on deadlock. The
 * scarcity gate is candidate-invariant; the exact ten-feasibility gate only
 * depends on the candidate's group mask, so it is probed once per mask and
 * the remaining per-candidate gates are constant-time.
 */
function pickForPool(state: GenerationState, team: PoolTeam, round: number): string | null {
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
  const rngRanks = new Map<string, number>();
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
  for (const candidate of state.canonicalCandidates) {
    rngRanks.set(candidate.playerVersionId, rng.next());
  }
  const poolRoleScores = roleScoresOfIds(state, team.pool);
  // Per-pick invariants computed once instead of once per candidate.
  const priorityRoles = identityPriorityRolesOf(state.targets, team.identity);
  const weakest = weakestRoles(poolRoleScores, 2);
  const poolCounts = team.groupCounts;
  let best: { id: string; score: number } | undefined;
  for (const candidate of state.canonicalCandidates) {
    const id = candidate.playerVersionId;
    const mask = state.maskByVersion.get(id) ?? 0;
    if (mask === 0 || !feasibleMasks.has(mask)) continue;
    if (!state.unassigned.has(id)) continue;
    if (state.bans.has(`${team.franchiseId}:${id}`)) continue;
    if (!poolCoverageFeasible(state, team, id, true)) continue;
    if (!coverageScarcityAfter(state, team, id)) continue;
    const score = poolPickScore(state, team, id, rngRanks, priorityRoles, weakest, poolCounts);
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

/** First canonical unassigned candidate of a group mask (for DP probes). */
function probeForMask(state: GenerationState, team: PoolTeam, mask: number): string | undefined {
  for (const candidate of state.canonicalCandidates) {
    const id = candidate.playerVersionId;
    if (!state.unassigned.has(id)) continue;
    if (state.bans.has(`${team.franchiseId}:${id}`)) continue;
    if ((state.maskByVersion.get(id) ?? 0) === mask) return id;
  }
  return undefined;
}

/**
 * Position-level global scarcity: after adding a member of `mask` to `team`,
 * the unassigned supply of each position group must still cover every team's
 * remaining completion need (4 guard-, 4 forward-, 3 center-capable pool
 * members). This stops pools from hoarding scarce positions while other
 * pools still need them.
 */
function positionScarcityAfter(state: GenerationState, team: PoolTeam, mask: number): boolean {
  const completion = state.targets.policy.completionTargets;
  const need = { guards: 0, forwards: 0, centers: 0 };
  for (const teamId of state.teamOrder) {
    const t = state.teams.get(teamId);
    if (t === undefined) continue;
    const counts = t.groupCounts;
    const addToTeam = t === team;
    const g = counts.guards + (addToTeam && (mask & 1) !== 0 ? 1 : 0);
    const f = counts.forwards + (addToTeam && (mask & 2) !== 0 ? 1 : 0);
    const c = counts.centers + (addToTeam && (mask & 4) !== 0 ? 1 : 0);
    need.guards += Math.max(0, completion.guards - g);
    need.forwards += Math.max(0, completion.forwards - f);
    need.centers += Math.max(0, completion.centers - c);
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

/** Twenty league-wide rounds; each round uses a seeded canonical team order. */
function fillPools(state: GenerationState): void {
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
  }
}

interface PoolSnapshot {
  pools: Array<{
    franchiseId: string;
    pool: string[];
    tierCounts: Record<PercentileTier, number>;
    outliers: number;
    anchors: SeasonAiAnchor[];
    seedPaths: string[];
    memberPaths: Array<[string, string[]]>;
    repairCount: number;
  }>;
  unassigned: string[];
  unassignedMaskCountsArr: number[];
  remainingSlots: number;
}

function snapshotPools(state: GenerationState): PoolSnapshot {
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
  };
}

/** Per-role counts of candidates covering each role (union arithmetic). */
function roleCoverCountsOf(
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

function restorePools(state: GenerationState, snapshot: PoolSnapshot): void {
  state.unassigned = new Set(snapshot.unassigned);
  state.unassignedMaskCountsArr = [...snapshot.unassignedMaskCountsArr];
  state.remainingSlots = snapshot.remainingSlots;
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
  // The incremental memberships were rebuilt above; recompute the derived
  // role-cover counts and per-team position/coverage state from them.
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

/**
 * Deterministic local replacement: swap a pool member for an unassigned
 * candidate so every pool gate holds. Pool order first, then canonical
 * candidate order; the first legal swap is accepted.
 */
function localPoolRepair(state: GenerationState, teamId: string): boolean {
  const team = state.teams.get(teamId);
  if (team === undefined) return false;
  const anchorSet = new Set(team.anchors.map((anchor) => anchor.playerVersionId));
  const original = [...team.pool];
  for (const memberId of original) {
    // Guaranteed anchors never leave the pool.
    if (anchorSet.has(memberId)) continue;
    removePoolMember(state, team, memberId);
    for (const candidate of state.canonicalCandidates) {
      const id = candidate.playerVersionId;
      if (!state.unassigned.has(id) || state.bans.has(`${teamId}:${id}`)) continue;
      state.nodes += 1;
      state.nodesByPhase['pool-fill'] += 1;
      checkBudget(state);
      if (gatesForAdd(state, team, id).length === 0) {
        // The repaired pool must admit a legal ten exactly (used-capped
        // per-member DP), otherwise the repair would leave a dead end.
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

/**
 * Deterministic cross-pool swap: a donor pool that can spare a member passes
 * it to the failing team; when the failing team is full, its weakest member
 * returns to the unassigned pool first.
 */
function crossPoolRepair(state: GenerationState, teamId: string): boolean {
  const team = state.teams.get(teamId);
  if (team === undefined) return false;
  for (const donorId of state.teamOrder) {
    if (donorId === teamId) continue;
    const donor = state.teams.get(donorId);
    if (donor === undefined) continue;
    const donorAnchorSet = new Set(donor.anchors.map((anchor) => anchor.playerVersionId));
    for (const memberId of [...donor.pool]) {
      if (state.bans.has(`${teamId}:${memberId}`)) continue;
      // The donor's guaranteed anchors never leave its pool.
      if (donorAnchorSet.has(memberId)) continue;
      state.nodes += 1;
      state.nodesByPhase['pool-fill'] += 1;
      checkBudget(state);
      removePoolMember(state, donor, memberId);
      // The donor must still be able to complete its own pool: its pool
      // (after the removal) has to admit a legal ten with the slots that
      // remain. Without this gate the repair would ping-pong the hole
      // between the failing team and a donor that cannot recover.
      const donorOk = poolAdmitsTenExact(state, donor);
      const addFailures = gatesForAdd(state, team, memberId);
      if (donorOk && !inAnyPool(state, memberId) && addFailures.length === 0) {
        // When the failing team is full, its weakest pool member returns to
        // the unassigned pool first (deterministic pool order).
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
          // The repaired pool must admit a legal ten exactly.
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

/** Pool-level violations; the exact ten admission is verified separately. */
function poolViolations(state: GenerationState, teamId: string): string[] {
  const team = state.teams.get(teamId);
  if (team === undefined) return ['missing team'];
  const violations: string[] = [];
  const poolSize = state.targets.policy.poolSize;
  if (team.pool.length !== poolSize) {
    violations.push(`pool has ${String(team.pool.length)} of ${String(poolSize)} members`);
  }
  if (new Set(team.pool).size !== team.pool.length) violations.push('pool contains duplicates');
  // The exact ten admission uses the order-independent used-capped per-member
  // DP (the shared per-mask DP in roster-rules is order-sensitive for
  // multi-position masks and is not used for pool validation here).
  if (!poolAdmitsTenExact(state, team)) {
    violations.push('pool admits no 4/4/3 ten');
  }
  // The full pool must cover all eight roles with its own members.
  if (!poolCoverageFeasible(state, team, null, false)) {
    violations.push('pool cannot cover all eight roles');
  }
  return violations;
}

/**
 * Order-independent reachability of the target group counts from a fixed
 * member list with at most `maxPicks` picks: each member is applied at most
 * once (its mask contributes to its groups), the counts are capped at the
 * targets, and the used dimension bounds the total picks. Unlike the shared
 * per-mask-count DP, this cannot miss combinations where a multi-position
 * member must be consumed before a single-position one, and unlike an
 * uncapped member DP it cannot over-approximate the pick budget.
 */
function memberReachCapped(
  state: GenerationState,
  targets: { guards: number; forwards: number; centers: number },
  startCounts: { guards: number; forwards: number; centers: number },
  memberIds: readonly string[],
  maxPicks: number,
): boolean {
  const targetG = targets.guards;
  const targetF = targets.forwards;
  const targetC = targets.centers;
  const strideF = targetC + 1;
  const strideG = strideF * (targetF + 1);
  const usedBase = strideG * (targetG + 1);
  const index = (g: number, f: number, c: number): number => g * strideG + f * strideF + c;
  const cap = (value: number, max: number): number => Math.min(max, value);
  if (maxPicks < 0) return false;
  const reachable = new Uint8Array(usedBase * (maxPicks + 1));
  reachable[
    index(
      cap(startCounts.guards, targetG),
      cap(startCounts.forwards, targetF),
      cap(startCounts.centers, targetC),
    )
  ] = 1;
  for (const id of memberIds) {
    const mask = state.maskByVersion.get(id) ?? 0;
    if (mask === 0) continue;
    for (let used = maxPicks - 1; used >= 0; used -= 1) {
      for (let g = targetG; g >= 0; g -= 1) {
        for (let f = targetF; f >= 0; f -= 1) {
          for (let c = targetC; c >= 0; c -= 1) {
            const idx = used * usedBase + index(g, f, c);
            if (reachable[idx] === 0) continue;
            reachable[
              (used + 1) * usedBase +
                index(
                  cap(g + ((mask & 1) !== 0 ? 1 : 0), targetG),
                  cap(f + ((mask & 2) !== 0 ? 1 : 0), targetF),
                  cap(c + ((mask & 4) !== 0 ? 1 : 0), targetC),
                )
            ] = 1;
          }
        }
      }
    }
  }
  for (let used = 0; used <= maxPicks; used += 1) {
    if (reachable[used * usedBase + index(targetG, targetF, targetC)] === 1) return true;
  }
  return false;
}

/**
 * Outlier-budget-aware completion reachability: the 4/4/3 target must be
 * reachable while keeping the number of members whose identity score exceeds
 * the band pool score cap at or below `maxOutliers` (the selection phase's
 * hard `maxRosterStrengthOutliers` gate). State adds the outlier dimension;
 * member outlier flags come from the per-candidate identity score.
 */
function memberReachCappedWithOutlierBudget(
  state: GenerationState,
  team: PoolTeam,
  targets: { guards: number; forwards: number; centers: number },
  startCounts: { guards: number; forwards: number; centers: number },
  startOutliers: number,
  memberIds: readonly string[],
  maxPicks: number,
  maxOutliers: number,
): boolean {
  const targetG = targets.guards;
  const targetF = targets.forwards;
  const targetC = targets.centers;
  const strideF = targetC + 1;
  const strideG = strideF * (targetF + 1);
  const strideO = strideG * (targetG + 1);
  const usedBase = strideO * (maxOutliers + 1);
  const index = (g: number, f: number, c: number, o: number): number =>
    g * strideG + f * strideF + c + o * strideO;
  const cap = (value: number, max: number): number => Math.min(max, value);
  if (maxPicks < 0 || startOutliers > maxOutliers) return false;
  const capValue = state.targets.policy.bandPoolScoreCaps[team.band];
  const reachable = new Uint8Array(usedBase * (maxPicks + 1));
  reachable[
    index(
      cap(startCounts.guards, targetG),
      cap(startCounts.forwards, targetF),
      cap(startCounts.centers, targetC),
      startOutliers,
    )
  ] = 1;
  for (const id of memberIds) {
    const mask = state.maskByVersion.get(id) ?? 0;
    if (mask === 0) continue;
    const isOutlier = identityScoreOf(state, id, team.identity) > capValue ? 1 : 0;
    for (let used = maxPicks - 1; used >= 0; used -= 1) {
      for (let g = targetG; g >= 0; g -= 1) {
        for (let f = targetF; f >= 0; f -= 1) {
          for (let c = targetC; c >= 0; c -= 1) {
            for (let o = maxOutliers; o >= 0; o -= 1) {
              const idx = used * usedBase + index(g, f, c, o);
              if (reachable[idx] === 0) continue;
              if (o + isOutlier <= maxOutliers) {
                reachable[
                  (used + 1) * usedBase +
                    index(
                      cap(g + ((mask & 1) !== 0 ? 1 : 0), targetG),
                      cap(f + ((mask & 2) !== 0 ? 1 : 0), targetF),
                      cap(c + ((mask & 4) !== 0 ? 1 : 0), targetC),
                      o + isOutlier,
                    )
                ] = 1;
              }
            }
          }
        }
      }
    }
  }
  for (let used = 0; used <= maxPicks; used += 1) {
    for (let o = 0; o <= maxOutliers; o += 1) {
      if (reachable[used * usedBase + index(targetG, targetF, targetC, o)] === 1) return true;
    }
  }
  return false;
}

/**
 * Bounded deterministic DFS for a legal ten (validateSeasonRoster plus the
 * 4/4/3 completion target and all-eight-roles coverage) inside a member
 * list. Canonical order, early exit, completion/coverage pruning; counts
 * against the active phase budget.
 */
function legalTenExists(state: GenerationState, members: readonly string[]): boolean {
  const ordered = [...members].sort();
  const picked: string[] = [];
  const rec = (index: number): boolean => {
    state.nodes += 1;
    state.nodesByPhase[state.phase] += 1;
    checkBudget(state);
    if (picked.length === 10) {
      const roster = membersOf(state, picked);
      return (
        validateSeasonRoster(roster).length === 0 &&
        completionTargetsMet(roster) &&
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
          { guards: 4, forwards: 4, centers: 3 },
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

/** Fills all pools; on deadlock repairs locally, then across pools, then backtracks. */
function fillPoolsWithRepair(state: GenerationState): void {
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

// ---------------------------------------------------------------------------
// Phase 3: final roster selection from each finalized private pool
// ---------------------------------------------------------------------------

/** Exact coverage DP over a member list: can `slots` picks cover all roles? */
function coverageFeasibleFromPool(
  state: GenerationState,
  uncovered: readonly SeasonRosterRole[],
  memberIds: readonly string[],
  slots: number,
): boolean {
  if (uncovered.length === 0) return true;
  if (uncovered.length > slots) return false;
  let subsetMask = 0;
  for (const role of uncovered) {
    const index = ROSTER_ROLES.indexOf(role);
    if (index >= 0) subsetMask |= 1 << index;
  }
  const maskCounts = new Array<number>(1 << uncovered.length).fill(0);
  for (const id of memberIds) {
    const scores = state.roleScores.get(id);
    if (scores === undefined) continue;
    let coveredMask = 0;
    ROSTER_ROLES.forEach((role, roleIndex) => {
      if (scores[role] >= ROLE_COVERAGE_THRESHOLD) coveredMask |= 1 << roleIndex;
    });
    const masked = coveredMask & subsetMask;
    if (masked !== 0) maskCounts[masked] = (maskCounts[masked] ?? 0) + 1;
  }
  const full = (1 << uncovered.length) - 1;
  const reachable = new Uint8Array((slots + 1) * (full + 1));
  reachable[0] = 1;
  // The per-mask pass is order-sensitive (a multi-role member processed late
  // cannot add its roles once the pick budget is spent), so the passes are
  // repeated to a fixpoint, bounded by the pick budget.
  for (let pass = 0; pass <= slots; pass += 1) {
    const before = new Uint8Array(reachable);
    for (let mask = 1; mask <= full; mask += 1) {
      const count = maskCounts[mask] ?? 0;
      if (count === 0) continue;
      for (let used = slots - 1; used >= 0; used -= 1) {
        const maxAdd = Math.min(count, slots - used);
        for (let covered = full; covered >= 0; covered -= 1) {
          const idx = used * (full + 1) + covered;
          if (before[idx] === 0) continue;
          for (let add = 1; add <= maxAdd; add += 1) {
            reachable[(used + add) * (full + 1) + (covered | mask)] = 1;
          }
        }
      }
    }
    if (reachable[slots * (full + 1) + full] === 1) return true;
    let unchanged = true;
    for (let i = 0; i < reachable.length; i += 1) {
      if (reachable[i] !== before[i]) {
        unchanged = false;
        break;
      }
    }
    if (unchanged) break;
  }
  return reachable[slots * (full + 1) + full] === 1;
}

/**
 * A ten must be legal, complete, cover all eight roles, and rotate 240 min.
 * The band tier ranges are soft targets (scoring deficits/penalties), never
 * hard gates: with the pool tier being the highest tier across all eight
 * roles and identity scores dominating the pool fill, hard tier caps would
 * make generation infeasible for the population. The selected-roster
 * strength outlier budget IS a hard gate (targets.policy.maxRoster
 * StrengthOutliers): it is what separates the strength bands in measured
 * roster quality and is enforced by every selection path.
 */
function rosterLegal(state: GenerationState, team: PoolTeam, ids: readonly string[]): boolean {
  if (ids.length !== 10) return false;
  const members = membersOf(state, ids);
  if (validateSeasonRoster(members).length > 0) return false;
  if (!completionTargetsMet(members)) return false;
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

function rosterOutlierCount(
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

/** Hard gate: the selected ten may exceed the band cap only a bounded number
 * of times (targets.policy.maxRosterStrengthOutliers). */
function rosterOutlierBudgetOk(
  state: GenerationState,
  team: PoolTeam,
  ids: readonly string[],
): boolean {
  return rosterOutlierCount(state, team, ids) <= state.targets.policy.maxRosterStrengthOutliers;
}

function selectionRanks(state: GenerationState, team: PoolTeam): Map<string, number> {
  const ranks = new Map<string, number>();
  const rng = createRng(
    seasonNamespaceSeed(state.seed, 'ai-rosters', 'selection', team.franchiseId, 'candidate-order'),
  );
  for (const candidate of state.canonicalCandidates) {
    ranks.set(candidate.playerVersionId, rng.next());
  }
  return ranks;
}

function selectionPickScore(
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

/** Greedy ten from the pool: anchors first, then gated picks, then score. */
function greedySelection(state: GenerationState, team: PoolTeam): string[] | null {
  const picked = [...team.anchors.map((anchor) => anchor.playerVersionId)];
  const rngRanks = selectionRanks(state, team);
  // The pool is finalized before selection; sort once and reuse each round.
  const sortedPool = [...team.pool].sort();
  while (picked.length < 10) {
    const slotsLeft = 10 - picked.length - 1;
    const pickedCounts = rosterGroupCounts(membersOf(state, picked));
    const pickedRoleScores = roleScoresOfIds(state, picked);
    const uncovered = uncoveredRoles(pickedRoleScores);
    let best: { id: string; score: number } | undefined;
    for (const id of sortedPool) {
      if (picked.includes(id)) continue;
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
          { guards: 4, forwards: 4, centers: 3 },
          probeCounts,
          remaining,
          slotsLeft,
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
      // The candidate's own coverage closes some uncovered roles; the
      // remaining slots only need to cover what it leaves open. Testing the
      // full `uncovered` set against the pool minus the candidate rejects
      // picks that are the last member covering a role (a false negative).
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

function rosterSelectionScore(
  state: GenerationState,
  team: PoolTeam,
  ten: readonly string[],
): number {
  const roleScores = roleScoresOfIds(state, ten);
  let score = identityScore(roleScores, team.identity);
  const uncovered = uncoveredRoles(roleScores);
  score -= uncovered.length * 2;
  score -= rosterOutlierCount(state, team, ten) * BAND_CEILING_PENALTY;
  // Tier ranges guide the mixture softly: deficits toward the minimums add
  // weight and cumulative-or-better overage beyond the maximums is penalized.
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

/** Bounded deterministic improvement: first legal swap that raises the score. */
function improveSelection(
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

/** Bounded best-ten DFS fallback when the greedy path cannot complete. */
function bestTenDfs(
  state: GenerationState,
  team: PoolTeam,
  members: readonly string[],
  incumbent: string[] | null,
): string[] | null {
  // Member order: role-coverage contribution first (members covering more
  // of the eight roles lead the search so coverage-complete tens are found
  // early), then completion group (center-capable first), then canonical,
  // so legal tens are found within the budget.
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
  // The DFS rescues greedy dead-ends: it stops at the first legal ten it
  // finds (improveSelection polishes afterwards), so the search cost stays
  // bounded by the first found solution instead of the full solution space.
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
          { guards: 4, forwards: 4, centers: 3 },
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

/** Best legal ten from a finalized pool (greedy, improvement, bounded DFS). */
function bestRosterFromPool(state: GenerationState, team: PoolTeam): string[] | null {
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

function selectRosters(state: GenerationState): void {
  const teamCount = Math.max(1, state.teamOrder.length);
  const perTeam = Math.max(150, Math.floor(budgetForPhase(state, 'selection') / teamCount));
  for (const teamId of state.teamOrder) {
    const team = state.teams.get(teamId);
    if (team === undefined) continue;
    state.selectionFloor = state.nodesByPhase.selection + perTeam;
    const ten = bestRosterFromPool(state, team);
    if (ten === null) {
      throw exhausted(
        state,
        'selection',
        [teamId],
        [`no legal roster selected from the pool of ${teamId}`],
      );
    }
    team.selections = ten;
  }
}

// ---------------------------------------------------------------------------
// Result assembly and calibration
// ---------------------------------------------------------------------------

function toSeasonAiPool(state: GenerationState, team: PoolTeam): SeasonAiPool {
  const selections = [...(team.selections ?? [])].sort();
  return {
    franchiseId: team.franchiseId,
    band: team.band,
    identity: team.identity,
    playerVersionIds: [...team.pool].sort(),
    anchors: [...team.anchors].sort((a, b) => (a.playerVersionId < b.playerVersionId ? -1 : 1)),
    selections,
    // One seed path per selection, in selection order (the path that brought
    // each selected member into the pool).
    allocationSeedPaths: selections.map(
      (versionId) => team.memberPaths.get(versionId) ?? ['ai-rosters', team.franchiseId],
    ),
    repairCount: team.repairCount,
  };
}

/**
 * Roster-relative quality weights (0..1) for the minute-policy optimizer.
 * Uses exactly the talent authority of the rotation `order` comparator:
 * mean of the candidate's detailed ratings, normalized within the roster
 * (`q = mean / maxMeanAcrossRoster`; 0.5 when the roster has no ratings).
 * Ratings-derived only — generation has no era profile or projection model.
 */
function qualityWeightsFromRatings(
  members: readonly { playerVersionId: string; detailedRatings: Record<string, number> }[],
): ReadonlyMap<string, number> {
  const means = new Map<string, number>();
  let maxMean = 0;
  for (const member of members) {
    const ratings = Object.values(member.detailedRatings);
    const mean = ratings.reduce((sum, value) => sum + value, 0) / Math.max(1, ratings.length);
    means.set(member.playerVersionId, mean);
    maxMean = Math.max(maxMean, mean);
  }
  if (maxMean <= 0) {
    return new Map(members.map((member) => [member.playerVersionId, 0.5]));
  }
  return new Map(
    members.map((member) => [
      member.playerVersionId,
      Math.min(1, Math.max(0, (means.get(member.playerVersionId) ?? 0) / maxMean)),
    ]),
  );
}

function finalizeResult(
  state: GenerationState,
  league: SeasonLeague,
  humanFranchiseIds: readonly string[],
  humanRosters: readonly { franchiseId: string; playerVersionIds: string[] }[],
): SeasonLeagueGenerationResult {
  const rosters = league.teams.map((team) => {
    const aiTeam = state.teams.get(team.franchiseId);
    const ids =
      aiTeam?.selections ??
      humanRosters.find((r) => r.franchiseId === team.franchiseId)?.playerVersionIds;
    if (!ids) throw new Error(`no roster resolved for ${team.franchiseId}`);
    const players = ids.map((playerVersionId) => {
      const candidate = state.byId.get(playerVersionId);
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
      const candidate = state.byId.get(player.playerVersionId);
      if (!candidate) throw new Error(`missing candidate ${player.playerVersionId}`);
      return { playerVersionId: player.playerVersionId, playable: candidate.positions.playable };
    });
    // Projection milestone: AI rotations are talent-ordered (mean detailed
    // ratings; Overall is never a pick or rotation authority) so the
    // strongest legal five starts and the bench hierarchy is talent-ranked.
    return buildMinimalRotation({
      franchiseId: roster.franchiseId,
      members,
      order: (a, b) => {
        const talentOf = (member: { playerVersionId: string }): number => {
          const candidate = state.byId.get(member.playerVersionId);
          if (!candidate) return 0;
          const ratings = Object.values(candidate.detailedRatings);
          return ratings.reduce((sum, value) => sum + value, 0) / Math.max(1, ratings.length);
        };
        return talentOf(b) - talentOf(a);
      },
    });
  });
  // Projection milestone (minute-policy-v1): every rotation's target minutes
  // come from the risk-adjusted minute-plan optimizer — quality weights from
  // roster-relative mean detailed ratings, stamina/durability from the
  // candidate profiles, zero current fatigue at initial generation, and the
  // 10-game block horizon. Starters, bench order, and closing five stay
  // byte-identical to the talent-ordered base; a malformed roster falls back
  // to its base rotation without a minute-plan summary.
  const rotationByFranchise = new Map(
    rotations.map((rotation) => [rotation.franchiseId, rotation]),
  );
  const minutePlanByFranchise = new Map<string, SeasonMinutePlanSummary>();
  const plannedRotations = rosters.map((roster) => {
    const base = rotationByFranchise.get(roster.franchiseId);
    if (base === undefined) throw new Error(`missing rotation for ${roster.franchiseId}`);
    const members = roster.players.map((player) => {
      const candidate = state.byId.get(player.playerVersionId);
      if (!candidate) throw new Error(`missing candidate ${player.playerVersionId}`);
      return {
        playerVersionId: player.playerVersionId,
        playable: candidate.positions.playable,
        detailedRatings: candidate.detailedRatings,
        staminaRating: candidate.stamina.rating,
        durability: candidate.durability.rating,
      };
    });
    try {
      const quality = qualityWeightsFromRatings(members);
      const horizon = minutePlanHorizonGames(82);
      const players = new Map<string, MinutePlanPlayerInput>(
        members.map((member) => [
          member.playerVersionId,
          {
            playerVersionId: member.playerVersionId,
            quality: quality.get(member.playerVersionId) ?? 0.5,
            staminaRating: member.staminaRating,
            durability: member.durability,
            fatigueBasisPoints: 0,
            recentLoadBasisPoints: 0,
          },
        ]),
      );
      const { plans, recommended } = buildMinutePlanCandidates({
        structure: {
          starters: base.starters,
          benchOrder: base.benchOrder,
          closingFive: base.closingFive,
        },
        players,
        horizon,
      });
      const plan = plans.find((candidate) => candidate.strategy === recommended);
      if (plan === undefined) throw new Error('no recommended minute plan');
      minutePlanByFranchise.set(roster.franchiseId, {
        policyVersion: SEASON_MINUTE_POLICY_VERSION,
        strategy: plan.strategy,
        riskAdjustedScore: plan.riskScore,
        quality: plan.quality,
        maxStarterStrainBasisPoints: plan.maxStarterStrainBasisPoints,
        starterStrainBand: plan.strainBand,
        benchRelief: plan.relief,
        fatigueBands: plan.fatigueBands,
        horizonGames: horizon,
        heavyStrain: plan.heavyStrain,
      });
      return { ...plan.rotation, franchiseId: roster.franchiseId };
    } catch {
      return base;
    }
  });
  const aiAssignments = [...state.assignments.values()];
  const evaluations = rosters.map((roster) => {
    const assignment = state.assignments.get(roster.franchiseId);
    const members = roster.players.map((player) => {
      const candidate = state.byId.get(player.playerVersionId);
      if (!candidate) throw new Error(`missing candidate ${player.playerVersionId}`);
      return {
        playable: candidate.positions.playable,
        detailedRatings: candidate.detailedRatings,
        tendencies: candidate.tendencies,
        overall: candidate.summaryRatings.overallRating,
      };
    });
    const minutePlanSummary = minutePlanByFranchise.get(roster.franchiseId);
    return {
      ...evaluateSeasonRoster({
        franchiseId: roster.franchiseId,
        band: assignment?.band ?? 'average',
        identity: assignment?.identity ?? 'continuity',
        members,
      }),
      ...(minutePlanSummary !== undefined ? { minutePlanSummary } : {}),
    };
  });
  const aiPools = state.teamOrder.map((teamId) => {
    const team = state.teams.get(teamId);
    if (team === undefined) throw new Error(`missing AI team ${teamId}`);
    return toSeasonAiPool(state, team);
  });
  const diagnostics: SeasonGenerationDiagnostics = {
    seed: state.seed,
    aiVersion: SEASON_AI_VERSION,
    rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
    teamsGenerated: state.teamOrder.length,
    teamsRepaired: totalRepairs(state),
    backtracks: state.backtracks,
    nodesVisited: state.nodes,
    nodeBudget: nodeBudgetOf(state.targets),
    failedTeams: [],
    unmetConstraints: [],
  };
  const digest = seasonGenerationDigest({
    seed: state.seed,
    aiVersion: SEASON_AI_VERSION,
    rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
    rotationVersion: SEASON_ROTATION_VERSION,
    rosters,
    ownership,
    rotations: plannedRotations,
    aiAssignments,
    targetsVersion: SEASON_ROSTER_TARGETS_VERSION,
    aiPools,
    diagnostics,
  });
  const result: SeasonLeagueGenerationResult = {
    schemaVersion: 2,
    seed: state.seed,
    aiVersion: SEASON_AI_VERSION,
    rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
    rotationVersion: SEASON_ROTATION_VERSION,
    rosters,
    ownership,
    rotations: plannedRotations,
    aiAssignments,
    evaluations,
    aiPools,
    diagnostics,
    digest,
  };
  void humanFranchiseIds;
  return seasonLeagueGenerationResultSchema.parse(result);
}

/**
 * Generates the remaining AI league atomically (roster-generation-v2).
 * Throws `SeasonAiTargetsError` on invalid targets before any allocation and
 * `SeasonAiGenerationError` on budget exhaustion with the failing phase,
 * failed teams, unmet constraints, repairs, nodes, and the last canonical
 * allocation state. Rules are never relaxed.
 */
export function generateAiLeague(input: SeasonAiGenerationInput): SeasonLeagueGenerationResult {
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
  for (const roster of input.humanRosters) {
    for (const versionId of roster.playerVersionIds) {
      if (!byId.has(versionId)) {
        throw new Error(`human roster references unknown version ${versionId}`);
      }
    }
  }
  const humanOwned = new Set(input.humanRosters.flatMap((roster) => roster.playerVersionIds));
  // Canonical non-human candidate population (playerVersionId ascending).
  const canonicalCandidates = [...catalog.candidates].sort((a, b) =>
    a.playerVersionId < b.playerVersionId ? -1 : a.playerVersionId > b.playerVersionId ? 1 : 0,
  );
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
    .map((candidate) => candidate.playerVersionId)
    .filter((id) => !humanOwned.has(id));
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
  };

  matchGuaranteedAnchors(state);
  rollExtraEliteAnchors(state);
  state.phase = 'pool-fill';
  fillPoolsWithRepair(state);
  state.phase = 'selection';
  selectRosters(state);

  const generation = finalizeResult(state, league, input.humanFranchiseIds, input.humanRosters);
  if (input.projection !== undefined) {
    return attachAiProjectionSummaries({
      generation,
      catalog,
      eraProfile: input.projection.eraProfile,
      model: input.projection.model,
      seed: input.seed,
    });
  }
  return generation;
}

/**
 * Engine-side extended calibration run (M2.4 pool-level facts). The base
 * fields and the `pools` array (the full `SeasonAiPool[]` of every league)
 * match the frozen `SeasonRosterCalibrationRun` contract; `superTeamIncidence`
 * and `poolFacts` are the per-run facts the calibration gates audit. The CLI
 * workstream reconciles this shape with the data-contracts schema.
 */
export interface SeasonRosterCalibrationRunV2 extends SeasonRosterCalibrationRun {
  /** Average/weaker franchises whose roster strength exceeds the contender median. */
  superTeamIncidence: string[];
  /** Per-pool facts: anchor counts, extra-elite flags, and failure lists. */
  poolFacts: Array<{
    franchiseId: string;
    band: SeasonStrengthBand;
    identity: SeasonAiIdentity;
    anchorCount: number;
    extraEliteFlags: number;
    poolLegalityFailures: string[];
    selectionFailures: string[];
  }>;
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
  targets: SeasonRosterTargets;
}): SeasonRosterCalibrationRunV2[] {
  return input.seeds.map((seed) => {
    let generation: SeasonLeagueGenerationResult;
    try {
      generation = generateAiLeague({
        seed,
        catalog: input.catalog,
        league: input.league,
        humanFranchiseIds: input.humanRosters.map((roster) => roster.franchiseId),
        humanRosters: input.humanRosters,
        targets: input.targets,
      });
    } catch (error) {
      if (error instanceof SeasonAiGenerationError) {
        return {
          seed,
          teams: [],
          pools: [],
          repairs: error.repairs,
          backtracks: error.diagnostics.backtracks,
          nodesVisited: error.diagnostics.nodesVisited,
          failed: true,
          diagnostics: error.diagnostics,
          superTeamIncidence: [],
          poolFacts: [],
        };
      }
      throw error;
    }
    const contenderScores = generation.evaluations
      .filter((evaluation) => evaluation.band === 'contender')
      .map((evaluation) => evaluation.strengthScore)
      .sort((a, b) => a - b);
    const contenderMedian = contenderScores[Math.floor(contenderScores.length / 2)] ?? 0;
    const superTeamIncidence = generation.evaluations
      .filter(
        (evaluation) =>
          (evaluation.band === 'average' || evaluation.band === 'weaker') &&
          evaluation.strengthScore > contenderMedian,
      )
      .map((evaluation) => evaluation.franchiseId);
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
      pools: generation.aiPools,
      repairs: generation.diagnostics.teamsRepaired,
      backtracks: generation.diagnostics.backtracks,
      nodesVisited: generation.diagnostics.nodesVisited,
      failed: false,
      diagnostics: null,
      superTeamIncidence,
      poolFacts: generation.aiPools.map((pool) => ({
        franchiseId: pool.franchiseId,
        band: pool.band,
        identity: pool.identity,
        anchorCount: pool.anchors.length,
        extraEliteFlags: pool.anchors.some((anchor) => anchor.seedPath.includes('extra-elite'))
          ? 1
          : 0,
        poolLegalityFailures: [],
        selectionFailures: [],
      })),
    };
  });
}
