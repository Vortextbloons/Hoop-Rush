import {
  eraSimulationProfileSchema,
  franchiseIdSchema,
  projectionModelArtifactSchema,
  seasonNamespaceSeed,
  type EraSimulationProfile,
  type Position,
  type ProjectionModelArtifact,
  type SeasonRotation,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { createRng } from '../sim/rng.ts';
import {
  benchReliefOf,
  buildMinutePlanCandidates,
  fatigueBandOf,
  MINUTE_PLAN_HEAVY_THRESHOLD_BP,
  minuteCapacityOf,
  minutePlanHorizonGames,
  planQualityOf,
  projectFatigueAfterBlock,
  riskScoreOf,
  type FatigueBand,
} from './minute-plan.ts';
import { legalFiveExists } from './roster-rules.ts';
import { validateSeasonRotation } from './rotation.ts';
import { enumerateLegalFives, type PlannerMember } from './rotation-planner.ts';
import {
  ProjectionCache,
  projectedQualityWeights,
  projectSeasonRoster,
} from '../projection/index.ts';

export const AUTO_ROTATION_SEED_NAMESPACE = 'auto-rotation' as const;
export const AUTO_ROTATION_MAX_ALTERNATIVES = 2 as const;
export const AUTO_ROTATION_MAX_COMBOS = 3003 as const;

export type AutoRotationScope = 'full' | 'minutes-only';

export interface AutoRotationMemberInput {
  playerVersionId: string;
  playable: readonly Position[];
  overall: number;
  staminaRating: number;
  durability: number;
  fatigueBasisPoints: number;
  recentLoadBasisPoints: number;
  foulRate?: number;
  usageRate?: number;
  freeThrowRating?: number;
}

export interface AutoRotationProjectionInput {
  players: readonly SimulationPlayer[];
  eraProfile: EraSimulationProfile;
  model: ProjectionModelArtifact;
}

export type PlayerId = string;

export interface SeasonPlayerLoad {
  staminaRating: number;
  durability: number;
  fatigueBasisPoints: number;
  recentLoadBasisPoints: number;
}

export type RotationCandidatePlayer = AutoRotationMemberInput;
export type RotationProjectionHorizon = number;
export type RotationProjectionContext = AutoRotationProjectionInput;
export type RotationRecommendationChange = RecommendSeasonRotationChange;
export type RotationRecommendationMetrics = RecommendSeasonRotationMetrics;
export interface RotationRecommendationFact {
  key: string;
  value: string;
  detail?: string;
}

export type RotationProjectionHorizonInput = RotationProjectionHorizon;

export interface SeasonRotationRecommendationInput {
  roster: readonly RotationCandidatePlayer[];
  current: SeasonRotation;
  loadByPlayerId: Readonly<Record<PlayerId, SeasonPlayerLoad>>;
  unavailablePlayerIds: readonly PlayerId[];
  excludedPlayerIds?: readonly PlayerId[];
  horizon: RotationProjectionHorizon;
  seed: string;
  scope: 'minutes-only' | 'full';
  keepActive10: boolean;
  allowDnp?: boolean;
  projection?: RotationProjectionContext | null;
  franchiseId?: string;
  sharedPossessions?: ReadonlyMap<string, number> | null;
}

export type SeasonRotationRecommendationResult =
  | {
      status: 'recommended';
      candidate: SeasonRotation;
      alternatives: readonly SeasonRotation[];
      changes: readonly RotationRecommendationChange[];
      metrics: RotationRecommendationMetrics;
      degraded: boolean;
      facts: readonly RotationRecommendationFact[];
    }
  | {
      status: 'unavailable';
      code: 'fewer-than-ten-eligible' | 'no-legal-five' | 'no-valid-rotation';
      message: string;
      facts: readonly RotationRecommendationFact[];
    };

export interface RecommendSeasonRotationInput {
  franchiseId: string;
  roster: readonly AutoRotationMemberInput[];
  unavailable: readonly string[];
  excluded?: readonly string[];
  current: SeasonRotation;
  horizon: number;
  seed: string;
  scope?: AutoRotationScope;
  keepActive10?: boolean;
  allowDnp?: boolean;
  projection?: AutoRotationProjectionInput | null;
  sharedPossessions?: ReadonlyMap<string, number> | null;
}

export type RecommendSeasonRotationChange =
  | {
      kind: 'starter';
      playerVersionId: string;
      fromSlot: number | null;
      toSlot: number;
      reason: string;
    }
  | {
      kind: 'bench';
      playerVersionId: string;
      fromBench: number | null;
      toBench: number;
      reason: string;
    }
  | {
      kind: 'closing';
      playerVersionId: string;
      fromSlot: number | null;
      toSlot: number;
      reason: string;
    }
  | { kind: 'minutes'; playerVersionId: string; from: number; to: number; reason: string }
  | { kind: 'swap'; inPlayerVersionId: string; outPlayerVersionId: string; reason: string };

export interface RecommendSeasonRotationMetrics {
  quality: number;
  riskScore: number;
  maxStarterStrainBp: number;
  strainBand: FatigueBand;
  relief: number;
  projectedNetRating: number | null;
}

export interface RecommendSeasonRotationFacts {
  qualitySource: 'projection' | 'ovr';
  horizon: number;
  seedNamespace: typeof AUTO_ROTATION_SEED_NAMESPACE;
  seed: string;
  eligibleCount: number;
  consideredCombos: number;
  allowDnp: boolean;
  excludedCount: number;
}

export type RecommendSeasonRotationResult =
  | {
      status: 'recommended';
      candidate: SeasonRotation;
      alternatives: SeasonRotation[];
      changes: RecommendSeasonRotationChange[];
      metrics: RecommendSeasonRotationMetrics;
      degraded: boolean;
      facts: RecommendSeasonRotationFacts;
    }
  | {
      status: 'unavailable';
      reason: string;
      degraded: boolean;
      facts: RecommendSeasonRotationFacts;
    };

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function ovrQualityOf(overall: number): number {
  return clamp01(overall / 100);
}

function capacityOf(member: AutoRotationMemberInput): number {
  return minuteCapacityOf({
    staminaRating: member.staminaRating,
    durability: member.durability,
    fatigueBasisPoints: member.fatigueBasisPoints,
  });
}

function comboKeyOf(ids: readonly string[]): string {
  return [...ids].sort().join(',');
}

function fiveKeyOf(five: readonly string[]): string {
  return five.join(',');
}

function rotationKeyOf(rotation: SeasonRotation): string {
  return JSON.stringify({
    starters: rotation.starters,
    benchOrder: rotation.benchOrder,
    closingFive: rotation.closingFive,
    targetMinutes: [...rotation.targetMinutes].sort((a, b) =>
      a.playerVersionId < b.playerVersionId ? -1 : 1,
    ),
    minutePolicy: rotation.minutePolicy,
  });
}

function combinations<T>(items: readonly T[], k: number): T[][] {
  const out: T[][] = [];
  const walk = (start: number, acc: T[]): void => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < items.length; i += 1) {
      const item = items[i];
      if (item === undefined) continue;
      acc.push(item);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}

function pairLookup(
  shared: ReadonlyMap<string, number> | null | undefined,
  a: string,
  b: string,
): number | null {
  if (shared === null || shared === undefined) return null;
  const direct = shared.get(`${a}\u0000${b}`);
  if (direct !== undefined) return direct;
  const flipped = shared.get(`${b}\u0000${a}`);
  if (flipped !== undefined) return flipped;
  return null;
}

function fmt2(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function isSpecRecommendationInput(
  value: RecommendSeasonRotationInput | SeasonRotationRecommendationInput,
): value is SeasonRotationRecommendationInput {
  return 'loadByPlayerId' in value || 'unavailablePlayerIds' in value || !('unavailable' in value);
}

function normalizeRecommendationInput(
  raw: RecommendSeasonRotationInput | SeasonRotationRecommendationInput,
): RecommendSeasonRotationInput {
  if (!isSpecRecommendationInput(raw)) return raw;
  const spec = raw;
  const merged: AutoRotationMemberInput[] = spec.roster.map((member) => {
    const load = spec.loadByPlayerId[member.playerVersionId];
    if (load) {
      return {
        ...member,
        staminaRating: load.staminaRating,
        durability: load.durability,
        fatigueBasisPoints: load.fatigueBasisPoints,
        recentLoadBasisPoints: load.recentLoadBasisPoints,
      };
    }
    return { ...member };
  });
  return {
    franchiseId: spec.franchiseId ?? spec.current.franchiseId,
    roster: merged,
    unavailable: [...spec.unavailablePlayerIds],
    excluded: spec.excludedPlayerIds !== undefined ? [...spec.excludedPlayerIds] : undefined,
    current: spec.current,
    horizon: spec.horizon,
    seed: spec.seed,
    scope: spec.scope,
    keepActive10: spec.keepActive10,
    allowDnp: spec.allowDnp,
    projection: spec.projection ?? null,
    sharedPossessions: spec.sharedPossessions ?? null,
  };
}

export function recommendSeasonRotation(
  rawInput: RecommendSeasonRotationInput | SeasonRotationRecommendationInput,
): RecommendSeasonRotationResult & {
  candidate?: SeasonRotation;
  alternatives?: readonly SeasonRotation[];
  changes?: readonly RotationRecommendationChange[];
  metrics?: RotationRecommendationMetrics;
  code?: 'fewer-than-ten-eligible' | 'no-legal-five' | 'no-valid-rotation';
  message?: string;
} {
  const input: RecommendSeasonRotationInput = normalizeRecommendationInput(rawInput);
  const scope: AutoRotationScope = input.scope ?? 'full';
  const keepActive10 = input.keepActive10 ?? false;
  const franchiseId = franchiseIdSchema.parse(input.franchiseId);
  const horizon = minutePlanHorizonGames(Math.max(1, Math.floor(input.horizon)));
  const seed = input.seed;
  if (typeof seed !== 'string' || seed.length === 0) {
    throw new Error('auto-rotation: seed must be a non-empty named seed string');
  }
  if (input.roster.length < 10 || input.roster.length > 15) {
    throw new Error(
      `auto-rotation: roster must carry 10-15 members (got ${String(input.roster.length)})`,
    );
  }
  const seen = new Set<string>();
  for (const member of input.roster) {
    if (seen.has(member.playerVersionId)) {
      throw new Error(`auto-rotation: duplicate roster member ${member.playerVersionId}`);
    }
    seen.add(member.playerVersionId);
  }
  const byId = new Map(input.roster.map((member) => [member.playerVersionId, member]));
  const excluded = new Set(input.excluded ?? []);
  const unavailable = new Set([...input.unavailable, ...excluded]);
  const excludedCount = [...excluded].filter((id) => byId.has(id)).length;
  const allowDnp = input.allowDnp ?? false;
  const eligible = input.roster.filter((member) => !unavailable.has(member.playerVersionId));
  const eligibleIds = new Set(eligible.map((member) => member.playerVersionId));
  const excludedKey = [...excluded].sort().join(',');
  const derivedSeed = seasonNamespaceSeed(
    seed,
    AUTO_ROTATION_SEED_NAMESPACE,
    scope,
    keepActive10 ? 'keep10' : 'full10',
    String(horizon),
    allowDnp ? 'dnp' : 'nodnp',
    excludedKey === '' ? 'noexcl' : excludedKey.slice(0, 48),
  );
  const rng = createRng(derivedSeed);
  const baseFacts: RecommendSeasonRotationFacts = {
    qualitySource: input.projection == null ? 'ovr' : 'projection',
    horizon,
    seedNamespace: AUTO_ROTATION_SEED_NAMESPACE,
    seed: derivedSeed,
    eligibleCount: eligible.length,
    consideredCombos: 0,
    allowDnp,
    excludedCount,
  };
  if (eligible.length < 10) {
    return {
      status: 'unavailable',
      reason: `need five legal G/G/F/F/C players from ten eligible (got ${String(eligible.length)} eligible)`,
      degraded: input.projection == null,
      facts: { ...baseFacts, consideredCombos: 0 },
    };
  }
  let qualityByVersion = new Map<string, number>();
  let qualitySource: 'projection' | 'ovr' = 'ovr';
  let degraded = true;
  let projectionCache: ProjectionCache | null = null;
  let projectionPlayers: readonly SimulationPlayer[] | null = null;
  let projectionEra: EraSimulationProfile | null = null;
  let projectionModel: ProjectionModelArtifact | null = null;
  if (input.projection !== null && input.projection !== undefined) {
    const modelCheck = projectionModelArtifactSchema.safeParse(input.projection.model);
    if (!modelCheck.success) {
      throw new Error('auto-rotation: invalid projection model artifact');
    }
    const eraCheck = eraSimulationProfileSchema.safeParse(input.projection.eraProfile);
    if (!eraCheck.success) {
      throw new Error('auto-rotation: invalid era simulation profile');
    }
    if (input.projection.players.length === 0) {
      throw new Error('auto-rotation: invalid projection roster');
    }
    projectionPlayers = input.projection.players;
    projectionEra = eraCheck.data;
    projectionModel = modelCheck.data;
    projectionCache = new ProjectionCache();
    const byVersion = new Map<string, SimulationPlayer>();
    for (const player of projectionPlayers) {
      const version = player.playerVersionId;
      if (version === undefined) continue;
      byVersion.set(version, player);
    }
    for (const member of eligible) {
      if (!byVersion.has(member.playerVersionId)) {
        throw new Error(
          `auto-rotation: projection roster missing playerVersionId ${member.playerVersionId}`,
        );
      }
    }
    const traceRotation = representativeTraceRotation(input.current, eligible);
    const playersForQuality = projectionPlayers.filter((player) => {
      const version = player.playerVersionId;
      return version !== undefined && eligibleIds.has(version);
    });
    try {
      const weights = projectedQualityWeights({
        players: playersForQuality,
        byVersion,
        rotation: traceRotation,
        eraProfile: projectionEra,
        model: projectionModel,
        cache: projectionCache,
      });
      qualityByVersion = new Map<string, number>();
      for (const member of eligible) {
        const projected = weights.get(member.playerVersionId);
        qualityByVersion.set(
          member.playerVersionId,
          projected === undefined ? ovrQualityOf(member.overall) : clamp01(projected),
        );
      }
    } catch (error) {
      throw new Error(
        `auto-rotation: invalid projection model artifact (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    qualitySource = 'projection';
    degraded = false;
  } else {
    qualityByVersion = new Map(
      eligible.map((member) => [member.playerVersionId, ovrQualityOf(member.overall)]),
    );
    qualitySource = 'ovr';
    degraded = true;
  }
  const factsBase: RecommendSeasonRotationFacts = { ...baseFacts, qualitySource };
  const foulByVersion = new Map<string, number>();
  const usageByVersion = new Map<string, number>();
  const freeThrowByVersion = new Map<string, number>();
  if (projectionPlayers !== null) {
    for (const player of projectionPlayers) {
      const version = player.playerVersionId;
      if (version === undefined) continue;
      foulByVersion.set(version, player.tendencies.foulRate);
      usageByVersion.set(version, player.tendencies.usageRate);
      freeThrowByVersion.set(version, player.ratings.freeThrow);
    }
  }
  for (const member of eligible) {
    if (member.foulRate !== undefined) foulByVersion.set(member.playerVersionId, member.foulRate);
    if (member.usageRate !== undefined)
      usageByVersion.set(member.playerVersionId, member.usageRate);
    if (member.freeThrowRating !== undefined)
      freeThrowByVersion.set(member.playerVersionId, member.freeThrowRating);
  }
  const foulDiscountOf = (id: string): number => {
    const foul = foulByVersion.get(id);
    if (foul === undefined) return 1;
    if (foul <= 55) return 1;
    return Math.max(0.7, 1 - 0.15 * Math.min(1, (foul - 55) / 45));
  };
  const injuryDiscountOf = (id: string): number => {
    const member = byId.get(id);
    if (member === undefined) return 1;
    const loadRisk = Math.max(0, Math.min(1, member.recentLoadBasisPoints / 10000)) * 0.12;
    const durabilityRisk = Math.max(0, Math.min(1, (70 - member.durability) / 70)) * 0.1;
    return Math.max(0.75, 1 - loadRisk - durabilityRisk);
  };
  const effectiveOf = (id: string): number => {
    const member = byId.get(id);
    const quality = qualityByVersion.get(id) ?? 0.5;
    if (member === undefined) return 0;
    const base = clamp01(quality) * capacityOf(member);
    if (!allowDnp) return base;
    return base * foulDiscountOf(id) * injuryDiscountOf(id);
  };
  const chemistryCostOf = (combo: readonly string[]): number => {
    const shared = input.sharedPossessions ?? null;
    if (shared === null || shared.size === 0) return 0;
    const comboSet = new Set(combo);
    let broken = 0;
    for (const id of currentActive) {
      if (comboSet.has(id)) continue;
      const disruption = describeChemistryDisruption(id, comboSet, shared);
      if (disruption !== null) broken += 1;
    }
    return broken * 0.02;
  };
  const synergyPenaltyOf = (five: readonly string[]): number => {
    if (!allowDnp) return 0;
    let penalty = 0;
    let highUsage = 0;
    let highFoul = 0;
    for (const id of five) {
      const usage = usageByVersion.get(id) ?? 20;
      const foul = foulByVersion.get(id) ?? 30;
      if (usage >= 30) highUsage += 1;
      if (foul >= 70) highFoul += 1;
    }
    if (highUsage >= 3) penalty += 0.03 + 0.02 * (highUsage - 3);
    if (highFoul >= 2) penalty += 0.03 + 0.02 * (highFoul - 2);
    return penalty;
  };
  const currentActive = [...input.current.starters, ...input.current.benchOrder];
  const currentActiveSet = new Set(currentActive);
  const incumbentActive10WinsTies = (combo: readonly string[]): number => {
    let overlap = 0;
    for (const id of combo) if (currentActiveSet.has(id)) overlap += 1;
    return overlap;
  };

  if (scope === 'minutes-only') {
    for (const id of currentActive) {
      if (!eligibleIds.has(id)) {
        return {
          status: 'unavailable',
          reason: `minutes-only keeps structure but ${id} is unavailable`,
          degraded,
          facts: { ...factsBase, consideredCombos: 0 },
        };
      }
    }
    const memberPlayable = new Map(
      currentActive.map((id) => {
        const member = byId.get(id);
        return [id, member?.playable ?? []] as const;
      }),
    );
    const failures = validateSeasonRotation(input.current, memberPlayable);
    if (failures.length > 0) {
      return {
        status: 'unavailable',
        reason: `minutes-only keeps structure but current rotation is illegal: ${failures[0] ?? 'invalid'}`,
        degraded,
        facts: { ...factsBase, consideredCombos: 0 },
      };
    }
    const built = buildPlansForStructure(
      {
        starters: [...input.current.starters],
        benchOrder: [...input.current.benchOrder],
        closingFive: [...input.current.closingFive],
      },
      eligible,
      qualityByVersion,
      horizon,
      franchiseId,
    );
    let recommended = recommendedPlanOf(built);
    if (allowDnp) {
      const structure = {
        starters: [...input.current.starters],
        benchOrder: [...input.current.benchOrder],
        closingFive: [...input.current.closingFive],
      };
      const players = new Map(
        [...structure.starters, ...structure.benchOrder].map((id) => {
          const member = eligible.find((entry) => entry.playerVersionId === id);
          return [
            id,
            {
              playerVersionId: id,
              quality: qualityByVersion.get(id) ?? 0.5,
              staminaRating: member?.staminaRating ?? 70,
              durability: member?.durability ?? 70,
              fatigueBasisPoints: member?.fatigueBasisPoints ?? 0,
              recentLoadBasisPoints: member?.recentLoadBasisPoints ?? 0,
            },
          ] as const;
        }),
      );
      const dnp = tryDnpVariant({
        structure,
        players,
        basePlan: recommended,
        allPlans: built.plans,
        qualityByVersion,
        effectiveOf,
        horizon,
        franchiseId,
      });
      if (dnp !== null) recommended = dnp.plan;
    }
    const candidate = withFranchise(recommended.rotation, franchiseId);
    const candidateFailures = validateSeasonRotation(candidate, memberPlayable);
    if (candidateFailures.length > 0) {
      throw new Error(
        `auto-rotation: minutes plan failed validation: ${candidateFailures[0] ?? ''}`,
      );
    }
    const alternatives = built.plans
      .filter((plan) => plan.strategy !== built.recommendedStrategy)
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, AUTO_ROTATION_MAX_ALTERNATIVES)
      .map((plan) => withFranchise(plan.rotation, franchiseId))
      .filter((rotation) => validateSeasonRotation(rotation, memberPlayable).length === 0)
      .filter((rotation, index, all) => {
        if (rotationKeyOf(rotation) === rotationKeyOf(candidate)) return false;
        return all.findIndex((other) => rotationKeyOf(other) === rotationKeyOf(rotation)) === index;
      });
    const changes = diffMinutes(input.current, candidate, effectiveOf, byId, qualityByVersion);
    const metrics = metricsOf(
      recommended,
      candidate,
      projectionPlayers,
      projectionEra,
      projectionModel,
    );
    return {
      status: 'recommended',
      candidate,
      alternatives,
      changes,
      metrics,
      degraded,
      facts: { ...factsBase, consideredCombos: 1 },
    };
  }

  let activeCombos: string[][];
  if (keepActive10) {
    for (const id of currentActive) {
      if (!eligibleIds.has(id)) {
        return {
          status: 'unavailable',
          reason: `keep-active-10 keeps structure but ${id} is unavailable`,
          degraded,
          facts: { ...factsBase, consideredCombos: 0 },
        };
      }
    }
    const playableForCurrent = new Map(
      currentActive.map((id) => [id, byId.get(id)?.playable ?? []] as const),
    );
    const asMembers = currentActive.map((id) => ({
      playerVersionId: id,
      playable: byId.get(id)?.playable ?? [],
    }));
    if (!legalFiveExists(asMembers)) {
      return {
        status: 'unavailable',
        reason:
          'need five legal G/G/F/F/C players from ten eligible (keep-active-10 has no legal five)',
        degraded,
        facts: { ...factsBase, consideredCombos: 0 },
      };
    }
    void playableForCurrent;
    activeCombos = [[...currentActive].sort()];
  } else if (eligible.length === 10) {
    const ten = eligible.map((member) => member.playerVersionId).sort();
    const asMembers = ten.map((id) => ({
      playerVersionId: id,
      playable: byId.get(id)?.playable ?? [],
    }));
    if (!legalFiveExists(asMembers)) {
      return {
        status: 'unavailable',
        reason: 'need five legal G/G/F/F/C players from ten eligible (no legal five)',
        degraded,
        facts: { ...factsBase, consideredCombos: 0 },
      };
    }
    activeCombos = [ten];
  } else {
    const sortedEligible = [...eligible].map((member) => member.playerVersionId).sort();
    const raw = combinations(sortedEligible, 10);
    if (raw.length > AUTO_ROTATION_MAX_COMBOS + 1) {
      throw new Error(`auto-rotation: too many active-ten combos (${String(raw.length)})`);
    }
    const scored = raw.map((combo) => {
      const members = combo.map((id) => ({
        playerVersionId: id,
        playable: byId.get(id)?.playable ?? [],
      }));
      const legal = legalFiveExists(members);
      const base = legal ? combo.reduce((sum, id) => sum + effectiveOf(id), 0) : -1;
      const score = legal && allowDnp ? base - chemistryCostOf(combo) : base;
      return { combo: [...combo].sort(), legal, score, tie: rng.next() };
    });
    const legal = scored.filter((entry) => entry.legal);
    if (legal.length === 0) {
      return {
        status: 'unavailable',
        reason: 'need five legal G/G/F/F/C players from ten eligible (no legal active-ten)',
        degraded,
        facts: { ...factsBase, consideredCombos: raw.length },
      };
    }
    legal.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const continuity = incumbentActive10WinsTies(b.combo) - incumbentActive10WinsTies(a.combo);
      if (continuity !== 0) return continuity;
      if (a.tie !== b.tie) return a.tie - b.tie;
      return comboKeyOf(a.combo) < comboKeyOf(b.combo) ? -1 : 1;
    });
    baseFacts.consideredCombos = raw.length;
    factsBase.consideredCombos = raw.length;
    activeCombos = legal.map((entry) => entry.combo);
  }

  const rankedRotations: Array<{
    rotation: SeasonRotation;
    active: readonly string[];
    riskScore: number;
    strain: number;
    plan: ReturnType<typeof buildMinutePlanCandidates>['plans'][number];
  }> = [];
  const seenRotations = new Set<string>();
  const maxActiveToExpand = keepActive10 || eligible.length === 10 ? 1 : allowDnp ? 6 : 3;
  const activesToExpand = activeCombos.slice(0, Math.max(allowDnp ? 6 : 3, maxActiveToExpand));
  for (const active of activesToExpand) {
    const built = buildFullRotationForActive({
      active: [...active].sort(),
      byId,
      effectiveOf,
      current: input.current,
      horizon,
      franchiseId,
      qualityByVersion,
      rng,
      sharedPossessions: input.sharedPossessions ?? null,
      synergyPenaltyOf: allowDnp ? synergyPenaltyOf : undefined,
      freeThrowByVersion: allowDnp ? freeThrowByVersion : undefined,
      allowDnp,
    });
    if (built === null) continue;
    const key = rotationKeyOf(built.rotation);
    if (seenRotations.has(key)) continue;
    seenRotations.add(key);
    rankedRotations.push({
      rotation: built.rotation,
      active,
      riskScore: built.plan.riskScore,
      strain: built.plan.maxStarterStrainBasisPoints,
      plan: built.plan,
    });
    if (rankedRotations.length >= 3 && (keepActive10 || eligible.length === 10)) break;
  }

  if (keepActive10 || eligible.length === 10) {
    const active = activeCombos[0];
    if (active === undefined) {
      return {
        status: 'unavailable',
        reason: 'need five legal G/G/F/F/C players from ten eligible (no legal active-ten)',
        degraded,
        facts: factsBase,
      };
    }
    const starterVariants = rankStarterVariants({
      active,
      byId,
      effectiveOf,
      incumbentStarters: input.current.starters,
      rng,
      synergyPenaltyOf: allowDnp ? synergyPenaltyOf : undefined,
    }).slice(0, allowDnp ? 4 : 3);
    rankedRotations.length = 0;
    seenRotations.clear();
    for (const starters of starterVariants) {
      const built = buildFullRotationForActive({
        active: [...active].sort(),
        byId,
        effectiveOf,
        current: input.current,
        horizon,
        franchiseId,
        qualityByVersion,
        rng,
        sharedPossessions: input.sharedPossessions ?? null,
        forcedStarters: starters,
        synergyPenaltyOf: allowDnp ? synergyPenaltyOf : undefined,
        freeThrowByVersion: allowDnp ? freeThrowByVersion : undefined,
        allowDnp,
      });
      if (built === null) continue;
      const key = rotationKeyOf(built.rotation);
      if (seenRotations.has(key)) continue;
      seenRotations.add(key);
      rankedRotations.push({
        rotation: built.rotation,
        active,
        riskScore: built.plan.riskScore,
        strain: built.plan.maxStarterStrainBasisPoints,
        plan: built.plan,
      });
    }
  } else {
    rankedRotations.sort((a, b) => {
      if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
      if (a.strain !== b.strain) return a.strain - b.strain;
      const continuity = incumbentActive10WinsTies(b.active) - incumbentActive10WinsTies(a.active);
      if (continuity !== 0) return continuity;
      return rotationKeyOf(a.rotation) < rotationKeyOf(b.rotation) ? -1 : 1;
    });
  }

  if (rankedRotations.length === 0) {
    return {
      status: 'unavailable',
      reason: 'need five legal G/G/F/F/C players from ten eligible (no valid rotation)',
      degraded,
      facts: factsBase,
    };
  }
  const winner = rankedRotations[0];
  if (winner === undefined) {
    return {
      status: 'unavailable',
      reason: 'need five legal G/G/F/F/C players from ten eligible (no valid rotation)',
      degraded,
      facts: factsBase,
    };
  }
  const candidate = winner.rotation;
  const alternatives = rankedRotations
    .slice(1, 1 + AUTO_ROTATION_MAX_ALTERNATIVES)
    .map((entry) => entry.rotation);
  const changes = diffRotations(input.current, candidate, {
    effectiveOf,
    byId,
    qualityByVersion,
    sharedPossessions: input.sharedPossessions ?? null,
  });
  const metrics = metricsOf(
    winner.plan,
    candidate,
    projectionPlayers,
    projectionEra,
    projectionModel,
  );
  return {
    status: 'recommended',
    candidate,
    alternatives,
    changes,
    metrics,
    degraded,
    facts: factsBase,
  };
}

function representativeTraceRotation(
  current: SeasonRotation,
  eligible: readonly AutoRotationMemberInput[],
): SeasonRotation {
  const eligibleIds = new Set(eligible.map((member) => member.playerVersionId));
  const currentIds = [...current.starters, ...current.benchOrder];
  const currentCovered = currentIds.every((id) => eligibleIds.has(id));
  if (currentCovered) return current;
  const sorted = [...eligible].sort((a, b) => (a.playerVersionId < b.playerVersionId ? -1 : 1));
  for (let start = 0; start + 10 <= sorted.length; start += 1) {
    const ten = sorted.slice(start, start + 10);
    const members = ten.map((member) => ({
      playerVersionId: member.playerVersionId,
      playable: member.playable,
    }));
    if (!legalFiveExists(members)) continue;
    const starters = firstLegalFive(members);
    if (starters === null) continue;
    const starterSet = new Set(starters);
    const bench = ten.map((member) => member.playerVersionId).filter((id) => !starterSet.has(id));
    return {
      ...current,
      starters,
      benchOrder: bench,
      closingFive: [...starters],
      targetMinutes: [
        ...starters.map((playerVersionId) => ({ playerVersionId, minutes: 32 })),
        ...bench.map((playerVersionId) => ({ playerVersionId, minutes: 16 })),
      ],
    };
  }
  return current;
}

function firstLegalFive(
  members: readonly { playerVersionId: string; playable: readonly Position[] }[],
): string[] | null {
  const planner: PlannerMember[] = members.map((member) => ({
    playerVersionId: member.playerVersionId,
    playable: member.playable,
  }));
  const available = new Set(members.map((member) => member.playerVersionId));
  const first = enumerateLegalFives(planner, available)[0];
  return first === undefined ? null : [...first];
}

function withFranchise(rotation: SeasonRotation, franchiseId: string): SeasonRotation {
  return { ...rotation, franchiseId: franchiseIdSchema.parse(franchiseId) };
}

function buildPlansForStructure(
  structure: { starters: string[]; benchOrder: string[]; closingFive: string[] },
  eligible: readonly AutoRotationMemberInput[],
  qualityByVersion: ReadonlyMap<string, number>,
  horizon: number,
  franchiseId: string,
): {
  plans: Array<ReturnType<typeof buildMinutePlanCandidates>['plans'][number]>;
  recommendedStrategy: ReturnType<typeof buildMinutePlanCandidates>['recommended'];
} {
  const players = new Map(
    [...structure.starters, ...structure.benchOrder].map((id) => {
      const member = eligible.find((entry) => entry.playerVersionId === id);
      return [
        id,
        {
          playerVersionId: id,
          quality: qualityByVersion.get(id) ?? 0.5,
          staminaRating: member?.staminaRating ?? 70,
          durability: member?.durability ?? 70,
          fatigueBasisPoints: member?.fatigueBasisPoints ?? 0,
          recentLoadBasisPoints: member?.recentLoadBasisPoints ?? 0,
        },
      ] as const;
    }),
  );
  const built = buildMinutePlanCandidates({ structure, players, horizon });
  return {
    plans: built.plans.map((plan) => ({
      ...plan,
      rotation: withFranchise(plan.rotation, franchiseId),
    })),
    recommendedStrategy: built.recommended,
  };
}

function recommendedPlanOf(built: {
  plans: Array<ReturnType<typeof buildMinutePlanCandidates>['plans'][number]>;
  recommendedStrategy: ReturnType<typeof buildMinutePlanCandidates>['recommended'];
}): ReturnType<typeof buildMinutePlanCandidates>['plans'][number] {
  const found = built.plans.find((plan) => plan.strategy === built.recommendedStrategy);
  const fallback = built.plans[0];
  if (found !== undefined) return found;
  if (fallback === undefined) throw new Error('auto-rotation: no minute plan produced');
  return fallback;
}

function rankStarterVariants(input: {
  active: readonly string[];
  byId: ReadonlyMap<string, AutoRotationMemberInput>;
  effectiveOf: (id: string) => number;
  incumbentStarters: readonly string[];
  rng: ReturnType<typeof createRng>;
  synergyPenaltyOf?: (five: readonly string[]) => number;
}): string[][] {
  const members: PlannerMember[] = [...input.active]
    .sort()
    .map((id) => ({ playerVersionId: id, playable: input.byId.get(id)?.playable ?? [] }));
  const available = new Set(input.active);
  const fives = enumerateLegalFives(members, available);
  const scored = fives.map((five) => ({
    five: [...five],
    score:
      five.reduce((sum, id) => sum + input.effectiveOf(id), 0) -
      (input.synergyPenaltyOf?.(five) ?? 0),
    continuity: five.filter((id) => input.incumbentStarters.includes(id)).length,
    tie: input.rng.next(),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.continuity !== a.continuity) return b.continuity - a.continuity;
    if (a.tie !== b.tie) return a.tie - b.tie;
    return fiveKeyOf(a.five) < fiveKeyOf(b.five) ? -1 : 1;
  });
  return scored.map((entry) => entry.five);
}

function pickBestFive(input: {
  active: readonly string[];
  byId: ReadonlyMap<string, AutoRotationMemberInput>;
  effectiveOf: (id: string) => number;
  incumbent: readonly string[];
  rng: ReturnType<typeof createRng>;
  synergyPenaltyOf?: (five: readonly string[]) => number;
  freeThrowByVersion?: ReadonlyMap<string, number>;
  preferClosing?: boolean;
}): string[] | null {
  const ranked = rankStarterVariants({
    active: input.active,
    byId: input.byId,
    effectiveOf: input.effectiveOf,
    incumbentStarters: [...input.incumbent],
    rng: input.rng,
    synergyPenaltyOf: input.synergyPenaltyOf,
  });
  if (ranked.length === 0) return null;
  if (input.preferClosing !== true || input.freeThrowByVersion === undefined) {
    const first = ranked[0];
    return first === undefined ? null : [...first];
  }
  const topScore =
    ranked[0] === undefined
      ? 0
      : ranked[0].reduce((sum, id) => sum + input.effectiveOf(id), 0) -
        (input.synergyPenaltyOf?.(ranked[0]) ?? 0);
  const contenders = ranked.slice(0, 3).filter((five) => {
    const score =
      five.reduce((sum, id) => sum + input.effectiveOf(id), 0) -
      (input.synergyPenaltyOf?.(five) ?? 0);
    return topScore - score <= 0.04;
  });
  contenders.sort((a, b) => {
    const ftA = a.reduce((sum, id) => sum + (input.freeThrowByVersion?.get(id) ?? 70), 0) / 5;
    const ftB = b.reduce((sum, id) => sum + (input.freeThrowByVersion?.get(id) ?? 70), 0) / 5;
    if (ftB !== ftA) return ftB - ftA;
    return fiveKeyOf(a) < fiveKeyOf(b) ? -1 : 1;
  });
  const winner = contenders[0] ?? ranked[0];
  return winner === undefined ? null : [...winner];
}

function orderBench(input: {
  benchCandidates: readonly string[];
  byId: ReadonlyMap<string, AutoRotationMemberInput>;
  effectiveOf: (id: string) => number;
  currentBench: readonly string[];
  starterIds: readonly string[];
  rng: ReturnType<typeof createRng>;
}): string[] {
  const heavyStarter = input.starterIds.some((id) => {
    const member = input.byId.get(id);
    if (member === undefined) return false;
    return (
      member.fatigueBasisPoints >= MINUTE_PLAN_HEAVY_THRESHOLD_BP ||
      fatigueBandOf(member.fatigueBasisPoints) === 'heavy'
    );
  });
  const benchIndex = new Map(input.currentBench.map((id, index) => [id, index]));
  const scored = input.benchCandidates.map((id) => {
    const member = input.byId.get(id);
    return {
      id,
      effective: input.effectiveOf(id),
      capacity: member === undefined ? 0.55 : capacityOf(member),
      continuity: benchIndex.has(id) ? benchIndex.size - (benchIndex.get(id) ?? 0) : -1,
      tie: input.rng.next(),
    };
  });
  scored.sort((a, b) => {
    if (heavyStarter) {
      if (b.capacity !== a.capacity) return b.capacity - a.capacity;
      if (b.effective !== a.effective) return b.effective - a.effective;
    } else if (b.effective !== a.effective) {
      return b.effective - a.effective;
    }
    if (b.continuity !== a.continuity) return b.continuity - a.continuity;
    if (a.tie !== b.tie) return a.tie - b.tie;
    return a.id < b.id ? -1 : 1;
  });
  return scored.map((entry) => entry.id);
}

function tryDnpVariant(input: {
  structure: { starters: string[]; benchOrder: string[]; closingFive: string[] };
  players: ReadonlyMap<
    string,
    {
      playerVersionId: string;
      quality: number;
      staminaRating: number;
      durability: number;
      fatigueBasisPoints: number;
      recentLoadBasisPoints: number;
    }
  >;
  basePlan: ReturnType<typeof buildMinutePlanCandidates>['plans'][number];
  allPlans: ReadonlyArray<ReturnType<typeof buildMinutePlanCandidates>['plans'][number]>;
  qualityByVersion: ReadonlyMap<string, number>;
  effectiveOf: (id: string) => number;
  horizon: number;
  franchiseId: string;
}): {
  rotation: SeasonRotation;
  plan: ReturnType<typeof buildMinutePlanCandidates>['plans'][number];
} | null {
  const closingSet = new Set(input.structure.closingFive);
  const starterSet = new Set(input.structure.starters);
  const dnpCandidates = input.structure.benchOrder.filter(
    (id) => !closingSet.has(id) && !starterSet.has(id),
  );
  if (dnpCandidates.length === 0) return null;
  const ranked = [...dnpCandidates].sort((a, b) => input.effectiveOf(a) - input.effectiveOf(b));
  const dnpId = ranked[0];
  if (dnpId === undefined) return null;
  const baseMinutes = new Map(
    input.basePlan.rotation.targetMinutes.map((row) => [row.playerVersionId, row.minutes]),
  );
  const dnpMinutes = baseMinutes.get(dnpId) ?? 0;
  if (dnpMinutes <= 4) return null;
  const worstEffective = input.effectiveOf(dnpId);
  const remainingBench = input.structure.benchOrder.filter((id) => id !== dnpId);
  const bestRemaining = Math.max(...remainingBench.map((id) => input.effectiveOf(id)));
  if (!(bestRemaining > worstEffective + 0.05)) return null;
  const weights = new Map(
    remainingBench.map((id) => {
      const player = input.players.get(id);
      const quality = input.qualityByVersion.get(id) ?? 0.5;
      const capacity =
        player === undefined
          ? 0.55
          : minuteCapacityOf({
              staminaRating: player.staminaRating,
              durability: player.durability,
              fatigueBasisPoints: player.fatigueBasisPoints,
            });
      return [id, Math.max(0, quality * capacity)] as const;
    }),
  );
  const weightSum = [...weights.values()].reduce((sum, w) => sum + w, 0);
  if (weightSum <= 0) return null;
  const extras = new Map<string, number>();
  let assigned = 0;
  const remainders: Array<{ id: string; frac: number }> = [];
  for (const id of remainingBench) {
    const raw = (dnpMinutes * (weights.get(id) ?? 0)) / weightSum;
    const floor = Math.floor(raw);
    extras.set(id, floor);
    assigned += floor;
    remainders.push({ id, frac: raw - floor });
  }
  remainders.sort((a, b) => (b.frac !== a.frac ? b.frac - a.frac : a.id < b.id ? -1 : 1));
  let leftover = dnpMinutes - assigned;
  for (const entry of remainders) {
    if (leftover <= 0) break;
    extras.set(entry.id, (extras.get(entry.id) ?? 0) + 1);
    leftover -= 1;
  }
  const nextMinutes = input.basePlan.rotation.targetMinutes.map((row) => {
    if (row.playerVersionId === dnpId) return { ...row, minutes: 0 };
    const extra = extras.get(row.playerVersionId) ?? 0;
    return { ...row, minutes: row.minutes + extra };
  });
  if (nextMinutes.some((row) => row.minutes < 0 || row.minutes > 48)) return null;
  if (nextMinutes.reduce((sum, row) => sum + row.minutes, 0) !== 240) return null;
  const quality = planQualityOf(nextMinutes, input.qualityByVersion);
  const relief = benchReliefOf(nextMinutes, input.structure.benchOrder, input.qualityByVersion);
  const playerList = [...input.players.values()];
  const fatigue = projectFatigueAfterBlock(
    playerList,
    new Map(nextMinutes.map((row) => [row.playerVersionId, row.minutes])),
    input.horizon,
  );
  const maxStarterStrain = Math.max(
    0,
    ...input.structure.starters.map((id) => fatigue.get(id)?.fatigueBasisPoints ?? 0),
  );
  const bands: Record<FatigueBand, number> = { fresh: 0, ready: 0, tired: 0, heavy: 0 };
  for (const row of nextMinutes) bands[fatigue.get(row.playerVersionId)?.band ?? 'fresh'] += 1;
  const heavyStrain =
    bands.heavy > 0 ||
    [...fatigue.values()].some((facts) => facts.peakBasisPoints >= MINUTE_PLAN_HEAVY_THRESHOLD_BP);
  if (heavyStrain && !input.basePlan.heavyStrain) return null;
  const qualities = [...input.allPlans.map((plan) => plan.quality), quality];
  const maxQ = Math.max(...qualities);
  const minQ = Math.min(...qualities);
  const relative = maxQ <= minQ ? 0.5 : Math.max(0, Math.min(1, (quality - minQ) / (maxQ - minQ)));
  const riskScore = riskScoreOf({
    quality: relative,
    maxStarterStrainBasisPoints: maxStarterStrain,
    relief,
  });
  if (!(
    quality >= input.basePlan.quality + 0.003 && riskScore >= input.basePlan.riskScore - 0.002
  )) {
    return null;
  }
  const rotation: SeasonRotation = {
    ...input.basePlan.rotation,
    franchiseId: franchiseIdSchema.parse(input.franchiseId),
    targetMinutes: nextMinutes,
  };
  return {
    rotation,
    plan: {
      ...input.basePlan,
      rotation,
      quality,
      relief,
      maxStarterStrainBasisPoints: maxStarterStrain,
      strainBand: fatigueBandOf(maxStarterStrain),
      fatigueBands: bands,
      riskScore,
      heavyStrain,
    },
  };
}

function buildFullRotationForActive(input: {
  active: readonly string[];
  byId: ReadonlyMap<string, AutoRotationMemberInput>;
  effectiveOf: (id: string) => number;
  current: SeasonRotation;
  horizon: number;
  franchiseId: string;
  qualityByVersion: ReadonlyMap<string, number>;
  rng: ReturnType<typeof createRng>;
  sharedPossessions?: ReadonlyMap<string, number> | null;
  forcedStarters?: readonly string[];
  synergyPenaltyOf?: (five: readonly string[]) => number;
  freeThrowByVersion?: ReadonlyMap<string, number>;
  allowDnp?: boolean;
}): {
  rotation: SeasonRotation;
  plan: ReturnType<typeof buildMinutePlanCandidates>['plans'][number];
} | null {
  const activeSorted = [...input.active].sort();
  const synergy = input.synergyPenaltyOf;
  const starters =
    input.forcedStarters !== undefined
      ? [...input.forcedStarters]
      : pickBestFive({
          active: activeSorted,
          byId: input.byId,
          effectiveOf: input.effectiveOf,
          incumbent: input.current.starters,
          rng: input.rng,
          synergyPenaltyOf: synergy,
        });
  if (starters === null) return null;
  const starterSet = new Set(starters);
  const benchCandidates = activeSorted.filter((id) => !starterSet.has(id));
  const benchOrder = orderBench({
    benchCandidates,
    byId: input.byId,
    effectiveOf: input.effectiveOf,
    currentBench: input.current.benchOrder,
    starterIds: starters,
    rng: input.rng,
  });
  const closing = pickBestFive({
    active: activeSorted,
    byId: input.byId,
    effectiveOf: input.effectiveOf,
    incumbent: input.current.closingFive,
    rng: input.rng,
    synergyPenaltyOf: synergy,
    freeThrowByVersion: input.allowDnp === true ? input.freeThrowByVersion : undefined,
    preferClosing: input.allowDnp === true,
  }) ?? [...starters];
  const eligibleList = activeSorted
    .map((id) => input.byId.get(id))
    .filter((member): member is AutoRotationMemberInput => member !== undefined);
  const players = new Map(
    activeSorted.map((id) => {
      const member = input.byId.get(id);
      return [
        id,
        {
          playerVersionId: id,
          quality: input.qualityByVersion.get(id) ?? 0.5,
          staminaRating: member?.staminaRating ?? 70,
          durability: member?.durability ?? 70,
          fatigueBasisPoints: member?.fatigueBasisPoints ?? 0,
          recentLoadBasisPoints: member?.recentLoadBasisPoints ?? 0,
        },
      ] as const;
    }),
  );
  void eligibleList;
  const built = buildMinutePlanCandidates({
    structure: { starters, benchOrder, closingFive: closing },
    players,
    horizon: input.horizon,
  });
  const recommended =
    built.plans.find((plan) => plan.strategy === built.recommended) ?? built.plans[0];
  if (recommended === undefined) return null;
  if (input.allowDnp === true) {
    const dnp = tryDnpVariant({
      structure: { starters, benchOrder, closingFive: closing },
      players,
      basePlan: recommended,
      allPlans: built.plans,
      qualityByVersion: input.qualityByVersion,
      effectiveOf: input.effectiveOf,
      horizon: input.horizon,
      franchiseId: input.franchiseId,
    });
    if (dnp !== null) {
      const memberPlayable = new Map(
        activeSorted.map((id) => [id, input.byId.get(id)?.playable ?? []] as const),
      );
      if (validateSeasonRotation(dnp.rotation, memberPlayable).length === 0) {
        return { rotation: dnp.rotation, plan: { ...dnp.plan, rotation: dnp.rotation } };
      }
    }
  }
  const rotation = withFranchise(recommended.rotation, input.franchiseId);
  const memberPlayable = new Map(
    activeSorted.map((id) => [id, input.byId.get(id)?.playable ?? []] as const),
  );
  if (validateSeasonRotation(rotation, memberPlayable).length > 0) return null;
  return { rotation, plan: { ...recommended, rotation } };
}

function diffMinutes(
  current: SeasonRotation,
  candidate: SeasonRotation,
  effectiveOf: (id: string) => number,
  byId: ReadonlyMap<string, AutoRotationMemberInput>,
  qualityByVersion: ReadonlyMap<string, number>,
): RecommendSeasonRotationChange[] {
  const currentMinutes = new Map(
    current.targetMinutes.map((row) => [row.playerVersionId, row.minutes]),
  );
  const changes: RecommendSeasonRotationChange[] = [];
  for (const row of candidate.targetMinutes) {
    const from = currentMinutes.get(row.playerVersionId);
    if (from === undefined || from === row.minutes) continue;
    const member = byId.get(row.playerVersionId);
    const quality = qualityByVersion.get(row.playerVersionId) ?? 0.5;
    const capacity = member === undefined ? 0 : capacityOf(member);
    const dnpTag = row.minutes === 0 ? ' · DNP-CD (dressed, 0 min)' : '';
    changes.push({
      kind: 'minutes',
      playerVersionId: row.playerVersionId,
      from,
      to: row.minutes,
      reason: `minutes ${String(from)}→${String(row.minutes)} on quality ${fmt2(quality)} × capacity ${fmt2(capacity)} = ${fmt2(effectiveOf(row.playerVersionId))}${dnpTag}`,
    });
  }
  changes.sort((a, b) => {
    const aId = a.kind === 'minutes' ? a.playerVersionId : '';
    const bId = b.kind === 'minutes' ? b.playerVersionId : '';
    return aId < bId ? -1 : 1;
  });
  return changes;
}

function diffRotations(
  current: SeasonRotation,
  candidate: SeasonRotation,
  deps: {
    effectiveOf: (id: string) => number;
    byId: ReadonlyMap<string, AutoRotationMemberInput>;
    qualityByVersion: ReadonlyMap<string, number>;
    sharedPossessions?: ReadonlyMap<string, number> | null;
  },
): RecommendSeasonRotationChange[] {
  const changes: RecommendSeasonRotationChange[] = [];
  const currentActive = new Set([...current.starters, ...current.benchOrder]);
  const candidateActive = new Set([...candidate.starters, ...candidate.benchOrder]);
  const ins = [...candidateActive].filter((id) => !currentActive.has(id)).sort();
  const outs = [...currentActive].filter((id) => !candidateActive.has(id)).sort();
  const pairCount = Math.max(ins.length, outs.length);
  for (let i = 0; i < pairCount; i += 1) {
    const inId = ins[i];
    const outId = outs[i];
    if (inId === undefined || outId === undefined) continue;
    const inMember = deps.byId.get(inId);
    const outMember = deps.byId.get(outId);
    const inEffective = deps.effectiveOf(inId);
    const outEffective = deps.effectiveOf(outId);
    let reason = `swap ${outId}→${inId} on effective ${fmt2(outEffective)}→${fmt2(inEffective)} (quality ${fmt2(deps.qualityByVersion.get(inId) ?? 0.5)} × capacity ${fmt2(inMember === undefined ? 0 : capacityOf(inMember))})`;
    const disruption = describeChemistryDisruption(
      outId,
      candidateActive,
      deps.sharedPossessions ?? null,
    );
    if (disruption !== null) reason += ` · ${disruption}`;
    const outFatigue = outMember === undefined ? null : fatigueBandOf(outMember.fatigueBasisPoints);
    void outFatigue;
    changes.push({ kind: 'swap', inPlayerVersionId: inId, outPlayerVersionId: outId, reason });
  }
  const currentStarterSlot = new Map(current.starters.map((id, index) => [id, index]));
  const currentBenchIndex = new Map(current.benchOrder.map((id, index) => [id, index]));
  const currentClosingSlot = new Map(current.closingFive.map((id, index) => [id, index]));
  candidate.starters.forEach((id, toSlot) => {
    const fromSlot = currentStarterSlot.get(id);
    if (fromSlot === toSlot) return;
    const member = deps.byId.get(id);
    const playable = member?.playable.join('/') ?? '';
    changes.push({
      kind: 'starter',
      playerVersionId: id,
      fromSlot: fromSlot ?? null,
      toSlot,
      reason: `starter slot ${fromSlot === undefined ? 'bench/inactive' : `S${String(fromSlot + 1)}`}→S${String(toSlot + 1)}; legal ${playable} on effective ${fmt2(deps.effectiveOf(id))}`,
    });
  });
  candidate.benchOrder.forEach((id, toBench) => {
    const fromBench = currentBenchIndex.get(id);
    if (fromBench === toBench) return;
    changes.push({
      kind: 'bench',
      playerVersionId: id,
      fromBench: fromBench ?? null,
      toBench,
      reason: `bench ${fromBench === undefined ? 'starter/inactive' : `B${String(fromBench + 1)}`}→B${String(toBench + 1)} on effective ${fmt2(deps.effectiveOf(id))}`,
    });
  });
  candidate.closingFive.forEach((id, toSlot) => {
    const fromSlot = currentClosingSlot.get(id);
    if (fromSlot === toSlot) return;
    changes.push({
      kind: 'closing',
      playerVersionId: id,
      fromSlot: fromSlot ?? null,
      toSlot,
      reason: `closing ${fromSlot === undefined ? 'out' : `C${String(fromSlot + 1)}`}→C${String(toSlot + 1)} on effective ${fmt2(deps.effectiveOf(id))}`,
    });
  });
  const currentMinutes = new Map(
    current.targetMinutes.map((row) => [row.playerVersionId, row.minutes]),
  );
  for (const row of candidate.targetMinutes) {
    const from = currentMinutes.get(row.playerVersionId);
    if (from === undefined) continue;
    if (from === row.minutes) continue;
    const dnpTag = row.minutes === 0 ? ' · DNP-CD (dressed, 0 min)' : '';
    changes.push({
      kind: 'minutes',
      playerVersionId: row.playerVersionId,
      from,
      to: row.minutes,
      reason: `minutes ${String(from)}→${String(row.minutes)} on effective ${fmt2(deps.effectiveOf(row.playerVersionId))}${dnpTag}`,
    });
  }
  const orderOf = (change: RecommendSeasonRotationChange): number => {
    switch (change.kind) {
      case 'swap':
        return 0;
      case 'starter':
        return 1;
      case 'bench':
        return 2;
      case 'closing':
        return 3;
      case 'minutes':
        return 4;
    }
  };
  changes.sort((a, b) => {
    const order = orderOf(a) - orderOf(b);
    if (order !== 0) return order;
    const aId =
      a.kind === 'swap'
        ? a.inPlayerVersionId
        : a.kind === 'minutes'
          ? a.playerVersionId
          : a.playerVersionId;
    const bId =
      b.kind === 'swap'
        ? b.inPlayerVersionId
        : b.kind === 'minutes'
          ? b.playerVersionId
          : b.playerVersionId;
    return aId < bId ? -1 : 1;
  });
  return changes;
}

function describeChemistryDisruption(
  outId: string,
  candidateActive: ReadonlySet<string>,
  shared: ReadonlyMap<string, number> | null,
): string | null {
  if (shared === null || shared.size === 0) return null;
  let best: { mate: string; shared: number } | null = null;
  for (const mate of candidateActive) {
    if (mate === outId) continue;
    const value = pairLookup(shared, outId, mate);
    if (value === null) continue;
    if (best === null || value > best.shared) best = { mate, shared: value };
  }
  if (best === null) return null;
  if (best.shared <= 600) return null;
  return `breaks shared-play pair ${outId}–${best.mate} (${String(best.shared)} possessions)`;
}

function metricsOf(
  plan: {
    quality: number;
    riskScore: number;
    maxStarterStrainBasisPoints: number;
    strainBand: FatigueBand;
    relief: number;
  },
  rotation: SeasonRotation,
  players: readonly SimulationPlayer[] | null,
  eraProfile: EraSimulationProfile | null,
  model: ProjectionModelArtifact | null,
): RecommendSeasonRotationMetrics {
  let projectedNetRating: number | null = null;
  if (players !== null && eraProfile !== null && model !== null) {
    try {
      const roster = players.map((player) => ({ player }));
      const probe = projectSeasonRoster(
        {
          roster,
          rotation,
          eraProfile,
          model,
        },
        {},
      );
      const net = probe.metrics.netRating;
      projectedNetRating = Number.isFinite(net) ? Math.round(net * 10) / 10 : null;
    } catch {
      projectedNetRating = null;
    }
  }
  return {
    quality: Math.round(plan.quality * 1000) / 1000,
    riskScore: Math.round(plan.riskScore * 1000) / 1000,
    maxStarterStrainBp: Math.round(plan.maxStarterStrainBasisPoints),
    strainBand: plan.strainBand,
    relief: Math.round(plan.relief * 100) / 100,
    projectedNetRating,
  };
}
