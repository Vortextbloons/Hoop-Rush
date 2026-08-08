import {
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_ROTATION_PRESET_TARGETS,
  SEASON_ROTATION_VERSION,
  type SeasonMinutePolicyStrategy,
  type SeasonRotation,
} from '@hoop-rush/data-contracts';
import { onCourtFatigueBp, recentLoadAfterGame } from './stamina.ts';

/**
 * Projection milestone minute-policy optimizer (minute-policy-v1,
 * season-rotation-v3). Produces integer per-player regulation target
 * minutes from player projection, stamina, durability, and current fatigue
 * under three strategy envelopes — Starter-Heavy (contract preset `tight`),
 * Balanced, Bench-Heavy — while preserving roster ownership, player
 * uniqueness, legal positions, starters, bench order, the closing five, and
 * the 240-minute total. Plans are selected with a risk-adjusted score
 * weighted toward projected quality, then starter strain, then bench
 * relief; Starter-Heavy is avoided when it projects an unacceptable Heavy
 * fatigue result unless every valid plan does.
 *
 * Fatigue facts use the recorded stamina model (season-stamina-v2):
 * per-game accumulation from on-court minutes through the engine's
 * on-court accumulation formula (consecutive-stint ramp at the full-game
 * stint), the between-game recovery tick, and the recent-load update,
 * starting from the current recorded fatigue. Halftime and trip-level role
 * bonuses are excluded exactly as in the shipped pre-game lock-preview
 * projection: the recorded block-end measurements for a 10-game block land
 * in the 1,500-3,500 basis-point range for heavy-minute starters. The
 * Heavy gate evaluates the within-block peak, because the recovery model
 * drives end-of-block fatigue toward a minutes-insensitive equilibrium.
 *
 * Pure TypeScript: no Svelte, persistence, worker, or network code.
 */

export type FatigueBand = 'fresh' | 'ready' | 'tired' | 'heavy';

/** Fatigue band thresholds (basis points), the engine-authoritative bands. */
export const FATIGUE_BAND_FRESH_MAX = 1500;
export const FATIGUE_BAND_READY_MAX = 3500;
export const FATIGUE_BAND_TIRED_MAX = 6000;

/** Fatigue band of a basis-point fatigue value (0..10,000). */
export function fatigueBandOf(fatigueBasisPoints: number): FatigueBand {
  if (fatigueBasisPoints < FATIGUE_BAND_FRESH_MAX) return 'fresh';
  if (fatigueBasisPoints < FATIGUE_BAND_READY_MAX) return 'ready';
  if (fatigueBasisPoints < FATIGUE_BAND_TIRED_MAX) return 'tired';
  return 'heavy';
}

/**
 * The Heavy band's lower bound (basis points): the "unacceptable Heavy
 * fatigue result" the gate protects against.
 */
export const MINUTE_PLAN_HEAVY_THRESHOLD_BP = FATIGUE_BAND_TIRED_MAX;

/** Per-player load inputs for minute planning. */
export interface MinutePlanPlayerInput {
  playerVersionId: string;
  /** Player quality weight in 0..1 (projection- or ratings-derived). */
  quality: number;
  /** 45..95 stamina rating (season-stamina-v1). */
  staminaRating: number;
  /** 45..95 durability rating (durability-v1). */
  durability: number;
  /** 0..10,000 current fatigue basis points. */
  fatigueBasisPoints: number;
  /** 0..10,000 current recent-load basis points. */
  recentLoadBasisPoints: number;
}

/** The rotation structure a plan must preserve exactly. */
export interface MinutePlanStructure {
  /** Five starters in slot order (G, G, F, F, C). */
  starters: readonly string[];
  /** Remaining five in deterministic bench order. */
  benchOrder: readonly string[];
  /** Ordered closing five (independently legal). */
  closingFive: readonly string[];
}

/** Upcoming-block horizon: 10 games, or the remaining games for the final block. */
export function minutePlanHorizonGames(remainingGamesInSeason: number): number {
  return Math.min(10, Math.max(1, remainingGamesInSeason));
}

