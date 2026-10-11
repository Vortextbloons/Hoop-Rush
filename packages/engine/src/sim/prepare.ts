import type {
  EraSimulationProfile,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import {
  ACTION_TYPES,
  actionWeights,
  assisterPickPrep,
  defenderBase,
  passProbability,
  teamInitiatorWeights,
  teammateShotWeights,
  zonePrep,
  type AssisterPickPrep,
  type DefenderBase,
  type TeammateShots,
  type ZonePrep,
} from './usage.ts';
import { buildWeightedPickTable, type WeightedPickTable } from './rng.ts';
import type { HavocEvidence } from './havoc-runtime.ts';
import { teamSpacing, twoPointAnchorFactor } from './shooting.ts';
import { defenderPressure, stealerWeights } from './security.ts';
import { rebounderWeights, teamMean } from './rebounding.ts';
import { foulerWeights, freeThrowProbability, freeThrowShooterWeights } from './fouls.ts';
import { responsibilityModifiersForSlot } from './position-responsibilities.ts';
import { type PositionResponsibilityModifiers } from './constants.ts';
export function enginePlayerKey(player: SimulationPlayer): string {
  return player.playerVersionId ?? player.playerId;
}
export interface TeamPrepOptions {
  /** Runtime participant identity (Havoc); defaults to source identity. */
  keyOf?: (player: SimulationPlayer) => string;
  /** Base slot used for position responsibilities; defaults to the array index. */
  responsibilitySlotOf?: (player: SimulationPlayer, index: number) => number;
  /** Authoritative-channel evidence flags; defaults to none. */
  evidenceOf?: (player: SimulationPlayer) => HavocEvidence | undefined;
  /** Divisor for team aggregates (pressure, steal ability). */
  aggregateDivisor?: number;
  /** Individual rebounder weight multiplier (wingspan reach). */
  rebounderWeightScale?: (player: SimulationPlayer) => number;
  /** Additive reach contribution to team rebound strength. */
  reboundMeanReach?: (player: SimulationPlayer) => number;
}
export interface TeamPrep {
  slotByPlayerId: Map<string, number>;
  keyOf: (player: SimulationPlayer) => string;
  initiatorWeights: number[];
  initiatorPickTable: WeightedPickTable;
  actionWeights: Map<string, number[]>;
  teammateShots: Map<string, TeammateShots>;
  assisterByPair: Map<string, AssisterPickPrep>;
  rebounderWeights: [number[], number[]];
  rebounderPickTables: [WeightedPickTable, WeightedPickTable];
  foulerWeights: number[];
  foulerPickTable: WeightedPickTable;
  freeThrowShooterWeights: number[];
  freeThrowShooterPickTable: WeightedPickTable;
  stealerWeights: number[];
  stealerPickTable: WeightedPickTable;
  offensiveReboundMean: number;
  defensiveReboundMean: number;
  pressure: number;
  stealAbility: number;
  spacing: number;
  zonePrep: Map<string, ZonePrep>;
  twoPointAnchor: Map<string, number | null>;
  positionModifiers: ReadonlyMap<string, PositionResponsibilityModifiers>;
  defenderBase: DefenderBase;
  freeThrowP: number[];
  passP: Map<string, number[]>;
}
export function prepareTeam(
  team: SimulationTeam,
  profile: EraSimulationProfile,
  options: TeamPrepOptions = {},
): TeamPrep {
  const players = team.players;
  const keyOf = options.keyOf ?? enginePlayerKey;
  const evidenceOf = options.evidenceOf;
  const slotByPlayerId = new Map<string, number>();
  const actionWeightsByPlayer = new Map<string, number[]>();
  const teammateShotsByPlayer = new Map<string, TeammateShots>();
  const zonePrepByPlayer = new Map<string, ZonePrep>();
  const twoPointAnchorByPlayer = new Map<string, number | null>();
  const passPByPlayer = new Map<string, number[]>();
  const positionModifiersByPlayer = new Map<string, PositionResponsibilityModifiers>();
  const assisterByPair = new Map<string, AssisterPickPrep>();
  const freeThrowP: number[] = [];
  let pressureTotal = 0;
  let stealTotal = 0;
  players.forEach((player, index) => {
    const key = keyOf(player);
    const evidence = evidenceOf?.(player);
    slotByPlayerId.set(key, index);
    const responsibilitySlot = options.responsibilitySlotOf?.(player, index) ?? index;
    const positionModifiers = responsibilityModifiersForSlot(responsibilitySlot);
    positionModifiersByPlayer.set(key, positionModifiers);
    positionModifiersByPlayer.set(player.playerId, positionModifiers);
    actionWeightsByPlayer.set(key, actionWeights(player, positionModifiers));
    passPByPlayer.set(
      key,
      ACTION_TYPES.map((action) => passProbability(player, action)),
    );
    freeThrowP.push(freeThrowProbability(player, profile, evidence));
    teammateShotsByPlayer.set(key, {
      roll: teammateShotWeights(team, player, 'pickAndRollRoll', positionModifiersByPlayer, keyOf),
      pass: teammateShotWeights(team, player, 'spotUp', positionModifiersByPlayer, keyOf),
    });
    const prep = zonePrep(player, profile, evidence);
    zonePrepByPlayer.set(key, prep);
    twoPointAnchorByPlayer.set(key, twoPointAnchorFactor(player, profile, prep.blend, evidence));
    pressureTotal += defenderPressure(player);
    stealTotal += player.ratings.steal;
  });
  for (const shooter of players) {
    for (const initiator of players) {
      if (keyOf(shooter) === keyOf(initiator)) continue;
      assisterByPair.set(
        `${keyOf(shooter)}\u0000${keyOf(initiator)}`,
        assisterPickPrep(team, shooter, initiator, keyOf, evidenceOf),
      );
    }
  }
  const divisor = options.aggregateDivisor ?? players.length;
  const initiatorWeights = teamInitiatorWeights(team, positionModifiersByPlayer, keyOf);
  const offensiveRebounderWeights = rebounderWeights(
    team,
    true,
    positionModifiersByPlayer,
    keyOf,
    evidenceOf,
    options.rebounderWeightScale,
  );
  const defensiveRebounderWeights = rebounderWeights(
    team,
    false,
    positionModifiersByPlayer,
    keyOf,
    evidenceOf,
    options.rebounderWeightScale,
  );
  const teamFoulerWeights = foulerWeights(team);
  const teamFreeThrowShooterWeights = freeThrowShooterWeights(team);
  const teamStealerWeights = stealerWeights(team);
  return {
    slotByPlayerId,
    keyOf,
    initiatorWeights,
    initiatorPickTable: buildWeightedPickTable(initiatorWeights),
    actionWeights: actionWeightsByPlayer,
    teammateShots: teammateShotsByPlayer,
    assisterByPair,
    rebounderWeights: [offensiveRebounderWeights, defensiveRebounderWeights],
    rebounderPickTables: [
      buildWeightedPickTable(offensiveRebounderWeights),
      buildWeightedPickTable(defensiveRebounderWeights),
    ],
    foulerWeights: teamFoulerWeights,
    foulerPickTable: buildWeightedPickTable(teamFoulerWeights),
    freeThrowShooterWeights: teamFreeThrowShooterWeights,
    freeThrowShooterPickTable: buildWeightedPickTable(teamFreeThrowShooterWeights),
    stealerWeights: teamStealerWeights,
    stealerPickTable: buildWeightedPickTable(teamStealerWeights),
    offensiveReboundMean: teamMean(team, 'offensiveRebound', {
      reachOf: options.reboundMeanReach,
      divisor,
    }),
    defensiveReboundMean: teamMean(team, 'defensiveRebound', {
      reachOf: options.reboundMeanReach,
      divisor,
    }),
    pressure: pressureTotal / Math.max(1e-9, divisor),
    stealAbility: stealTotal / Math.max(1e-9, divisor),
    spacing: teamSpacing(team),
    zonePrep: zonePrepByPlayer,
    twoPointAnchor: twoPointAnchorByPlayer,
    positionModifiers: positionModifiersByPlayer,
    defenderBase: defenderBase(team, positionModifiersByPlayer, keyOf, (index) => {
      const player = players[index];
      if (player === undefined) return index;
      return options.responsibilitySlotOf?.(player, index) ?? index;
    }),
    freeThrowP,
    passP: passPByPlayer,
  };
}
