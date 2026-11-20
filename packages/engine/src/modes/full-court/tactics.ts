import {
  FULL_COURT_DEFAULT_TACTICS,
  type EraSimulationProfile,
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
import { ACTION_TYPES, applyZonePulls, type ActionType, type ZonePrep } from '../../sim/usage.ts';

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

export function resolveFullCourtTactics(tactics: FullCourtTactics | undefined): FullCourtTactics {
  if (tactics === undefined) return FULL_COURT_DEFAULT_TACTICS;
  return {
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
): TeamPrep {
  const zoneChanged =
    own.offense === 'perimeter' ||
    own.offense === 'interior' ||
    opponentDefense === 'protect-paint';
  const pressure = own.defense === 'pressure';
  const protectPaint = own.defense === 'protect-paint';
  if (!zoneChanged && own.offense !== 'ball-movement' && !pressure && !protectPaint) return prep;

  let next = prep;
  if (zoneChanged) {
    next = withTacticalZonePrep(
      next,
      players,
      profile,
      combinedZoneScale(own.offense, opponentDefense),
    );
  }
  if (own.offense === 'ball-movement') {
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
  return next;
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
  const turnover = (offense: FullCourtTactics['offense']): number =>
    offense === 'ball-movement' ? BALL_MOVEMENT_TURNOVER_MILLIONTHS : 0;
  const assist = (offense: FullCourtTactics['offense']): number =>
    offense === 'ball-movement' ? BALL_MOVEMENT_ASSIST_MILLIONTHS : 0;
  const home = tactics[0];
  const away = tactics[1];
  const needed =
    make(home.defense) !== 0 ||
    make(away.defense) !== 0 ||
    turnover(home.offense) !== 0 ||
    turnover(away.offense) !== 0 ||
    assist(home.offense) !== 0 ||
    assist(away.offense) !== 0;
  if (!needed) return base;

  const side = (index: SideIndex): FullCourtTactics => tactics[index];
  return {
    makeAdjustment(facts) {
      return (base?.makeAdjustment(facts) ?? 0) + make(side(facts.defenseSide).defense);
    },
    turnoverAdjustment(facts) {
      return (base?.turnoverAdjustment(facts) ?? 0) + turnover(side(facts.offenseSide).offense);
    },
    assistAdjustment(facts) {
      return (base?.assistAdjustment(facts) ?? 0) + assist(side(facts.offenseSide).offense);
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