/** Strategy envelopes derived from the frozen preset tables (240-minute totals). */
const ENVELOPE_STARTER_TOTAL: Record<SeasonMinutePolicyStrategy, number> = {
  'starter-heavy': 5 * SEASON_ROTATION_PRESET_TARGETS.tight.starters,
  balanced: 5 * SEASON_ROTATION_PRESET_TARGETS.balanced.starters,
  'bench-heavy': 5 * SEASON_ROTATION_PRESET_TARGETS['bench-heavy'].starters,
};

/** The preset value that corresponds to each strategy (`tight` stays the contract value). */
export const STRATEGY_TO_PRESET: Record<
  SeasonMinutePolicyStrategy,
  keyof typeof SEASON_ROTATION_PRESET_TARGETS
> = {
  'starter-heavy': 'tight',
  balanced: 'balanced',
  'bench-heavy': 'bench-heavy',
};

/** Minute-policy strategy for a preset command value. */
export function minuteStrategyOfPreset(
  preset: keyof typeof SEASON_ROTATION_PRESET_TARGETS,
): SeasonMinutePolicyStrategy {
  switch (preset) {
    case 'tight':
      return 'starter-heavy';
    case 'balanced':
      return 'balanced';
    case 'bench-heavy':
      return 'bench-heavy';
  }
}

/** Capacity multipliers: fatigue, stamina, and durability drains on minutes. */
export const MINUTE_PLAN_FATIGUE_DRAIN = 0.5;
export const MINUTE_PLAN_STAMINA_DRAIN = 0.4;
export const MINUTE_PLAN_DURABILITY_DRAIN = 0.2;
export const MINUTE_PLAN_CAPACITY_FLOOR = 0.55;

/** Risk-adjusted score weights: quality, then strain, then relief. */
export const MINUTE_PLAN_SCORE_QUALITY_WEIGHT = 0.5;
export const MINUTE_PLAN_SCORE_STRAIN_WEIGHT = 0.3;
export const MINUTE_PLAN_SCORE_RELIEF_WEIGHT = 0.2;

/** Capacity multiplier in 0.55..1 from fatigue, stamina, and durability. */
export function minuteCapacityOf(input: {
  staminaRating: number;
  durability: number;
  fatigueBasisPoints: number;
}): number {
  const fatigueDrain = MINUTE_PLAN_FATIGUE_DRAIN * (input.fatigueBasisPoints / 10_000);
  const staminaDrain =
    MINUTE_PLAN_STAMINA_DRAIN * Math.max(0, Math.min(1, (95 - input.staminaRating) / 50));
  const durabilityDrain =
    MINUTE_PLAN_DURABILITY_DRAIN * Math.max(0, Math.min(1, (95 - input.durability) / 50));
  return Math.max(
    MINUTE_PLAN_CAPACITY_FLOOR,
    Math.min(1, 1 - fatigueDrain - staminaDrain - durabilityDrain),
  );
}

/**
 * Per-game projected fatigue forward over a block (see module doc). Returns
 * the end-of-block fatigue, the within-block peak (the Heavy gate input),
 * and the end band for every player.
 */
export function projectFatigueAfterBlock(
  players: readonly MinutePlanPlayerInput[],
  minutesByVersion: ReadonlyMap<string, number>,
  horizon: number,
): Map<string, { fatigueBasisPoints: number; peakBasisPoints: number; band: FatigueBand }> {
  const state = new Map(
    players.map((player) => [
      player.playerVersionId,
      {
        fatigueBasisPoints: Math.max(0, Math.min(10_000, player.fatigueBasisPoints)),
        recentLoadBasisPoints: Math.max(0, Math.min(10_000, player.recentLoadBasisPoints)),
        peakBasisPoints: Math.max(0, Math.min(10_000, player.fatigueBasisPoints)),
      },
    ]),
  );
  for (let game = 0; game < horizon; game += 1) {
    for (const player of players) {
      const current = state.get(player.playerVersionId);
      if (current === undefined) continue;
      const seconds = (minutesByVersion.get(player.playerVersionId) ?? 0) * 60;
      if (seconds > 0) {
        const accumulated = onCourtFatigueBp(
          seconds,
          player.staminaRating,
          seconds,
          current.recentLoadBasisPoints,
        );
        current.fatigueBasisPoints = Math.min(10_000, current.fatigueBasisPoints + accumulated);
        current.peakBasisPoints = Math.max(current.peakBasisPoints, current.fatigueBasisPoints);
        current.recentLoadBasisPoints = recentLoadAfterGame(current.recentLoadBasisPoints, seconds);
      }
    }
    if (game < horizon - 1) {
      for (const player of players) {
        const current = state.get(player.playerVersionId);
        if (current === undefined) continue;
        const factor = 4500 - 20 * player.staminaRating;
        current.fatigueBasisPoints = Math.max(
          0,
          Math.min(10_000, Math.round((current.fatigueBasisPoints * factor) / 10_000)),
        );
      }
    }
  }
  return new Map(
    players.map((player) => {
      const current = state.get(player.playerVersionId);
      const fatigueBasisPoints = current?.fatigueBasisPoints ?? 0;
      return [
        player.playerVersionId,
        {
          fatigueBasisPoints,
          peakBasisPoints: current?.peakBasisPoints ?? fatigueBasisPoints,
          band: fatigueBandOf(fatigueBasisPoints),
        },
      ];
    }),
  );
}

