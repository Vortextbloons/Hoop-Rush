import type {
  EraSimulationProfile,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import {
  ACTION_TYPES,
  actionWeights,
  buildActionStartTables,
  defenderBase,
  passProbability,
  teamInitiatorWeights,
  teammateShotWeightsFor,
  zonePrep,
  type ActionStartTables,
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
import { ENGINE_CONSTANTS, type PositionResponsibilityModifiers } from './constants.ts';
import { finishingDemand, OFFENSIVE_ALLOCATION_VERSION, type FinishingDemand } from './offense.ts';
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
  offense: {
    version: string;
    demands: FinishingDemand[];
    creatorShares: number[];
    shotShares: number[];
  };
  slotByPlayerId: Map<string, number>;
  keyOf: (player: SimulationPlayer) => string;
  initiatorWeights: number[];
  initiatorPickTable: WeightedPickTable;
  actionWeights: Map<string, number[]>;
  actionPickTables: Map<string, ActionStartTables>;
  teammateShots: Map<string, TeammateShots>;
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
  const actionPickTablesByPlayer = new Map<string, ActionStartTables>();
  const teammateShotsByPlayer = new Map<string, TeammateShots>();
  const zonePrepByPlayer = new Map<string, ZonePrep>();
  const twoPointAnchorByPlayer = new Map<string, number | null>();
  const passPByPlayer = new Map<string, number[]>();
  const positionModifiersByPlayer = new Map<string, PositionResponsibilityModifiers>();
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
    const weights = actionWeights(player, positionModifiers);
    actionWeightsByPlayer.set(key, weights);
    actionPickTablesByPlayer.set(key, buildActionStartTables(weights));
    freeThrowP.push(freeThrowProbability(player, profile, evidence));
    const prep = zonePrep(player, profile, evidence);
    zonePrepByPlayer.set(key, prep);
    twoPointAnchorByPlayer.set(key, twoPointAnchorFactor(player, profile, prep.blend, evidence));
    pressureTotal += defenderPressure(player);
    stealTotal += player.ratings.steal;
  });
  const demands = players.map((player) => finishingDemand(player, evidenceOf?.(player)));
  const demandByKey = new Map(
    players.map((player, index) => [
      keyOf(player),
      demands[index]?.attemptsPer36 ?? ENGINE_CONSTANTS.offensiveAllocation.minimumDemand,
    ]),
  );
  const teammateListsByKey = new Map<string, SimulationPlayer[]>();
  for (const player of players) {
    const key = keyOf(player);
    teammateListsByKey.set(
      key,
      players.filter((other) => keyOf(other) !== key),
    );
  }
  players.forEach((player, index) => {
    const key = keyOf(player);
    const teammates = teammateListsByKey.get(key) ?? [];
    const byAction = ACTION_TYPES.map((action) =>
      teammateShotWeightsFor(
        teammates,
        action,
        positionModifiersByPlayer,
        keyOf,
        (receiver) =>
          demandByKey.get(keyOf(receiver)) ?? ENGINE_CONSTANTS.offensiveAllocation.minimumDemand,
      ),
    );
    teammateShotsByPlayer.set(key, { byAction });
    passPByPlayer.set(
      key,
      ACTION_TYPES.map((action, actionIndex) => {
        const stylePass = passProbability(player, action);
        const self =
          ((demands[index]?.attemptsPer36 ?? 0.5) *
            Math.max(1, players.length - 1) *
            (1 - stylePass)) /
          stylePass;
        const peers = byAction[actionIndex]?.pickTable.total ?? 0;
        return peers / Math.max(1e-9, self + peers);
      }),
    );
  });
  const divisor = options.aggregateDivisor ?? players.length;
  const initiatorWeights = teamInitiatorWeights(team, positionModifiersByPlayer, keyOf);
  const creatorTotal = initiatorWeights.reduce((sum, weight) => sum + weight, 0);
  const creatorShares = initiatorWeights.map((weight) => weight / Math.max(1e-9, creatorTotal));
  const shotShares = players.map(() => 0);
  players.forEach((player, index) => {
    const key = keyOf(player);
    const actions = actionWeightsByPlayer.get(key) ?? [];
    const total = actions.reduce((sum, weight) => sum + weight, 0);
    ACTION_TYPES.forEach((_, actionIndex) => {
      const mass =
        ((creatorShares[index] ?? 0) * (actions[actionIndex] ?? 0)) / Math.max(1e-9, total);
      const pass = passPByPlayer.get(key)?.[actionIndex] ?? 0;
      shotShares[index] = (shotShares[index] ?? 0) + mass * (1 - pass);
      const receivers = teammateShotsByPlayer.get(key)?.byAction[actionIndex];
      const receiverTotal = receivers?.pickTable.total ?? 0;
      receivers?.teammates.forEach((receiver, receiverIndex) => {
        const slot = slotByPlayerId.get(keyOf(receiver));
        if (slot === undefined) return;
        shotShares[slot] =
          (shotShares[slot] ?? 0) +
          (mass * pass * (receivers.weights[receiverIndex] ?? 0)) / Math.max(1e-9, receiverTotal);
      });
    });
  });
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
    offense: { version: OFFENSIVE_ALLOCATION_VERSION, demands, creatorShares, shotShares },
    slotByPlayerId,
    keyOf,
    initiatorWeights,
    initiatorPickTable: buildWeightedPickTable(initiatorWeights),
    actionWeights: actionWeightsByPlayer,
    actionPickTables: actionPickTablesByPlayer,
    teammateShots: teammateShotsByPlayer,
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
