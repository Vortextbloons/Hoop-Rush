import type {
  BaseFiveProjectionInput,
  EraSimulationProfile,
  Position,
  ProjectionModelArtifact,
  SeasonMinutePolicyStrategy,
  SeasonRotation,
  SimulationPlayer,
} from '@hoop-rush/data-contracts';
import {
  buildMinutePlanCandidates,
  MINUTE_POLICY_STRATEGIES,
  riskScoreOf,
  type MinutePlanCandidate,
  type MinutePlanPlayerInput,
} from '../season/minute-plan.ts';
import { applySeasonRotationPreset, validateSeasonRotation } from '../season/rotation.ts';
import { traceContext, traceRotationNormal } from './rotation-trace.ts';
import { ProjectionCache } from './cache.ts';
import { projectBaseFive } from './base.ts';
import { projectSeasonRoster } from './season.ts';
const SLOT_ORDER = ['G1', 'G2', 'F1', 'F2', 'C'] as const;
function unitKeyOf(players: readonly string[]): string {
  return [...players].sort().join(',');
}
function missingPlayer(versionId: string): SimulationPlayer {
  throw new Error(`projection: roster missing playerVersionId ${versionId}`);
}
function projectStructureUnit(input: {
  players: readonly string[];
  byVersion: ReadonlyMap<string, SimulationPlayer>;
  profile: EraSimulationProfile;
  model: ProjectionModelArtifact;
  cache: ProjectionCache;
}): ReturnType<typeof projectBaseFive> {
  const { players, byVersion, profile, model, cache } = input;
  const key = ProjectionCache.key({
    eraId: profile.eraId,
    modelVersion: model.modelVersion,
    referenceId: model.references[profile.eraId]?.neutral.referenceId ?? 'neutral',
    slots: SLOT_ORDER,
    playerIds: players.map((id) => byVersion.get(id)?.playerId ?? id),
    playerVersionIds: players,
  });
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const lineup: BaseFiveProjectionInput['lineup'] = [
    { player: byVersion.get(players[0] ?? '') ?? missingPlayer(players[0] ?? ''), slot: 'G1' },
    { player: byVersion.get(players[1] ?? '') ?? missingPlayer(players[1] ?? ''), slot: 'G2' },
    { player: byVersion.get(players[2] ?? '') ?? missingPlayer(players[2] ?? ''), slot: 'F1' },
    { player: byVersion.get(players[3] ?? '') ?? missingPlayer(players[3] ?? ''), slot: 'F2' },
    { player: byVersion.get(players[4] ?? '') ?? missingPlayer(players[4] ?? ''), slot: 'C' },
  ];
  const projection = projectBaseFive({ lineup, eraProfile: profile, model });
  cache.set(key, projection);
  return projection;
}
export function projectedQualityWeights(input: {
  players: readonly SimulationPlayer[];
  byVersion: ReadonlyMap<string, SimulationPlayer>;
  rotation: SeasonRotation;
  eraProfile: EraSimulationProfile;
  model: ProjectionModelArtifact;
  cache: ProjectionCache;
}): Map<string, number> {
  const { players, byVersion, rotation, eraProfile, model, cache } = input;
  const members = new Map<string, readonly Position[]>(
    players.map((player) => [player.playerVersionId ?? player.playerId, player.positions]),
  );
  const units: Array<{
    players: readonly string[];
    base: ReturnType<typeof projectBaseFive>;
  }> = [];
  const push = (five: readonly string[]) => {
    units.push({
      players: five,
      base: projectStructureUnit({
        players: five,
        byVersion,
        profile: eraProfile,
        model,
        cache,
      }),
    });
  };
  push(rotation.starters);
  push(rotation.closingFive);
  const benchHeavyRotation = applySeasonRotationPreset(rotation, 'bench-heavy');
  const benchHeavyTrace = traceRotationNormal(
    traceContext({ rotation: benchHeavyRotation, members }),
  );
  const startersKey = unitKeyOf(rotation.starters);
  const benchHeavyUnit =
    benchHeavyTrace.units.find((unit) => unitKeyOf(unit.players) === startersKey)?.players ??
    benchHeavyTrace.units[0]?.players;
  if (benchHeavyUnit !== undefined) push(benchHeavyUnit);
  const result = new Map<string, number>();
  for (const player of players) {
    const versionId = player.playerVersionId ?? player.playerId;
    const unit = units.find((candidate) => candidate.players.includes(versionId));
    if (unit === undefined) {
      result.set(versionId, 0.5);
      continue;
    }
    const offense = unit.base.offense.players.find((row) => row.playerVersionId === versionId);
    if (offense === undefined) {
      result.set(versionId, 0.5);
      continue;
    }
    const defense = unit.base.defense.players.find((row) => row.playerVersionId === versionId);
    const defensiveContribution = defense?.defensiveContribution ?? offense.defensiveContribution;
    result.set(
      versionId,
      Math.max(0, Math.min(1, (offense.expectedPoints + defensiveContribution) / 200)),
    );
  }
  return result;
}
export interface OptimizedMinutePlan extends MinutePlanCandidate {
  projectedNetRating: number;
  unitQuality: {
    starting: number;
    closing: number;
    bench: number;
  };
}
export interface MinutePlanOptimizationResult {
  plans: OptimizedMinutePlan[];
  recommended: SeasonMinutePolicyStrategy;
}
export function optimizeSeasonRotation(input: {
  roster: readonly {
    player: SimulationPlayer;
  }[];
  structure: SeasonRotation;
  eraProfile: EraSimulationProfile;
  model: ProjectionModelArtifact;
  load: ReadonlyMap<
    string,
    {
      staminaRating: number;
      durability: number;
      fatigueBasisPoints: number;
      recentLoadBasisPoints: number;
    }
  >;
  horizon: number;
  cache?: ProjectionCache;
}): MinutePlanOptimizationResult {
  const { roster, structure, eraProfile, model, load, horizon } = input;
  const cache = input.cache ?? new ProjectionCache();
  const players = roster.map((entry) => entry.player);
  const byVersion = new Map<string, SimulationPlayer>();
  for (const player of players) {
    const version = player.playerVersionId;
    if (version === undefined) {
      throw new Error(`optimizeSeasonRotation: roster players must carry playerVersionId`);
    }
    byVersion.set(version, player);
  }
  const memberPlayable = new Map<string, readonly Position[]>(
    players.map((player) => [player.playerVersionId ?? player.playerId, player.positions]),
  );
  const rotationErrors = validateSeasonRotation(structure, memberPlayable);
  if (rotationErrors.length > 0) {
    throw new Error(`optimizeSeasonRotation: invalid rotation: ${rotationErrors.join(', ')}`);
  }
  const qualityByVersion = projectedQualityWeights({
    players,
    byVersion,
    rotation: structure,
    eraProfile,
    model,
    cache,
  });
  const minutePlanPlayers = new Map<string, MinutePlanPlayerInput>(
    players.map((player) => {
      const version = player.playerVersionId ?? player.playerId;
      const row = load.get(version);
      return [
        version,
        {
          playerVersionId: version,
          quality: qualityByVersion.get(version) ?? 0.5,
          staminaRating: row?.staminaRating ?? 70,
          durability: row?.durability ?? 70,
          fatigueBasisPoints: row?.fatigueBasisPoints ?? 0,
          recentLoadBasisPoints: row?.recentLoadBasisPoints ?? 0,
        },
      ];
    }),
  );
  const built = buildMinutePlanCandidates({
    structure: {
      starters: structure.starters,
      benchOrder: structure.benchOrder,
      closingFive: structure.closingFive,
    },
    players: minutePlanPlayers,
    horizon,
  });
  const projected = built.plans.map((plan) => {
    const projection = projectSeasonRoster(
      { roster, rotation: plan.rotation, eraProfile, model },
      { cache },
    );
    return {
      ...plan,
      projectedNetRating: projection.metrics.netRating,
      unitQuality: {
        starting: projection.metrics.startingQuality,
        closing: projection.metrics.closingQuality,
        bench: projection.metrics.benchQuality,
      },
    };
  });
  const nets = projected.map((plan) => plan.projectedNetRating);
  const maxNet = Math.max(...nets);
  const minNet = Math.min(...nets);
  const relative = new Map<SeasonMinutePolicyStrategy, number>(
    projected.map((plan) => [
      plan.strategy,
      maxNet <= minNet
        ? 0.5
        : Math.max(0, Math.min(1, (plan.projectedNetRating - minNet) / (maxNet - minNet))),
    ]),
  );
  const plans = projected.map((plan) => ({
    ...plan,
    riskScore: riskScoreOf({
      quality: relative.get(plan.strategy) ?? 0.5,
      maxStarterStrainBasisPoints: plan.maxStarterStrainBasisPoints,
      relief: plan.relief,
    }),
    rotation: { ...plan.rotation, franchiseId: structure.franchiseId },
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
    throw new Error('optimizeSeasonRotation: no envelope plan produced');
  }
  return { plans, recommended: recommended.strategy };
}