/** Allocates `total` integer minutes across weighted entries, clamped to 48. */
function allocateGroup(
  entries: readonly { playerVersionId: string; weight: number }[],
  total: number,
): Map<string, number> {
  const byVersion = new Map(entries.map((entry) => [entry.playerVersionId, entry]));
  const remaining = new Set(entries.map((entry) => entry.playerVersionId));
  const result = new Map<string, number>();
  for (const entry of entries) result.set(entry.playerVersionId, 0);
  let pool = total;
  while (pool > 0 && remaining.size > 0) {
    const active = [...remaining]
      .map((id) => byVersion.get(id))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
    const weightSum = active.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
    if (weightSum <= 0) {
      const fallback = Math.floor(pool / active.length);
      for (const entry of active) {
        const take = Math.min(48 - (result.get(entry.playerVersionId) ?? 0), fallback);
        result.set(entry.playerVersionId, (result.get(entry.playerVersionId) ?? 0) + take);
        pool -= take;
        if ((result.get(entry.playerVersionId) ?? 0) >= 48) remaining.delete(entry.playerVersionId);
      }
      if (pool > 0) {
        for (const entry of [...active].sort((a, b) =>
          a.playerVersionId < b.playerVersionId ? -1 : 1,
        )) {
          if (pool <= 0) break;
          if ((result.get(entry.playerVersionId) ?? 0) < 48) {
            result.set(entry.playerVersionId, (result.get(entry.playerVersionId) ?? 0) + 1);
            pool -= 1;
          }
        }
      }
      break;
    }
    let assigned = 0;
    const withRemainder: Array<{ id: string; frac: number }> = [];
    for (const entry of active) {
      const raw = (pool * Math.max(0, entry.weight)) / weightSum;
      const floor = Math.floor(raw);
      const base = Math.min(48, floor);
      result.set(entry.playerVersionId, (result.get(entry.playerVersionId) ?? 0) + base);
      assigned += base;
      withRemainder.push({ id: entry.playerVersionId, frac: raw - floor });
    }
    const leftover = pool - assigned;
    const ordered = withRemainder
      .sort((a, b) => (b.frac - a.frac !== 0 ? b.frac - a.frac : a.id < b.id ? -1 : 1))
      .filter((entry) => (result.get(entry.id) ?? 0) < 48);
    for (let i = 0; i < leftover && i < ordered.length; i += 1) {
      const entry = ordered[i];
      if (entry === undefined) continue;
      result.set(entry.id, (result.get(entry.id) ?? 0) + 1);
    }
    for (const id of remaining) {
      if ((result.get(id) ?? 0) >= 48) remaining.delete(id);
    }
    pool = total - [...result.values()].reduce((sum, value) => sum + value, 0);
    if (
      remaining.size > 0 &&
      pool > 0 &&
      [...remaining].every((id) => (result.get(id) ?? 0) >= 48)
    ) {
      break;
    }
  }
  return result;
}

/** Quality carried by a plan: Σ minutes × quality / 240. */
export function planQualityOf(
  targetMinutes: readonly { playerVersionId: string; minutes: number }[],
  qualityByVersion: ReadonlyMap<string, number>,
): number {
  const total = targetMinutes.reduce((sum, row) => sum + row.minutes, 0);
  return (
    targetMinutes.reduce(
      (sum, row) => sum + row.minutes * (qualityByVersion.get(row.playerVersionId) ?? 0),
      0,
    ) / Math.max(1, total)
  );
}

