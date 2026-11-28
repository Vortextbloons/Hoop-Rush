import {
  FULL_COURT_DEFAULT_TACTICS,
  type EraSimulationProfile,
  type FullCourtOffensiveHierarchy,
  type FullCourtTactics,
  type ShotZone,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { SHOT_ZONES } from '../../domain/zones.ts';
import type { EffectsHook } from '../../game/effects.ts';
import type { TeamPrep } from '../../sim/prepare.ts';
import type { SideIndex } from '../../sim/recorder.ts';
import { buildTrustedWeightedPickTable } from '../../sim/rng.ts';
import { twoPointAnchorFactor } from '../../sim/shooting.ts';
import {
  ACTION_TYPES,
  applyZonePulls,
  type ActionType,
  type TeammateShots,
  type ZonePrep,
} from '../../sim/usage.ts';

const PACE_SCALE: Readonly<Record<FullCourtTactics['pace'], number>> = {
  slow: 0.94,
  balanced: 1,
  fast: 1.06,
};

/**
 * Offensive scheme multipliers on each player's prepared zone mix. The scheme
 * changes which shots the same players take; it never changes their ratings.
 */
const OFFENSE_ZONE_SCALE: Readonly<
  Record<'perimeter' | 'interior', Readonly<Record<ShotZone, number>>>
> = {
  perimeter: {
    rim: 0.85,
    shortMid: 0.9,
    longMid: 0.8,
    cornerThree: 1.25,
    aboveBreakThree: 1.2,
  },
  interior: {
    rim: 1.3,
    shortMid: 1.15,
    longMid: 0.8,
    cornerThree: 0.75,
    aboveBreakThree: 0.85,
  },
};

/** A paint-packing defense concedes perimeter attempts instead of rim attempts. */
const PROTECT_PAINT_ZONE_SCALE: Readonly<Record<ShotZone, number>> = {
  rim: 0.82,
  shortMid: 0.9,
  longMid: 1,
  cornerThree: 1.1,
  aboveBreakThree: 1.12,
};

const BALL_MOVEMENT_PASS_DELTA = 0.08;
const BALL_MOVEMENT_ASSIST_MILLIONTHS = 25_000;
const BALL_MOVEMENT_TURNOVER_MILLIONTHS = 20_000;

const PRESSURE_DEFENSE_PRESSURE_DELTA = 0.08;
const PRESSURE_STEAL_ABILITY_DELTA = 8;
const PRESSURE_DEFENSIVE_REBOUND_SCALE = 0.92;
const PRESSURE_ENERGY_SCALE = 1.15;
const PRESSURE_MAKE_CONCESSION_MILLIONTHS = 6_000;

const PROTECT_PAINT_DEFENSE_PRESSURE_DELTA = 0.05;
const PROTECT_PAINT_STEAL_ABILITY_DELTA = 6;
const PROTECT_PAINT_DEFENSIVE_REBOUND_SCALE = 1.04;

type OffensiveHierarchyRole = 'primary' | 'secondary' | 'floor-general';

interface OffensiveRoleScale {
  readonly finish: number;
  readonly initiate: number;
  readonly pass: number;
}

const IDENTITY_ROLE_SCALE: OffensiveRoleScale = { finish: 1, initiate: 1, pass: 1 };

/**
 * Relative opportunity multipliers per role. A primary option takes a larger
 * share of the same prepared tendencies; a floor general runs more possessions
 * and passes more instead of shooting more. Each is a bounded weight, never a
 * fixed attempt count or rating change.
 */
const HIERARCHY_ROLE_MULTIPLIERS: Readonly<Record<OffensiveHierarchyRole, OffensiveRoleScale>> = {
  primary: { finish: 1.28, initiate: 1.12, pass: 0.92 },
  secondary: { finish: 1.14, initiate: 1.05, pass: 0.97 },
  'floor-general': { finish: 0.96, initiate: 1.22, pass: 1.08 },
};

const HIERARCHY_SCALE_FLOOR = 0.85;
const HIERARCHY_SCALE_CEILING = 1.35;
/** A role always nudges the source weights, but a low-usage player is not forced into a star load. */
const HIERARCHY_READINESS_FLOOR = 0.7;
const HIERARCHY_USAGE_REFERENCE = 40;
const HIERARCHY_MATCHUP_FLOOR = 0.92;
const HIERARCHY_MATCHUP_CEILING = 1.08;

export function resolveFullCourtTactics(tactics: FullCourtTactics | undefined): FullCourtTactics {
  if (tactics === undefined) return FULL_COURT_DEFAULT_TACTICS;
  return {
    ...(tactics.ballMovement === true ? { ballMovement: true } : {}),
    pace: tacticValue(tactics.pace, ['slow', 'balanced', 'fast'], 'balanced', 'pace'),
    offense: tacticValue(
      tactics.offense,
      ['balanced', 'perimeter', 'interior', 'ball-movement'],
      'balanced',
      'offense',
    ),
    defense: tacticValue(
      tactics.defense,
      ['balanced', 'pressure', 'protect-paint'],
      'balanced',
      'defense',
    ),
  };
}

export function fullCourtPaceMultiplier(
  tactics: readonly [FullCourtTactics, FullCourtTactics],
): number {
  return (PACE_SCALE[tactics[0].pace] + PACE_SCALE[tactics[1].pace]) / 2;
}

export function fullCourtProfiledPace(
  profile: EraSimulationProfile,
  multiplier: number,
): EraSimulationProfile {
  if (multiplier === 1) return profile;
  // The shared kernel reads trip length from the profile's pace parameter.
  return {
    ...profile,
    parameters: {
      ...profile.parameters,
      pace: Math.min(130, Math.max(1e-6, profile.parameters.pace * multiplier)),
    },
  };
}

export function fullCourtPressureEnergyScale(tactics: FullCourtTactics): number {
  return tactics.defense === 'pressure' ? PRESSURE_ENERGY_SCALE : 1;
}

/**
 * Rewrites the prepared lineup the possession kernel sees. Every change is a
 * per-game projection of the same players: shot preferences, pressure, steal
 * ability, and rebounding positioning.
 */
export function applyFullCourtTacticsToPrep(
  prep: TeamPrep,
  players: readonly SimulationPlayer[],
  profile: EraSimulationProfile,
  own: FullCourtTactics,
  opponentDefense: FullCourtTactics['defense'],
  hierarchy?: FullCourtOffensiveHierarchy,
): TeamPrep {
  const zoneChanged =
    own.offense === 'perimeter' ||
    own.offense === 'interior' ||
    opponentDefense === 'protect-paint';
  const pressure = own.defense === 'pressure';
  const protectPaint = own.defense === 'protect-paint';
  if (
    !zoneChanged &&
    own.offense !== 'ball-movement' &&
    own.ballMovement !== true &&
    !pressure &&
    !protectPaint &&
    hierarchy === undefined
  ) {
    return prep;
  }

  let next = prep;
  if (zoneChanged) {
    next = withTacticalZonePrep(
      next,
      players,
      profile,
      combinedZoneScale(own.offense, opponentDefense),
    );
  }
  if (own.offense === 'ball-movement' || own.ballMovement === true) {
    next = { ...next, passP: adjustedPassProbabilities(next.passP) };
  }
  if (pressure) {
    next = {
      ...next,
      pressure: next.pressure + PRESSURE_DEFENSE_PRESSURE_DELTA,
      stealAbility: next.stealAbility + PRESSURE_STEAL_ABILITY_DELTA,
      defensiveReboundMean: next.defensiveReboundMean * PRESSURE_DEFENSIVE_REBOUND_SCALE,
    };
  }
  if (protectPaint) {
    next = {
      ...next,
      pressure: Math.max(0, next.pressure - PROTECT_PAINT_DEFENSE_PRESSURE_DELTA),
      stealAbility: Math.max(0, next.stealAbility - PROTECT_PAINT_STEAL_ABILITY_DELTA),
      defensiveReboundMean: next.defensiveReboundMean * PROTECT_PAINT_DEFENSIVE_REBOUND_SCALE,
    };
  }
  if (hierarchy !== undefined) {
    next = applyFullCourtHierarchyToPrep(next, players, hierarchy, opponentDefense);
  }
  return next;
}

/**
 * Rescales who starts possessions, who finishes them, and how often a role
 * passes. Only players currently prepared (the active five) are rewritten, so a
 * bench assignment has no effect until that player is on the floor. The source
 * tendencies stay the base of every weight; the roles shift shares within them.
 */
export function applyFullCourtHierarchyToPrep(
  prep: TeamPrep,
  players: readonly SimulationPlayer[],
  hierarchy: FullCourtOffensiveHierarchy | undefined,
  opponentDefense: FullCourtTactics['defense'],
): TeamPrep {
  if (hierarchy === undefined) return prep;
  const unit = hierarchy.unitRoles?.find((entry) =>
    entry.playerIds.every((id) => players.some((player) => player.playerId === id)),
  );
  const primary = unit?.primaryPlayerId ?? hierarchy.primaryPlayerId;
  const handler = unit?.floorGeneralPlayerId ?? hierarchy.floorGeneralPlayerId;
  const roles = new Map<string, OffensiveHierarchyRole>();
  if (hierarchy.secondaryPlayerId !== undefined) {
    roles.set(hierarchy.secondaryPlayerId, 'secondary');
  }
  if (handler !== undefined) roles.set(handler, 'floor-general');
  if (primary !== undefined) roles.set(primary, 'primary');
  if (roles.size === 0 && hierarchy.passingReads === undefined) return prep;

  const indexByKey = new Map<string, number>();
  players.forEach((player, index) => indexByKey.set(prep.keyOf(player), index));
  const activeIds = new Set<string>(players.map((player) => player.playerId));
  const activeReads = new Map(
    Object.entries(hierarchy.passingReads ?? {}).filter(
      ([passer, targets]) =>
        activeIds.has(passer) && targets.some((target) => activeIds.has(target)),
    ),
  );
  if (activeReads.size === 0 && players.every((player) => !roles.has(player.playerId))) return prep;
  const scales = players.map((player): OffensiveRoleScale => {
    const role = roles.get(player.playerId);
    if (role === undefined) return IDENTITY_ROLE_SCALE;
    const scale = roleScaleFor(role, player, opponentDefense);
    if (role !== 'primary' || player.playerId !== handler) return scale;
    const creation = roleScaleFor('floor-general', player, opponentDefense);
    return { ...creation, finish: scale.finish };
  });

  const initiatorWeights = prep.initiatorWeights.map(
    (weight, index) => weight * (scales[index]?.initiate ?? 1),
  );
  const teammateShots = new Map<string, TeammateShots>();
  for (const [key, shots] of prep.teammateShots) {
    const handlerIndex = indexByKey.get(key);
    const passer = handlerIndex === undefined ? undefined : players[handlerIndex];
    const reads = passer === undefined ? undefined : activeReads.get(passer.playerId);
    teammateShots.set(key, {
      byAction: shots.byAction.map((action) => {
        const weights = action.teammates.map((teammate, teammateIndex) => {
          const index = indexByKey.get(prep.keyOf(teammate));
          const finishScale = index === undefined ? 1 : (scales[index]?.finish ?? 1);
          const read = reads?.indexOf(teammate.playerId);
          const readScale = read === 0 ? 1.6 : read === 1 ? 1.3 : 1;
          return (action.weights[teammateIndex] ?? 0) * finishScale * readScale;
        });
        return {
          teammates: action.teammates,
          weights,
          pickTable: buildTrustedWeightedPickTable(weights),
        };
      }),
    });
  }
  const passP = new Map<string, number[]>();
  for (const [key, values] of prep.passP) {
    const index = indexByKey.get(key);
    const passScale = index === undefined ? 1 : (scales[index]?.pass ?? 1);
    passP.set(
      key,
      passScale === 1 && roles.size === 0
        ? values
        : values.map((value) => Math.min(0.97, Math.max(0.05, value * passScale))),
    );
  }
  return {
    ...prep,
    initiatorWeights,
    initiatorPickTable: buildTrustedWeightedPickTable(initiatorWeights),
    teammateShots,
    passP,
  };
}

function roleScaleFor(
  role: OffensiveHierarchyRole,
  player: SimulationPlayer,
  opponentDefense: FullCourtTactics['defense'],
): OffensiveRoleScale {
  const base = HIERARCHY_ROLE_MULTIPLIERS[role];
  const readiness =
    HIERARCHY_READINESS_FLOOR +
    (1 - HIERARCHY_READINESS_FLOOR) *
      Math.min(1, Math.max(0, player.tendencies.usageRate / HIERARCHY_USAGE_REFERENCE));
  const matchup = hierarchyMatchupFactor(player, opponentDefense);
  return {
    finish: boundedHierarchyScale(1 + (base.finish - 1) * readiness * matchup),
    initiate: boundedHierarchyScale(1 + (base.initiate - 1) * readiness),
    pass: boundedHierarchyScale(1 + (base.pass - 1) * readiness),
  };
}

/**
 * A rim-heavy scorer loses some hierarchy volume against a paint-packing defense
 * because the looks his tendencies create are the ones being conceded away.
 */
function hierarchyMatchupFactor(
  player: SimulationPlayer,
  opponentDefense: FullCourtTactics['defense'],
): number {
  if (opponentDefense !== 'protect-paint') return 1;
  const tendencies = player.tendencies;
  const total =
    tendencies.rimFrequency +
    tendencies.shortMidFrequency +
    tendencies.longMidFrequency +
    tendencies.cornerThreeFrequency +
    tendencies.aboveBreakThreeFrequency;
  if (total <= 0) return 1;
  const share = (value: number): number => value / total;
  const factor =
    share(tendencies.rimFrequency) * PROTECT_PAINT_ZONE_SCALE.rim +
    share(tendencies.shortMidFrequency) * PROTECT_PAINT_ZONE_SCALE.shortMid +
    share(tendencies.longMidFrequency) * PROTECT_PAINT_ZONE_SCALE.longMid +
    share(tendencies.cornerThreeFrequency) * PROTECT_PAINT_ZONE_SCALE.cornerThree +
    share(tendencies.aboveBreakThreeFrequency) * PROTECT_PAINT_ZONE_SCALE.aboveBreakThree;
  return Math.min(HIERARCHY_MATCHUP_CEILING, Math.max(HIERARCHY_MATCHUP_FLOOR, factor));
}

function boundedHierarchyScale(value: number): number {
  return Math.min(HIERARCHY_SCALE_CEILING, Math.max(HIERARCHY_SCALE_FLOOR, value));
}

/**
 * Layers tactical probability changes over an optional caller hook. The
 * millionth units match the shared effects contract.
 */
export function fullCourtTacticsEffects(
  base: EffectsHook | undefined,
  tactics: readonly [FullCourtTactics, FullCourtTactics],
): EffectsHook | undefined {
  const make = (defense: FullCourtTactics['defense']): number =>
    defense === 'pressure' ? PRESSURE_MAKE_CONCESSION_MILLIONTHS : 0;
  const turnover = ({ offense, ballMovement }: FullCourtTactics): number =>
    offense === 'ball-movement' || ballMovement ? BALL_MOVEMENT_TURNOVER_MILLIONTHS : 0;
  const assist = ({ offense, ballMovement }: FullCourtTactics): number =>
    offense === 'ball-movement' || ballMovement ? BALL_MOVEMENT_ASSIST_MILLIONTHS : 0;
  const home = tactics[0];
  const away = tactics[1];
  const needed =
    make(home.defense) !== 0 ||
    make(away.defense) !== 0 ||
    turnover(home) !== 0 ||
    turnover(away) !== 0 ||
    assist(home) !== 0 ||
    assist(away) !== 0;
  if (!needed) return base;

  const side = (index: SideIndex): FullCourtTactics => tactics[index];
  return {
    makeAdjustment(facts) {
      return (base?.makeAdjustment(facts) ?? 0) + make(side(facts.defenseSide).defense);
    },
    turnoverAdjustment(facts) {
      return (base?.turnoverAdjustment(facts) ?? 0) + turnover(side(facts.offenseSide));
    },
    assistAdjustment(facts) {
      return (base?.assistAdjustment(facts) ?? 0) + assist(side(facts.offenseSide));
    },
    setActiveUnits(homeUnit, awayUnit) {
      base?.setActiveUnits(homeUnit, awayUnit);
    },
    recordStintSeconds(index, seconds, activeVersions) {
      base?.recordStintSeconds(index, seconds, activeVersions);
    },
    recordTrip(facts) {
      base?.recordTrip(facts);
    },
    halftime() {
      base?.halftime();
    },
  };
}

function tacticValue<T extends string>(
  value: T | undefined,
  allowed: readonly T[],
  fallback: T,
  field: string,
): T {
  if (value === undefined) return fallback;
  if (!allowed.includes(value)) {
    throw new Error(`full court: unknown ${field} tactic ${value}`);
  }
  return value;
}

function combinedZoneScale(
  offense: FullCourtTactics['offense'],
  defense: FullCourtTactics['defense'],
): readonly number[] {
  const own =
    offense === 'perimeter' || offense === 'interior' ? OFFENSE_ZONE_SCALE[offense] : undefined;
  const faced = defense === 'protect-paint' ? PROTECT_PAINT_ZONE_SCALE : undefined;
  return SHOT_ZONES.map((zone) => (own?.[zone] ?? 1) * (faced?.[zone] ?? 1));
}

function withTacticalZonePrep(
  prep: TeamPrep,
  players: readonly SimulationPlayer[],
  profile: EraSimulationProfile,
  scale: readonly number[],
): TeamPrep {
  const zonePrep = new Map(prep.zonePrep);
  const twoPointAnchor = new Map(prep.twoPointAnchor);
  for (const player of players) {
    const key = prep.keyOf(player);
    const zones = prep.zonePrep.get(key);
    if (zones === undefined) continue;
    const blend = normalized(scaled(zones.blend, scale));
    const base = scaled(zones.base, scale);
    const baseTotal = totalOf(base);
    const actionPickTables = Object.fromEntries(
      ACTION_TYPES.map((action) => [
        action,
        buildTrustedWeightedPickTable(applyZonePulls(action, base, zones.driveRate)),
      ]),
    ) as Record<ActionType, ZonePrep['actionPickTables'][ActionType]>;
    zonePrep.set(key, {
      blend,
      threePointTarget:
        baseTotal > 0 ? ((base[3] ?? 0) + (base[4] ?? 0)) / baseTotal : zones.threePointTarget,
      driveRate: zones.driveRate,
      base,
      actionPickTables,
    });
    twoPointAnchor.set(key, twoPointAnchorFactor(player, profile, blend));
  }
  return { ...prep, zonePrep, twoPointAnchor };
}

function adjustedPassProbabilities(
  passP: ReadonlyMap<string, readonly number[]>,
): Map<string, number[]> {
  const adjusted = new Map<string, number[]>();
  for (const [key, values] of passP) {
    adjusted.set(
      key,
      values.map((value) => Math.min(1, Math.max(0.05, value + BALL_MOVEMENT_PASS_DELTA))),
    );
  }
  return adjusted;
}

function scaled(values: readonly number[], scale: readonly number[]): number[] {
  return values.map((value, index) => value * (scale[index] ?? 1));
}

function totalOf(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function normalized(values: readonly number[]): number[] {
  const total = totalOf(values);
  return total > 0 ? values.map((value) => value / total) : [...values];
}
