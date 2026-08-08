import type {
  EraSimulationProfile,
  Position,
  ProjectionModelArtifact,
  SeasonDraftCatalog,
  SeasonRotation,
  SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { seasonDigestHex } from '@hoop-rush/data-contracts';
import { enumerateLegalFives, type PlannerMember } from '../season/rotation-planner.ts';
import {
  applySeasonRotationPreset,
  buildMinimalRotation,
} from '../season/rotation.ts';
import {
  completionTargetsMet,
  legalFiveAfterAnyRemoval,
  legalFiveExists,
  rosterFeasible,
  validateSeasonRoster,
  type SeasonRosterMemberInput,
} from '../season/roster-rules.ts';
import { ProjectionCache } from './cache.ts';
import { projectSeasonRoster } from './season.ts';
import {
  rankCandidates,
  type RankedCandidate,
  type RankingGates,
  type RejectedCandidate,
} from './ranking.ts';

/**
 * Bounded deterministic candidate search (projection milestone). A beam/DFS
 * search with deterministic canonical ordering explores partial rosters
 * (pruned cheaply by lens scores and completion feasibility), completes legal
 * tens, generates bounded rotation options per roster, projects every unique
 * legal five through the shared cache, and ranks complete candidates through
 * hard gates, Pareto filtering, and the composite policy. The seed only
 * orders candidates and resolves ties; it never changes projection math.
 */

export type SearchLens =
  | 'offense'
  | 'defense'
  | 'spacing'
  | 'creation'
  | 'rebounding'
  | 'depth'
  | 'balance'
  | 'matchup-robustness';

export const SEARCH_LENSES: readonly SearchLens[] = [
  'offense',
  'defense',
  'spacing',
  'creation',
  'rebounding',
  'depth',
  'balance',
  'matchup-robustness',
];

export interface RosterRotationSearchInput {
  catalog: SeasonDraftCatalog;
  /** Already-selected playerVersionIds (preserved verbatim). */
  locked: readonly string[];
  /** Selectable playerVersionIds (owned versions, excluding locked). */
  available: readonly string[];
  seed: string;
  eraProfile: EraSimulationProfile;
  model: ProjectionModelArtifact;
  lens?: SearchLens;
  /** Gate overrides; unspecified gates default to passing. */
  gates?: Partial<RankingGates>;
}

export interface SearchAudit {
  seed: string;
  seedNamespace: string;
  lens: SearchLens;
  nodeCount: number;
  nodeBudget: number;
  cacheHits: number;
  cacheMisses: number;
  partialBeams: number;
  completeRosters: number;
  rotationsEvaluated: number;
  rejected: RejectedCandidate[];
  paretoSurvivors: number;
  selectedCandidateId: string | null;
}

export interface RosterRotationSearchResult {
  ranked: SearchedCandidate[];
  audit: SearchAudit;
  feasibilityFailure: { code: string; message: string } | null;
}

export type HumanRosterBuildInput = RosterRotationSearchInput;

export interface HumanRosterBuildResult {
  ok: boolean;
  roster: readonly string[] | null;
  rotation: SeasonRotation | null;
  projection: RankedCandidate['projection'] | null;
  ranked: RankedCandidate[];
  audit: SearchAudit;
  feasibilityFailure: { code: string; message: string } | null;
}

/** Candidate record with its rotation (the search attaches it to ranking). */
export interface SearchedCandidate extends RankedCandidate {
  rotation: SeasonRotation;
}

/** Pre-ranking search record. */
interface SearchableCandidate {
  candidateId: string;
  projection: RankedCandidate['projection'];
  rotation: SeasonRotation;
  gates: RankingGates;
}

interface CatalogMember {
  playerVersionId: string;
  playable: readonly Position[];
  player: SimulationPlayer;
}

/** Seeded deterministic ordering rank for one version id (FNV-1a based). */
function orderRank(seed: string, namespace: string, versionId: string): number {
  return seasonDigestHex(`${namespace}\u0000${seed}\u0000${versionId}`).charCodeAt(0) * 16777216 +
    seasonDigestHex(`${namespace}\u0000${seed}\u0000${versionId}`).charCodeAt(2) * 65536 +
    seasonDigestHex(`${namespace}\u0000${seed}\u0000${versionId}`).charCodeAt(4) * 256 +
    seasonDigestHex(`${namespace}\u0000${seed}\u0000${versionId}`).charCodeAt(6);
}

/** Cheap lens score for partial pruning (ratings/tendencies only). */
function lensScoreOf(member: CatalogMember, lens: SearchLens): number {
  const r = member.player.ratings;
  const t = member.player.tendencies;
  switch (lens) {
    case 'offense':
      return r.threePoint + r.insideScoring + r.midrange + r.ballHandling + r.passing;
    case 'defense':
      return r.perimeterDefense + r.interiorDefense + r.steal + r.block + r.defensiveIq;
    case 'spacing':
      return r.threePoint * (0.4 + 0.6 * (t.threePointRate / 100));
    case 'creation':
      return r.ballHandling + r.passing + r.offensiveIq;
    case 'rebounding':
      return r.offensiveRebound + r.defensiveRebound + r.vertical;
    case 'depth':
      return r.insideScoring + r.threePoint + r.perimeterDefense + r.interiorDefense;
    case 'balance':
      return Math.abs(
        (r.insideScoring + r.threePoint) / 2 - (r.perimeterDefense + r.interiorDefense) / 2,
      );
    case 'matchup-robustness':
      return r.perimeterDefense + r.interiorDefense + r.steal + r.ballHandling;
  }
}

function catalogMembers(catalog: SeasonDraftCatalog): Map<string, CatalogMember> {
  const members = new Map<string, CatalogMember>();
  for (const candidate of catalog.candidates) {
    const player: SimulationPlayer = {
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
    };
    members.set(candidate.playerVersionId, { playerVersionId: candidate.playerVersionId, playable: candidate.positions.playable, player });
  }
  return members;
}

function rosterInputMembers(
  versionIds: readonly string[],
  members: ReadonlyMap<string, CatalogMember>,
): SeasonRosterMemberInput[] {
  const out: SeasonRosterMemberInput[] = [];
  for (const id of versionIds) {
    const member = members.get(id);
    if (member !== undefined) out.push({ playerVersionId: id, playable: member.playable });
  }
  return out;
}

/** Bench-order variants for one roster (canonical, lens-driven, seeded). */
function benchOrdersOf(input: {
  roster: readonly string[];
  starters: readonly string[];
  members: ReadonlyMap<string, CatalogMember>;
  lens: SearchLens;
  cap: number;
}): string[][] {
  const { roster, starters, members, lens, cap } = input;
  const bench = roster.filter((id) => !starters.includes(id));
  const byLens = (selector: (member: CatalogMember) => number) =>
    [...bench].sort(
      (a, b) => selector(members.get(b) ?? benchMember(b)) - selector(members.get(a) ?? benchMember(b)),
    );
  const orders: string[][] = [];
  const push = (order: string[]) => {
    if (orders.length >= cap) return;
    if (!orders.some((existing) => existing.join(',') === order.join(','))) orders.push(order);
  };
  push(bench);
  push(byLens((member) => lensScoreOf(member, lens)));
  push(
    byLens(
      (member) =>
        member.player.ratings.ballHandling +
        member.player.ratings.passing +
        member.player.ratings.offensiveIq,
    ),
  );
  push(
    byLens(
      (member) =>
        member.player.ratings.perimeterDefense +
        member.player.ratings.interiorDefense +
        member.player.ratings.block,
    ),
  );
  return orders.slice(0, cap);
}

function benchMember(versionId: string): CatalogMember {
  return {
    playerVersionId: versionId,
    playable: [],
    player: {
      playerId: versionId,
      displayName: versionId,
      positions: [],
      heightInches: null,
      weightLbs: null,
      ratings: {
        insideScoring: 50,
        closeShot: 50,
        midrange: 50,
        threePoint: 50,
        freeThrow: 50,
        ballHandling: 50,
        passing: 50,
        offensiveIq: 50,
        offensiveRebound: 50,
        defensiveRebound: 50,
        perimeterDefense: 50,
        interiorDefense: 50,
        steal: 50,
        block: 50,
        defensiveIq: 50,
        speed: 50,
        strength: 50,
        vertical: 50,
      },
      tendencies: {
        usageRate: 20,
        passRate: 30,
        shotRate: 25,
        driveRate: 18,
        postUpRate: 5,
        rimFrequency: 30,
        shortMidFrequency: 20,
        longMidFrequency: 14,
        cornerThreeFrequency: 8,
        aboveBreakThreeFrequency: 12,
        threePointRate: 20,
        freeThrowRate: 22,
        turnoverRate: 12,
        isolationRate: 10,
        pickAndRollBallHandlerRate: 25,
        pickAndRollRollManRate: 10,
        spotUpRate: 20,
        transitionRate: 15,
        cutRate: 10,
        foulRate: 2,
        stealAttemptRate: 8,
        blockAttemptRate: 10,
        crashOffensiveGlassRate: 12,
      },
    },
  };
}

/** Additional minute templates beyond the three official presets (v1). */
const ADDITIONAL_MINUTE_TEMPLATES: Array<{ name: string; minutes: number[] }> = [
  { name: 'spread', minutes: [30, 30, 30, 30, 30, 18, 18, 18, 18, 18] },
  { name: 'star-load', minutes: [34, 34, 34, 34, 34, 14, 14, 14, 14, 14] },
  { name: 'two-platoon', minutes: [24, 24, 24, 24, 24, 24, 24, 24, 24, 24] },
  { name: 'closer-load', minutes: [33, 33, 33, 33, 33, 15, 15, 15, 15, 15] },
];

/** Applies a minute template to an ordered roster (versioned v1 templates). */
function rotationWithMinutes(
  orderedRoster: readonly string[],
  template: readonly number[],
): { playerVersionId: string; minutes: number }[] {
  const targets = orderedRoster.map((playerVersionId, index) => ({
    playerVersionId,
    minutes: template[index] ?? 16,
  }));
  const total = targets.reduce((sum, row) => sum + row.minutes, 0);
  const adjusted = targets.map((row) => ({
    ...row,
    minutes: Math.round((row.minutes / Math.max(1, total)) * 240),
  }));
  // Reconcile rounding to exactly 240.
  const remainder = 240 - adjusted.reduce((sum, row) => sum + row.minutes, 0);
  for (let index = 0; index < Math.abs(remainder) && index < adjusted.length; index += 1) {
    const row = adjusted[index];
    if (row === undefined) continue;
    row.minutes += remainder > 0 ? 1 : -1;
  }
  return adjusted;
}

/** Generates the bounded rotation set for one complete roster. */
function rotationsFor(input: {
  roster: readonly string[];
  members: ReadonlyMap<string, CatalogMember>;
  lens: SearchLens;
  startingFivesCap: number;
  closingFivesCap: number;
  benchHierarchiesCap: number;
  minuteTemplatesCap: number;
}): SeasonRotation[] {
  const { roster, members, lens } = input;
  const plannerMembers: PlannerMember[] = [...roster]
    .map((id) => ({ playerVersionId: id, playable: members.get(id)?.playable ?? [] }))
    .sort((a, b) => (a.playerVersionId < b.playerVersionId ? -1 : 1));
  const all = new Set(roster);
  const starters = enumerateLegalFives(plannerMembers, all).slice(0, input.startingFivesCap);
  if (starters.length === 0) return [];
  const closers = enumerateLegalFives(plannerMembers, all).slice(0, input.closingFivesCap);
  const benchOrders = benchOrdersOf({
    roster,
    starters: starters[0] ?? [],
    members,
    lens,
    cap: input.benchHierarchiesCap,
  });
  if (benchOrders.length === 0) return [];

  const presets = ['balanced', 'tight', 'bench-heavy'] as const;
  const templates: number[][] = [
    ...presets.map((preset) => {
      const base = buildMinimalRotation({
        franchiseId: 'roster',
        members: roster.map((id) => ({
          playerVersionId: id,
          playable: members.get(id)?.playable ?? [],
        })),
      });
      return applySeasonRotationPreset(base, preset).targetMinutes.map((row) => row.minutes);
    }),
    ...ADDITIONAL_MINUTE_TEMPLATES.slice(0, Math.max(0, input.minuteTemplatesCap - 3)).map(
      (template) => template.minutes,
    ),
  ];

  const rotations: SeasonRotation[] = [];
  const seen = new Set<string>();
  for (const starter of starters) {
    for (const closer of closers) {
      for (const benchOrder of benchOrders) {
        for (const template of templates) {
          if (rotations.length >= input.startingFivesCap * input.closingFivesCap * input.benchHierarchiesCap) {
            break;
          }
          const base: SeasonRotation = {
            franchiseId: 'roster',
            starters: starter,
            benchOrder,
            targetMinutes: [],
            closingFive: closer,
            rotationVersion: 'season-rotation-v2',
          };
          // targetMinutes must reference exactly the ten rostered players in
          // starter-then-bench canonical order with the template distribution.
          const orderedRoster = [...starter, ...benchOrder];
          const withMinutes: SeasonRotation = {
            ...base,
            targetMinutes: rotationWithMinutes(orderedRoster, template),
          };
          const key = JSON.stringify([starter, closer, benchOrder, withMinutes.targetMinutes]);
          if (seen.has(key)) continue;
          seen.add(key);
          rotations.push(withMinutes);
          if (rotations.length >= 48) break;
        }
        if (rotations.length >= 48) break;
      }
      if (rotations.length >= 48) break;
    }
    if (rotations.length >= 48) break;
  }
  return rotations;
}

/**
 * Searches complete roster+rotation candidates under the projection ranking
 * policy. Deterministic for identical inputs and worker counts; the seed only
 * orders candidates and tie-breaks.
 */
export function searchRosterRotationCandidates(
  input: RosterRotationSearchInput,
): RosterRotationSearchResult {
  const seedNamespace = input.model.search.seedNamespace;
  const lens = input.lens ?? 'balance';
  const members = catalogMembers(input.catalog);
  const cache = new ProjectionCache();

  const locked = [...input.locked];
  const available = input.available.filter((id) => !locked.includes(id));
  const ownedInput = rosterInputMembers(locked, members);
  const availableInput = rosterInputMembers(available, members);
  const remaining = 10 - locked.length;
  const failure = (code: string, message: string): RosterRotationSearchResult => ({
    ranked: [],
    audit: emptyAudit(input.seed, seedNamespace, lens),
    feasibilityFailure: { code, message },
  });

  if (remaining < 0) {
    return failure('TOO_MANY_LOCKED', `more than ten locked picks (${String(locked.length)})`);
  }
  if (!rosterFeasible(ownedInput, availableInput, remaining)) {
    return failure(
      'NO_FEASIBLE_COMPLETION',
      'no legal completion exists with the locked picks and the available catalog under the 4/4/3 targets',
    );
  }

  const budget = input.model.search.nodeBudgets.partial;
  let nodeCount = 0;
  const partialBeamsCap = input.model.search.partialBeamsPerLens;

  // Deterministic candidate ordering under the search seed.
  const orderedAvailable = [...available].sort(
    (a, b) => orderRank(input.seed, seedNamespace, a) - orderRank(input.seed, seedNamespace, b) || (a < b ? -1 : 1),
  );

  // Beam over partial rosters.
  let beams: string[][] = [locked];
  const complete = new Map<string, string[]>();
  for (let size = locked.length; size < 10; size += 1) {
    const next = new Map<string, string[]>();
    for (const beam of beams) {
      nodeCount += 1;
      if (nodeCount > budget) break;
      for (const id of orderedAvailable) {
        if (beam.includes(id)) continue;
        const state = [...beam, id].sort();
        const key = state.join(',');
        if (next.has(key) || complete.has(key)) continue;
        const stateMembers = rosterInputMembers(state, members);
        if (size + 1 < 10 && !rosterFeasible(stateMembers, availableInput, 10 - stateMembers.length)) {
          continue;
        }
        if (stateMembers.length >= 5 && !legalFiveExists(stateMembers)) continue;
        if (stateMembers.length === 10) {
          if (!completionTargetsMet(stateMembers)) continue;
          if (!legalFiveAfterAnyRemoval(stateMembers)) continue;
          complete.set(key, state);
          continue;
        }
        next.set(key, state);
      }
    }
    if (nodeCount > budget) break;
    // Keep the highest-scoring beams under the lens.
    const scored = [...next.values()]
      .map((state) => ({
        state,
        score: state.reduce(
          (sum, id) => sum + lensScoreOf(members.get(id) ?? benchMember(id), lens),
          0,
        ),
      }))
      .sort((a, b) => b.score - a.score || (a.state.join(',') < b.state.join(',') ? -1 : 1));
    beams = scored.slice(0, partialBeamsCap).map((entry) => entry.state);
  }

  const completeRosters = [...complete.values()]
    .sort((a, b) => a.join(',') < b.join(',') ? -1 : 1)
    .slice(0, input.model.search.completeCandidates);

  // Build and project rotations for each complete roster.
  const searched: SearchableCandidate[] = [];
  let rotationsEvaluated = 0;
  const rotationBudget = input.model.search.nodeBudgets.rotation;
  const defaultGates: RankingGates = {
    legal: true,
    legalStartersAndClosers: true,
    coverageOk: true,
    bandOk: true,
    anchorsOk: true,
    ownershipOk: true,
    rolesOk: true,
    feasibilityOk: true,
  };
  const gates: RankingGates = { ...defaultGates, ...input.gates };

  for (const roster of completeRosters) {
    if (rotationsEvaluated >= rotationBudget) break;
    const rosterMembers = rosterInputMembers(roster, members);
    const legal = validateSeasonRoster(rosterMembers).length === 0;
    const coverage = completionTargetsMet(rosterMembers);
    const rotations = rotationsFor({
      roster,
      members,
      lens,
      startingFivesCap: input.model.search.startingFives,
      closingFivesCap: input.model.search.closingFives,
      benchHierarchiesCap: input.model.search.benchHierarchies,
      minuteTemplatesCap: input.model.search.minuteTemplates + 3,
    });
    for (const rotation of rotations) {
      if (rotationsEvaluated >= rotationBudget) break;
      rotationsEvaluated += 1;
      let projection;
      try {
        projection = projectSeasonRoster(
          {
            roster: roster.map((id) => ({ player: members.get(id)?.player ?? benchMember(id).player })),
            rotation,
            eraProfile: input.eraProfile,
            model: input.model,
          },
          { cache },
        );
      } catch {
        continue;
      }
      const candidateId = `${roster.join('-')}#${rotation.starters.join('-')}`;
      const gatesForCandidate: RankingGates = {
        ...gates,
        legal,
        legalStartersAndClosers: true,
        coverageOk: coverage,
        ownershipOk: roster.every((id) => locked.includes(id) || available.includes(id)),
      };
      searched.push({
        candidateId,
        projection,
        rotation,
        gates: gatesForCandidate,
      });
    }
  }

  const result = rankCandidates({
    candidates: searched.map((candidate) => ({
      candidateId: candidate.candidateId,
      projection: candidate.projection,
      gates: candidate.gates,
    })),
    model: input.model,
  });

  // Attach rotations to the ranked survivors.
  const byId = new Map(searched.map((candidate) => [candidate.candidateId, candidate]));
  const ranked: SearchedCandidate[] = result.ranked
    .map((candidate) => {
      const full = byId.get(candidate.candidateId);
      return full === undefined ? undefined : { ...candidate, rotation: full.rotation };
    })
    .filter((candidate): candidate is SearchedCandidate => candidate !== undefined);

  const audit: SearchAudit = {
    seed: input.seed,
    seedNamespace,
    lens,
    nodeCount,
    nodeBudget: budget,
    cacheHits: cache.stats().hits,
    cacheMisses: cache.stats().misses,
    partialBeams: beams.length,
    completeRosters: completeRosters.length,
    rotationsEvaluated,
    rejected: result.rejected,
    paretoSurvivors: result.paretoSurvivors,
    selectedCandidateId: ranked[0]?.candidateId ?? null,
  };

  return { ranked, audit, feasibilityFailure: null };
}

function emptyAudit(seed: string, seedNamespace: string, lens: SearchLens): SearchAudit {
  return {
    seed,
    seedNamespace,
    lens,
    nodeCount: 0,
    nodeBudget: 0,
    cacheHits: 0,
    cacheMisses: 0,
    partialBeams: 0,
    completeRosters: 0,
    rotationsEvaluated: 0,
    rejected: [],
    paretoSurvivors: 0,
    selectedCandidateId: null,
  };
}

/**
 * Human roster autofill (season-roster-autofill-v1): preserves every locked
 * pick, enforces exact ownership and player-version uniqueness, the 4/4/3
 * completion targets, legal fives and future feasibility, searches multiple
 * complete roster paths and rotations, and selects the projection-ranked
 * best. Never relaxes a constraint: no legal completion returns the typed
 * feasibility failure.
 */
export function buildHumanSeasonRoster(input: HumanRosterBuildInput): HumanRosterBuildResult {
  const result = searchRosterRotationCandidates(input);
  if (result.feasibilityFailure !== null) {
    return {
      ok: false,
      roster: null,
      rotation: null,
      projection: null,
      ranked: [],
      audit: result.audit,
      feasibilityFailure: result.feasibilityFailure,
    };
  }
  const top = result.ranked[0];
  return {
    ok: top !== undefined,
    roster: top === undefined ? null : [...top.projection.minutes.map((row) => row.playerVersionId)],
    rotation: top?.rotation ?? null,
    projection: top?.projection ?? null,
    ranked: result.ranked,
    audit: result.audit,
    feasibilityFailure: null,
  };
}