/** Bench relief: share of the plan's quality carried by the bench (0..1). */
export function benchReliefOf(
  targetMinutes: readonly { playerVersionId: string; minutes: number }[],
  benchOrder: readonly string[],
  qualityByVersion: ReadonlyMap<string, number>,
): number {
  const bench = new Set(benchOrder);
  const total = targetMinutes.reduce(
    (sum, row) => sum + row.minutes * (qualityByVersion.get(row.playerVersionId) ?? 0),
    0,
  );
  const carried = targetMinutes.reduce(
    (sum, row) =>
      bench.has(row.playerVersionId)
        ? sum + row.minutes * (qualityByVersion.get(row.playerVersionId) ?? 0)
        : sum,
    0,
  );
  return Math.max(0, Math.min(1, total <= 0 ? 0 : carried / total));
}

/** Risk-adjusted score in 0..1: quality, then strain, then relief. */
export function riskScoreOf(input: {
  quality: number;
  maxStarterStrainBasisPoints: number;
  relief: number;
}): number {
  return (
    MINUTE_PLAN_SCORE_QUALITY_WEIGHT * input.quality +
    MINUTE_PLAN_SCORE_STRAIN_WEIGHT * (1 - input.maxStarterStrainBasisPoints / 10_000) +
    MINUTE_PLAN_SCORE_RELIEF_WEIGHT * input.relief
  );
}

/** One evaluated minute plan with its compact facts. */
export interface MinutePlanCandidate {
  strategy: SeasonMinutePolicyStrategy;
  /** The full legal rotation (structure preserved, minutes + policy applied). */
  rotation: SeasonRotation;
  /** Minute-weighted projected quality (0..1; projection- or ratings-derived). */
  quality: number;
  /** Worst-case starter fatigue after the block (basis points). */
  maxStarterStrainBasisPoints: number;
  /** Band of the worst starter strain. */
  strainBand: FatigueBand;
  /** Bench relief share (0..1). */
  relief: number;
  /** Fatigue band counts over the ten rostered players after the block. */
  fatigueBands: Record<FatigueBand, number>;
  /** Risk-adjusted score (0..1). */
  riskScore: number;
  /** True when any rostered player projects to the Heavy band. */
  heavyStrain: boolean;
}

/** Builds the rotation for a strategy with the allocated minutes. */
function rotationOf(
  structure: MinutePlanStructure,
  targetMinutes: { playerVersionId: string; minutes: number }[],
  strategy: SeasonMinutePolicyStrategy,
  franchiseId = 'roster',
): SeasonRotation {
  return {
    franchiseId,
    starters: [...structure.starters],
    benchOrder: [...structure.benchOrder],
    targetMinutes,
    closingFive: [...structure.closingFive],
    minutePolicy: { policyVersion: SEASON_MINUTE_POLICY_VERSION, strategy },
    rotationVersion: SEASON_ROTATION_VERSION,
  };
}

