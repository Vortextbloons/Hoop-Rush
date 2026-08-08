import type {
  BaseFiveProjectionInput,
  Position,
  ProjectionModelArtifact,
  SeasonProjection,
  SeasonProjectionInput,
  SeasonProjectionMetrics,
  SeasonProjectionPlanFacts,
  SeasonProjectionUnit,
  SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { SEASON_MINUTE_POLICY_VERSION, seasonDigestHex } from '@hoop-rush/data-contracts';
import { applySeasonRotationPreset, validateSeasonRotation } from '../season/rotation.ts';
import { chooseInitialUnit, type PlannerMember } from '../season/rotation-planner.ts';
import {
  benchReliefOf,
  fatigueBandOf,
  MINUTE_PLAN_HEAVY_THRESHOLD_BP,
  projectFatigueAfterBlock,
  riskScoreOf,
  type FatigueBand,
  type MinutePlanPlayerInput,
} from '../season/minute-plan.ts';
import { ProjectionCache } from './cache.ts';
import { projectBaseFive } from './base.ts';
import { projectedQualityWeights } from './minute-plan-quality.ts';
import { archetypeReferences } from './reference-lineups.ts';
import {
  traceContext,
  traceRotationClose,
  traceRotationNormal,
  type RotationTraceResult,
} from './rotation-trace.ts';
import { identifyWeaknesses } from './weaknesses.ts';

/**
 * Season projection (projection milestone): composes the base projector over
 * a ten-player roster, a legal rotation, representative units, target
 * minutes, contingency scenarios, and matchup archetypes. Every unique legal
 * five is projected through the base projector (cached by canonical key);
 * Season code never recreates lineup-performance formulas.
 */

const SLOT_ORDER = ['G1', 'G2', 'F1', 'F2', 'C'] as const;

export interface SeasonProjectionOptions {
  cache?: ProjectionCache;
}

/** One collected unit before projection. */
interface UnitDraft {
  unitId: string;
  kind: SeasonProjectionUnit['kind'];
  players: readonly string[];
  weight: number;
  base: ReturnType<typeof projectBaseFive>;
}

function unitKeyOf(players: readonly string[]): string {
  return [...players].sort().join(',');
}

/** Maps a planner five (ordered legal G,G,F,F,C) to the base projection input. */
export function projectUnit(input: {
  players: readonly string[];
  byVersion: ReadonlyMap<string, SimulationPlayer>;
  profile: SeasonProjectionInput['eraProfile'];
  model: ProjectionModelArtifact;
  referenceId?: string;
  cache: ProjectionCache;
}): ReturnType<typeof projectBaseFive> {
  const { players, byVersion, profile, model, referenceId, cache } = input;
  const key = ProjectionCache.key({
    eraId: profile.eraId,
    modelVersion: model.modelVersion,
    referenceId: referenceId ?? model.references[profile.eraId]?.neutral.referenceId ?? 'neutral',
    slots: SLOT_ORDER,
    playerIds: players.map((id) => byVersion.get(id)?.playerId ?? id),
    playerVersionIds: players,
  });
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const lineup: BaseFiveProjectionInputTuple = [
    { player: byVersion.get(players[0] ?? '') ?? missingPlayer(players[0] ?? ''), slot: 'G1' },
    { player: byVersion.get(players[1] ?? '') ?? missingPlayer(players[1] ?? ''), slot: 'G2' },
    { player: byVersion.get(players[2] ?? '') ?? missingPlayer(players[2] ?? ''), slot: 'F1' },
    { player: byVersion.get(players[3] ?? '') ?? missingPlayer(players[3] ?? ''), slot: 'F2' },
    { player: byVersion.get(players[4] ?? '') ?? missingPlayer(players[4] ?? ''), slot: 'C' },
  ];
  const projection = projectBaseFive({
    lineup,
    eraProfile: profile,
    model,
    ...(referenceId !== undefined ? { referenceId } : {}),
  });
  cache.set(key, projection);
  return projection;
}

function missingPlayer(versionId: string): SimulationPlayer {
  throw new Error(`projection: roster missing playerVersionId ${versionId}`);
}

type BaseFiveProjectionInputTuple = BaseFiveProjectionInput['lineup'];

/** Blends the normal and close traces by the artifact's close-scenario weight.
 * The blended unit keeps the normal trace's slot-ordered five. */
function blendedTrace(
  normal: RotationTraceResult,
  close: RotationTraceResult,
  closeWeight: number,
): Map<string, { minutes: number; players: readonly string[] }> {
  const blended = new Map<string, { minutes: number; players: readonly string[] }>();
  const accumulate = (trace: RotationTraceResult, weight: number) => {
    for (const unit of trace.units) {
      const key = unitKeyOf(unit.players);
      const entry = blended.get(key);
      if (entry === undefined) {
        blended.set(key, { minutes: unit.minutes * weight, players: unit.players });
      } else {
        entry.minutes += unit.minutes * weight;
      }
    }
  };
  accumulate(normal, 1 - closeWeight);
  accumulate(close, closeWeight);
  return blended;
}

/**
 * Minute-policy plan facts (minute-policy-v1) for one projection: the
 * rotation's own target minutes projected forward over the upcoming-block
 * horizon against the supplied per-player load. The risk-adjusted score uses
 * the neutral quality 0.5 because these facts describe a SINGLE rotation,
 * not three competing plans — relative quality normalization needs a plan
 * set, and the three-card comparisons in the optimizer flow
 * (optimizeSeasonRotation) override per-plan scores with projected net
 * ratings.
 */
function planFactsOf(input: {
  rotation: SeasonProjectionInput['rotation'];
  allVersions: readonly string[];
  players: readonly SimulationPlayer[];
  byVersion: ReadonlyMap<string, SimulationPlayer>;
  minutePlan: NonNullable<SeasonProjectionInput['minutePlan']>;
  profile: SeasonProjectionInput['eraProfile'];
  model: ProjectionModelArtifact;
  cache: ProjectionCache;
  metrics: SeasonProjectionMetrics;
}): SeasonProjectionPlanFacts {
  const { rotation, allVersions, players, byVersion, minutePlan, profile, model, cache, metrics } =
    input;
  const loadByVersion = new Map(minutePlan.players.map((row) => [row.playerVersionId, row]));
  const qualityByVersion = projectedQualityWeights({
    players,
    byVersion,
    rotation,
    eraProfile: profile,
    model,
    cache,
  });
  const minutePlanPlayers: MinutePlanPlayerInput[] = allVersions.map((versionId) => {
    const load = loadByVersion.get(versionId);
    return {
      playerVersionId: versionId,
      quality: qualityByVersion.get(versionId) ?? 0.5,
      staminaRating: load?.staminaRating ?? 70,
      durability: load?.durability ?? 70,
      fatigueBasisPoints: load?.fatigueBasisPoints ?? 0,
      recentLoadBasisPoints: load?.recentLoadBasisPoints ?? 0,
    };
  });
  const minutesByVersion = new Map(
    rotation.targetMinutes.map((row) => [row.playerVersionId, row.minutes]),
  );
  const fatigue = projectFatigueAfterBlock(
    minutePlanPlayers,
    minutesByVersion,
    minutePlan.horizonGames,
  );
  const maxStarterStrainBasisPoints = Math.max(
    0,
    ...rotation.starters.map((versionId) => fatigue.get(versionId)?.fatigueBasisPoints ?? 0),
  );
  const fatigueBands: Record<FatigueBand, number> = { fresh: 0, ready: 0, tired: 0, heavy: 0 };
  for (const versionId of allVersions) {
    fatigueBands[fatigue.get(versionId)?.band ?? 'fresh'] += 1;
  }
  const relief = benchReliefOf(rotation.targetMinutes, rotation.benchOrder, qualityByVersion);
  const heavyStrain =
    fatigueBands.heavy > 0 ||
    [...fatigue.values()].some((facts) => facts.peakBasisPoints >= MINUTE_PLAN_HEAVY_THRESHOLD_BP);
  return {
    policyVersion: SEASON_MINUTE_POLICY_VERSION,
    strategy: rotation.minutePolicy.strategy,
    projectedNetRating: metrics.netRating,
    unitQuality: {
      starting: metrics.startingQuality,
      closing: metrics.closingQuality,
      bench: metrics.benchQuality,
    },
    starterStrainAfterBlock: maxStarterStrainBasisPoints,
    starterStrainBand: fatigueBandOf(maxStarterStrainBasisPoints),
    benchRelief: relief,
    fatigueBands,
    riskAdjustedScore: riskScoreOf({
      quality: 0.5,
      maxStarterStrainBasisPoints,
      relief,
    }),
    horizonGames: minutePlan.horizonGames,
    heavyStrain,
  };
}

/**
 * Projects one ten-player roster with a legal rotation. Pure, seedless,
 * deterministic.
 */
export function projectSeasonRoster(
  input: SeasonProjectionInput,
  options: SeasonProjectionOptions = {},
): SeasonProjection {
  const cache = options.cache ?? new ProjectionCache();
  const roster = input.roster;
  if (roster.length !== 10) {
    throw new Error(
      `projection: Season roster must have exactly 10 players (got ${String(roster.length)})`,
    );
  }
  const players = roster.map((entry) => entry.player);
  const byVersion = new Map<string, SimulationPlayer>();
  for (const player of players) {
    const version = player.playerVersionId;
    if (version === undefined) {
      throw new Error(`projection: Season roster players must carry playerVersionId`);
    }
    byVersion.set(version, player);
  }
  const members: PlannerMember[] = players.map((player) => ({
    playerVersionId: player.playerVersionId ?? player.playerId,
    playable: player.positions,
  }));
  const memberPlayable = new Map<string, readonly Position[]>(
    members.map((member) => [member.playerVersionId, member.playable]),
  );
  const rotationErrors = validateSeasonRotation(input.rotation, memberPlayable);
  if (rotationErrors.length > 0) {
    throw new Error(`projection: invalid rotation: ${rotationErrors.join(', ')}`);
  }

  const context = traceContext({
    rotation: input.rotation,
    members: memberPlayable,
  });
  const normal = traceRotationNormal(context);
  const close = traceRotationClose(context);
  const closeWeight = input.model.search.closeScenarioWeight;
  const blended = blendedTrace(normal, close, closeWeight);
  const totalMinutes = Math.max(
    1,
    [...blended.values()].reduce((sum, entry) => sum + entry.minutes, 0),
  );

  // --- Collect units ---
  const draft: UnitDraft[] = [];
  const startersKey = unitKeyOf(input.rotation.starters);
  const closingKey = unitKeyOf(input.rotation.closingFive);

  for (const [key, entry] of blended) {
    const five = entry.players;
    const kind = key === startersKey ? 'starting' : key === closingKey ? 'closing' : 'trace';
    draft.push({
      unitId:
        kind === 'starting'
          ? 'starters'
          : kind === 'closing'
            ? 'closing'
            : `trace-${key.slice(0, 16)}`,
      kind,
      players: five,
      weight: entry.minutes / totalMinutes,
      base: projectUnit({
        players: five,
        byVersion,
        profile: input.eraProfile,
        model: input.model,
        cache,
      }),
    });
  }

  // Bench-heavy as a separate valid scenario (never silently substituted).
  const benchHeavyRotation = applySeasonRotationPreset(input.rotation, 'bench-heavy');
  const benchHeavyContext = traceContext({
    rotation: benchHeavyRotation,
    members: memberPlayable,
  });
  const benchHeavyTrace = traceRotationNormal(benchHeavyContext);
  const benchHeavyKey = unitKeyOf(input.rotation.starters);
  const benchHeavyStarters = benchHeavyTrace.units.find(
    (unit) => unitKeyOf(unit.players) === benchHeavyKey,
  );
  if (benchHeavyStarters !== undefined) {
    draft.push({
      unitId: 'bench-heavy',
      kind: 'bench-heavy',
      players: benchHeavyStarters.players,
      weight: 0,
      base: projectUnit({
        players: benchHeavyStarters.players,
        byVersion,
        profile: input.eraProfile,
        model: input.model,
        cache,
      }),
    });
  } else if (benchHeavyTrace.units[0] !== undefined) {
    draft.push({
      unitId: 'bench-heavy',
      kind: 'bench-heavy',
      players: benchHeavyTrace.units[0].players,
      weight: 0,
      base: projectUnit({
        players: benchHeavyTrace.units[0].players,
        byVersion,
        profile: input.eraProfile,
        model: input.model,
        cache,
      }),
    });
  }

  // Contingency units: every single-player removal plus capped pair removals.
  const allVersions = members.map((member) => member.playerVersionId);
  for (const removed of allVersions) {
    const unavailable = new Set<string>([removed]);
    const five = chooseInitialUnit(context, unavailable);
    if (five !== null) {
      draft.push({
        unitId: `contingency-${removed}`,
        kind: 'contingency',
        players: five,
        weight: 0,
        base: projectUnit({
          players: five,
          byVersion,
          profile: input.eraProfile,
          model: input.model,
          cache,
        }),
      });
    }
  }
  const pairRemovals = Math.min(input.model.search.pairRemovals, allVersions.length);
  for (let pair = 0; pair < pairRemovals; pair += 1) {
    const first = allVersions[pair] ?? '';
    const second = allVersions[(pair + 1) % allVersions.length] ?? '';
    const unavailable = new Set<string>([first, second]);
    const five = chooseInitialUnit(context, unavailable);
    if (five !== null) {
      draft.push({
        unitId: `contingency-pair-${String(pair)}`,
        kind: 'contingency',
        players: five,
        weight: 0,
        base: projectUnit({
          players: five,
          byVersion,
          profile: input.eraProfile,
          model: input.model,
          cache,
        }),
      });
    }
  }

  // Matchup robustness: the starting five against every archetype reference.
  const startersDraft = draft.find((unit) => unit.unitId === 'starters');
  for (const reference of archetypeReferences(input.model, input.eraProfile.eraId)) {
    const five = startersDraft?.players ?? input.rotation.starters;
    draft.push({
      unitId: `matchup-${reference.archetype}`,
      kind: 'matchup',
      players: five,
      weight: 0,
      base: projectUnit({
        players: five,
        byVersion,
        profile: input.eraProfile,
        model: input.model,
        referenceId: reference.referenceId,
        cache,
      }),
    });
  }

  const units: SeasonProjectionUnit[] = draft.map((unit) => ({
    unitId: unit.unitId,
    kind: unit.kind,
    players: [...unit.players],
    weight: unit.weight,
    base: unit.base,
  }));

  // --- Minute rows ---
  const minutes = allVersions.map((versionId) => {
    const target =
      input.rotation.targetMinutes.find((row) => row.playerVersionId === versionId)?.minutes ?? 0;
    const traceMinutes = normal.actualMinutes.get(versionId) ?? 0;
    return {
      playerVersionId: versionId,
      targetMinutes: target,
      traceMinutes,
      deviation: Math.abs(target - traceMinutes),
    };
  });

  // --- Metrics ---
  const weighted = units.filter((unit) => unit.weight > 0);
  const weightedNet = (unit: SeasonProjectionUnit) => unit.base.ratings.netRating;
  const weightedRating = (picker: (unit: SeasonProjectionUnit) => number) => {
    const total = weighted.reduce((sum, unit) => sum + unit.weight, 0);
    return (
      weighted.reduce((sum, unit) => sum + unit.weight * picker(unit), 0) / Math.max(1e-9, total)
    );
  };
  const weightedOrtg = weightedRating((unit) => unit.base.ratings.offensiveRating);
  const weightedDrtg = weightedRating((unit) => unit.base.ratings.defensiveRatingAllowed);
  const weightedNetRating = weightedOrtg - weightedDrtg;
  const minimumUnitStrength = Math.min(...weighted.map(weightedNet));
  const weightedUnitStrength = weighted.reduce(
    (sum, unit) => sum + unit.weight * weightedNet(unit),
    0,
  );

  const creationScores = weighted.map((unit) => unit.base.offense.creation.score);
  const spacingScores = weighted.map((unit) => unit.base.offense.spacing.score);
  const continuity = (scores: number[]) => {
    if (scores.length === 0) return 100;
    const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
    if (mean <= 0) return 100;
    const variance = scores.reduce((s, v) => s + (v - mean) * (v - mean), 0) / scores.length;
    return Math.min(100, Math.max(0, 100 * (1 - Math.sqrt(variance) / mean)));
  };

  const byId = (unitId: string) => units.find((unit) => unit.unitId === unitId);
  const startingQuality = byId('starters')?.base.ratings.netRating ?? weightedNetRating;
  const closingQuality = byId('closing')?.base.ratings.netRating ?? startingQuality;
  const benchQuality = byId('bench-heavy')?.base.ratings.netRating ?? weightedNetRating;
  const mixedUnits = weighted.filter((unit) => unit.kind === 'trace');
  const mixedQuality =
    mixedUnits.length > 0
      ? mixedUnits.reduce((sum, unit) => sum + unit.weight * weightedNet(unit), 0) /
        Math.max(
          1e-9,
          mixedUnits.reduce((sum, unit) => sum + unit.weight, 0),
        )
      : weightedNetRating;

  const minuteDeviation = minutes.reduce((sum, row) => sum + row.deviation, 0);

  const balance = Math.min(100, Math.max(0, 100 * (1 - Math.abs(weightedNetRating) / 20)));

  const contingencyUnits = units.filter((unit) => unit.kind === 'contingency');
  const singleRemovalCount = allVersions.length;
  const legalAfterRemoval = allVersions.filter(
    (removed) => chooseInitialUnit(context, new Set<string>([removed])) !== null,
  ).length;
  const contingencyDepth = (legalAfterRemoval / Math.max(1, singleRemovalCount)) * 100;

  // Foul resilience: coverage after removing the highest-foul-exposure player.
  const highestFoul = [...players].sort((a, b) => b.tendencies.foulRate - a.tendencies.foulRate)[0];
  const foulResilience =
    highestFoul !== undefined
      ? (contingencyUnits.find(
          (unit) => unit.unitId === `contingency-${highestFoul.playerVersionId ?? ''}`,
        )?.base.offense.defense.score ?? 0)
      : 0;

  const matchupUnits = units.filter((unit) => unit.kind === 'matchup');
  const matchupNets = matchupUnits.map((unit) => unit.base.ratings.netRating);
  const matchupMean =
    matchupNets.length > 0 ? matchupNets.reduce((s, v) => s + v, 0) / matchupNets.length : 0;
  const matchupWorstCase = matchupNets.length > 0 ? Math.min(...matchupNets) : 0;

  // Role redundancy: second-best unit relative to best for key roles.
  const secondBest = (picker: (unit: SeasonProjectionUnit) => number) => {
    const values = units.map((unit) => picker(unit)).sort((a, b) => b - a);
    const best = values[0];
    const second = values[1];
    if (best === undefined || second === undefined || best <= 0) return 100;
    return Math.min(100, Math.max(0, (second / best) * 100));
  };
  const redundancy = Math.min(
    100,
    secondBest((unit) => unit.base.offense.creation.score) * 0.5 +
      secondBest((unit) => unit.base.offense.spacing.score) * 0.3 +
      secondBest((unit) => unit.base.offense.ledger.offensiveReboundRate) * 0.2,
  );

  const metrics: SeasonProjectionMetrics = {
    offensiveRating: weightedOrtg,
    defensiveRatingAllowed: weightedDrtg,
    netRating: weightedNetRating,
    startingQuality,
    mixedQuality,
    benchQuality,
    closingQuality,
    minuteDeviation,
    creationContinuity: continuity(creationScores),
    spacingContinuity: continuity(spacingScores),
    minimumUnitStrength,
    weightedUnitStrength,
    balance,
    positionalCoverage: 100,
    foulResilience,
    contingencyDepth,
    matchupMean,
    matchupWorstCase,
    redundancy,
  };

  const weaknessValues: Record<string, number> = {
    contingencyDepth,
    foulResilience,
    matchupWorstCase,
    creationContinuity: metrics.creationContinuity,
    spacingContinuity: metrics.spacingContinuity,
    minuteDeviation,
    netRating: weightedNetRating,
  };
  const weaknesses = identifyWeaknesses(input.model, weaknessValues);

  const planFacts =
    input.minutePlan === undefined
      ? undefined
      : planFactsOf({
          rotation: input.rotation,
          allVersions,
          players,
          byVersion,
          minutePlan: input.minutePlan,
          profile: input.eraProfile,
          model: input.model,
          cache,
          metrics,
        });

  const rosterMaterial = players
    .map((player) => ({
      playerVersionId: player.playerVersionId,
      positions: [...player.positions].sort(),
    }))
    .sort((a, b) => ((a.playerVersionId ?? '') < (b.playerVersionId ?? '') ? -1 : 1));
  const inputDigest = seasonDigestHex(
    JSON.stringify({
      modelVersion: input.model.modelVersion,
      eraId: input.eraProfile.eraId,
      rotation: {
        starters: input.rotation.starters,
        closingFive: input.rotation.closingFive,
        benchOrder: input.rotation.benchOrder,
        targetMinutes: input.rotation.targetMinutes,
        minutePolicy: input.rotation.minutePolicy,
      },
      roster: rosterMaterial,
    }),
  );
  const digest = seasonDigestHex(
    inputDigest +
      JSON.stringify({
        metrics,
        units: units.map((unit) => ({
          unitId: unit.unitId,
          kind: unit.kind,
          weight: unit.weight,
          net: unit.base.ratings.netRating,
        })),
        weaknesses,
        ...(planFacts === undefined ? {} : { planFacts }),
      }),
  );

  return {
    schemaVersion: 1,
    version: 'season-projection-v1',
    modelVersion: input.model.modelVersion,
    eraId: input.eraProfile.eraId,
    eraProfileVersion: input.eraProfile.profileVersion,
    dataVersion: input.eraProfile.dataVersion,
    inputDigest,
    digest,
    units,
    minutes,
    metrics,
    weaknesses,
    ...(planFacts === undefined ? {} : { planFacts }),
  };
}
