import type { EraSimulationProfile, SimulationPlayer } from '@hoop-rush/data-contracts';
import { SHOT_ZONES } from '../domain/zones.ts';
import { ENGINE_CONSTANTS as C } from './constants.ts';
import { freeThrowProbability } from './fouls.ts';
import type { TeamPrep } from './prepare.ts';
import type { WeightedPickTable } from './rng.ts';
import { ACTION_TYPES, type PossessionStartType } from './usage.ts';

export const POSSESSION_STARTS: readonly PossessionStartType[] = [
  'neutral',
  'madeBasket',
  'deadBall',
  'liveTurnover',
  'defensiveRebound',
  'offensiveRebound',
];

export type PickTableWriter = (value: WeightedPickTable, items: readonly unknown[]) => void;

export function zeroTable(count: number): WeightedPickTable {
  return { total: 0, weights: Array.from({ length: count }, () => 0) };
}

/**
 * Writes the team-local pick tables that open each side's layout block. The
 * caller writes its mode-specific turnover values next, then calls
 * `encodeTeamActionAndShotTables`.
 */
export function encodeTeamPickTables(
  data: number[],
  table: PickTableWriter,
  prep: TeamPrep,
  players: readonly SimulationPlayer[],
  profile: EraSimulationProfile,
): void {
  table(prep.initiatorPickTable, players);
  table(prep.foulerPickTable, players);
  table(prep.stealerPickTable, players);
  table(prep.rebounderPickTables[0], players);
  table(prep.rebounderPickTables[1], players);
  players.forEach((player, index) => {
    data.push(prep.freeThrowP[index] ?? freeThrowProbability(player, profile));
  });
  table(prep.freeThrowShooterPickTable, players);
  data.push(prep.offensiveReboundMean, prep.defensiveReboundMean, prep.spacing, prep.pressure);
  data.push(
    Math.min(
      0.9,
      Math.max(
        0.3,
        profile.parameters.stealShareOfTurnovers *
          (1 + (prep.stealAbility - C.stealNeutralAbility) / 100),
      ),
    ),
  );
}

/**
 * Writes the action, pass, and shot tables shared by the possession and battle
 * layouts. The writer keeps each mode's table-offset bookkeeping and error
 * prefix while this function owns the ABI order and values.
 */
export function encodeTeamActionAndShotTables(
  data: number[],
  table: PickTableWriter,
  prep: TeamPrep,
  players: readonly SimulationPlayer[],
  keyOf: (player: SimulationPlayer) => string,
  label: string,
): void {
  for (const player of players) {
    const tables = prep.actionPickTables.get(keyOf(player));
    if (tables === undefined) throw new Error(`${label}: missing action tables`);
    for (const start of POSSESSION_STARTS) table(tables.byStart[start], ACTION_TYPES);
  }
  for (const player of players) {
    const values = prep.passP.get(keyOf(player));
    if (values === undefined) throw new Error(`${label}: missing pass probabilities`);
    for (const value of values) data.push(value);
  }
  for (const initiator of players) {
    const shots = prep.teammateShots.get(keyOf(initiator));
    if (shots === undefined) throw new Error(`${label}: missing teammate shots`);
    for (const action of ACTION_TYPES) {
      const weights = shots.byAction[ACTION_TYPES.indexOf(action)];
      if (weights === undefined) throw new Error(`${label}: missing teammate weights`);
      table(weights.pickTable, weights.teammates);
    }
  }
  for (const shooter of players) {
    const zones = prep.zonePrep.get(keyOf(shooter));
    if (zones === undefined) throw new Error(`${label}: missing zone preparation`);
    for (const action of ACTION_TYPES) table(zones.actionPickTables[action], SHOT_ZONES);
  }
  for (let zoneIndex = 0; zoneIndex < SHOT_ZONES.length; zoneIndex += 1) {
    for (let shooterSlot = 0; shooterSlot < players.length; shooterSlot += 1) {
      const defenderTable = prep.defenderBase.pickTables[zoneIndex]?.[shooterSlot];
      if (defenderTable === undefined) throw new Error(`${label}: missing defender table`);
      table(defenderTable, players);
    }
  }
}

/**
 * Writes the struck-defender pool prefix and tables that follow each layout's
 * struck flag. Callers write the flag itself because the normal and struck
 * sections share the same leading slot.
 */
export function encodeStruckTables(
  data: number[],
  table: PickTableWriter,
  prep: TeamPrep,
  pool: readonly SimulationPlayer[],
  roster: readonly SimulationPlayer[],
  shooters: number,
): void {
  data.push(pool.length);
  for (const player of pool) data.push(roster.indexOf(player));
  data.push(prep.defensiveReboundMean);
  table(prep.stealerPickTable, pool);
  table(prep.rebounderPickTables[1], pool);
  for (let zoneIndex = 0; zoneIndex < SHOT_ZONES.length; zoneIndex += 1) {
    for (let shooterSlot = 0; shooterSlot < shooters; shooterSlot += 1) {
      const defenderTable = prep.defenderBase.pickTables[zoneIndex]?.[shooterSlot];
      table(defenderTable ?? zeroTable(pool.length), pool);
    }
  }
  table(zeroTable(pool.length), pool);
}