/** Builds and evaluates one envelope plan for the structure. */
function buildPlan(input: {
  structure: MinutePlanStructure;
  players: ReadonlyMap<string, MinutePlanPlayerInput>;
  strategy: SeasonMinutePolicyStrategy;
  horizon: number;
}): MinutePlanCandidate {
  const { structure, players, strategy, horizon } = input;
  const starterTotal = ENVELOPE_STARTER_TOTAL[strategy];
  const starterIds = structure.starters;
  const benchIds = structure.benchOrder;
  const weightOf = (id: string) => {
    const player = players.get(id);
    if (player === undefined) return 0;
    return player.quality * minuteCapacityOf(player);
  };
  const starterMinutes = allocateGroup(
    starterIds.map((id) => ({ playerVersionId: id, weight: weightOf(id) })),
    starterTotal,
  );
  const benchMinutes = allocateGroup(
    benchIds.map((id) => ({ playerVersionId: id, weight: weightOf(id) })),
    240 - starterTotal,
  );
  const targetMinutes = [
    ...starterIds.map((id) => ({ playerVersionId: id, minutes: starterMinutes.get(id) ?? 0 })),
    ...benchIds.map((id) => ({ playerVersionId: id, minutes: benchMinutes.get(id) ?? 0 })),
  ];
  const rotation = rotationOf(structure, targetMinutes, strategy);
  const qualityByVersion = new Map(
    [...players.values()].map((player) => [player.playerVersionId, player.quality]),
  );
  const quality = planQualityOf(targetMinutes, qualityByVersion);
  const relief = benchReliefOf(targetMinutes, structure.benchOrder, qualityByVersion);
  const fatigue = projectFatigueAfterBlock(
    [...players.values()],
    new Map(targetMinutes.map((row) => [row.playerVersionId, row.minutes])),
    horizon,
  );
  const maxStarterStrainBasisPoints = Math.max(
    0,
    ...starterIds.map((id) => fatigue.get(id)?.fatigueBasisPoints ?? 0),
  );
  const bands: Record<FatigueBand, number> = { fresh: 0, ready: 0, tired: 0, heavy: 0 };
  for (const row of targetMinutes) {
    bands[fatigue.get(row.playerVersionId)?.band ?? 'fresh'] += 1;
  }
  const heavyStrain =
    bands.heavy > 0 ||
    [...fatigue.values()].some((facts) => facts.peakBasisPoints >= MINUTE_PLAN_HEAVY_THRESHOLD_BP);
  return {
    strategy,
    rotation,
    quality,
    maxStarterStrainBasisPoints,
    strainBand: fatigueBandOf(maxStarterStrainBasisPoints),
    relief,
    fatigueBands: bands,
    riskScore: 0,
    heavyStrain,
  };
}

/** The three strategy envelopes in canonical order. */
export const MINUTE_POLICY_STRATEGIES: readonly SeasonMinutePolicyStrategy[] = [
  'starter-heavy',
  'balanced',
  'bench-heavy',
];

export interface MinutePlanCandidates {
  plans: MinutePlanCandidate[];
  /** The selected strategy (best risk-adjusted score with the Heavy gate). */
  recommended: SeasonMinutePolicyStrategy;
}

function relativeQuality(plans: MinutePlanCandidate[]): Map<SeasonMinutePolicyStrategy, number> {
  const values = plans.map((plan) => plan.quality);
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max <= min) return new Map(plans.map((plan) => [plan.strategy, 0.5]));
  return new Map(
    plans.map((plan) => [
      plan.strategy,
      Math.max(0, Math.min(1, (plan.quality - min) / (max - min))),
    ]),
  );
}

/** Builds and scores all three envelope plans for one structure. */
export function buildMinutePlanCandidates(
  input: {
    structure: MinutePlanStructure;
    players: ReadonlyMap<string, MinutePlanPlayerInput>;
    horizon: number;
  },
  options: {
    /**
     * Quality override per strategy (e.g. authoritative projected net
     * ratings). Relative normalization and the risk score use these instead
     * of the minute-weighted quality when provided.
     */
    quality?: ReadonlyMap<SeasonMinutePolicyStrategy, number>;
  } = {},
): MinutePlanCandidates {
  const raw = MINUTE_POLICY_STRATEGIES.map((strategy) => buildPlan({ ...input, strategy }));
  const quality = relativeQuality(
    raw.map((plan) => ({
      ...plan,
      quality: options.quality?.get(plan.strategy) ?? plan.quality,
    })),
  );
  const plans = raw.map((plan) => ({
    ...plan,
    riskScore: riskScoreOf({
      quality: quality.get(plan.strategy) ?? 0.5,
      maxStarterStrainBasisPoints: plan.maxStarterStrainBasisPoints,
      relief: plan.relief,
    }),
  }));
  const strategyOrder = (strategy: SeasonMinutePolicyStrategy) =>
    MINUTE_POLICY_STRATEGIES.indexOf(strategy);
  const acceptable = plans.filter((plan) => !plan.heavyStrain);
  const pool = acceptable.length > 0 ? acceptable : plans;
  const recommended = [...pool].sort((a, b) => {
    const byScore = b.riskScore - a.riskScore;
    if (byScore !== 0) return byScore;
    const byStrain = a.maxStarterStrainBasisPoints - b.maxStarterStrainBasisPoints;
    if (byStrain !== 0) return byStrain;
    return strategyOrder(a.strategy) - strategyOrder(b.strategy);
  })[0];
  if (recommended === undefined) {
    throw new Error('minute plan: no envelope plan produced');
  }
  return { plans, recommended: recommended.strategy };
}
