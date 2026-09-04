import type {
  EraSimulationProfile,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import {
  ACTION_TYPES,
  actionWeights,
  defenderBase,
  passProbability,
  teamInitiatorWeights,
  teammateShotWeights,
  zonePrep,
  type DefenderBase,
  type TeammateShots,
  type ZonePrep,
} from './usage.ts';
import { teamSpacing, twoPointAnchorFactor } from './shooting.ts';
import { defenderPressure, stealerWeights } from './security.ts';
import { rebounderWeights, teamMean } from './rebounding.ts';
import { foulerWeights, freeThrowProbability, freeThrowShooterWeights } from './fouls.ts';
import {
  responsibilityModifiersForSlot,
  type PositionResponsibilityModifiers,
} from './position-responsibilities.ts';
export function enginePlayerKey(player: SimulationPlayer): string {
  return player.playerVersionId ?? player.playerId;
}
export interface TeamPrep {
  slotByPlayerId: Map<string, number>;
  initiatorWeights: number[];
  actionWeights: Map<string, number[]>;
  teammateShots: Map<string, TeammateShots>;
  rebounderWeights: [number[], number[]];
  foulerWeights: number[];
  freeThrowShooterWeights: number[];
  stealerWeights: number[];
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
export function prepareTeam(team: SimulationTeam, profile: EraSimulationProfile): TeamPrep {
  const players = team.players;
  const slotByPlayerId = new Map<string, number>();
  const actionWeightsByPlayer = new Map<string, number[]>();
  const teammateShotsByPlayer = new Map<string, TeammateShots>();
  const zonePrepByPlayer = new Map<string, ZonePrep>();
  const twoPointAnchorByPlayer = new Map<string, number | null>();
  const passPByPlayer = new Map<string, number[]>();
  const positionModifiersByPlayer = new Map<string, PositionResponsibilityModifiers>();
  const freeThrowP: number[] = [];
  let pressureTotal = 0;
  let stealTotal = 0;
  players.forEach((player, slot) => {
    const key = enginePlayerKey(player);
    slotByPlayerId.set(key, slot);
    const positionModifiers = responsibilityModifiersForSlot(slot);
    positionModifiersByPlayer.set(key, positionModifiers);
    positionModifiersByPlayer.set(player.playerId, positionModifiers);
    actionWeightsByPlayer.set(key, actionWeights(player, positionModifiers));
    passPByPlayer.set(
      key,
      ACTION_TYPES.map((action) => passProbability(player, action)),
    );
    freeThrowP.push(freeThrowProbability(player, profile));
    teammateShotsByPlayer.set(key, {
      roll: teammateShotWeights(team, player, 'pickAndRollRoll', positionModifiersByPlayer),
      pass: teammateShotWeights(team, player, 'spotUp', positionModifiersByPlayer),
    });
    const prep = zonePrep(player, profile);
    zonePrepByPlayer.set(key, prep);
    twoPointAnchorByPlayer.set(key, twoPointAnchorFactor(player, profile, prep.blend));
    pressureTotal += defenderPressure(player);
    stealTotal += player.ratings.steal;
  });
  return {
    slotByPlayerId,
    initiatorWeights: teamInitiatorWeights(team, positionModifiersByPlayer),
    actionWeights: actionWeightsByPlayer,
    teammateShots: teammateShotsByPlayer,
    rebounderWeights: [
      rebounderWeights(team, true, positionModifiersByPlayer),
      rebounderWeights(team, false, positionModifiersByPlayer),
    ],
    foulerWeights: foulerWeights(team),
    freeThrowShooterWeights: freeThrowShooterWeights(team),
    stealerWeights: stealerWeights(team),
    offensiveReboundMean: teamMean(team, 'offensiveRebound'),
    defensiveReboundMean: teamMean(team, 'defensiveRebound'),
    pressure: pressureTotal / players.length,
    stealAbility: stealTotal / players.length,
    spacing: teamSpacing(team),
    zonePrep: zonePrepByPlayer,
    twoPointAnchor: twoPointAnchorByPlayer,
    positionModifiers: positionModifiersByPlayer,
    defenderBase: defenderBase(team, positionModifiersByPlayer),
    freeThrowP,
    passP: passPByPlayer,
  };
}
