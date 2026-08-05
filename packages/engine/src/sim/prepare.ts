import type { EraSimulationProfile, SimulationTeam } from '@hoop-rush/data-contracts';
import {
  actionWeights,
  teamInitiatorWeights,
  teammateShotWeights,
  zonePrep,
  type TeammateShots,
  type ZonePrep,
} from './usage.ts';
import { teamSpacing, twoPointAnchorFactor } from './shooting.ts';
import { defenderPressure, stealerWeights } from './security.ts';
import { rebounderWeights, teamMean } from './rebounding.ts';
import { foulerWeights, freeThrowShooterWeights } from './fouls.ts';
import {
  responsibilityModifiersForSlot,
  type PositionResponsibilityModifiers,
} from './position-responsibilities.ts';

/**
 * One-time per-game weight and lookup tables for one team. Every value is a
 * pure function of the immutable player snapshots and the era profile, so
 * precomputing once per game leaves the RNG draw sequence untouched (all
 * `weightedPick` calls consume the same weight values in the same order).
 */
export interface TeamPrep {
  /** Slot lookup for every player id in the team's immutable index order. */
  slotByPlayerId: Map<string, number>;
  /** Precomputed initiator weights, in team index order. */
  initiatorWeights: number[];
  /** Per-initiator action weight tables, keyed by playerId. */
  actionWeights: Map<string, number[]>;
  /** Per-initiator teammate shot weights (roll and pass variants), keyed by playerId. */
  teammateShots: Map<string, TeammateShots>;
  /** Rebound attribution weights: [offensive, defensive], in team index order. */
  rebounderWeights: [number[], number[]];
  /** Fouler weights, in team index order. */
  foulerWeights: number[];
  /** Free-throw shooter weights, in team index order. */
  freeThrowShooterWeights: number[];
  /** Stealer weights, in team index order. */
  stealerWeights: number[];
  /** Team-mean offensive rebound rating. */
  offensiveReboundMean: number;
  /** Team-mean defensive rebound rating. */
  defensiveReboundMean: number;
  /** Mean defensive pressure across the five players. */
  pressure: number;
  /** Mean steal rating across the five players. */
  stealAbility: number;
  /** Lineup spacing (0..1), used by the two-point efficiency anchor. */
  spacing: number;
  /** Per-player pristine zone blends and three-point targets, keyed by playerId. */
  zonePrep: Map<string, ZonePrep>;
  /** Per-player two-point anchor factors, keyed by playerId. */
  twoPointAnchor: Map<string, number | null>;
  /**
   * Assigned-position responsibility modifiers, keyed by playerId (pure
   * functions of the slot index and versioned constants; consumed by the
   * initiator, action, roll-man, defender, and rebounder weights).
   */
  positionModifiers: ReadonlyMap<string, PositionResponsibilityModifiers>;
}

/** Builds the per-game preparation tables for one team. */
export function prepareTeam(team: SimulationTeam, profile: EraSimulationProfile): TeamPrep {
  const players = team.players;
  const slotByPlayerId = new Map<string, number>();
  const actionWeightsByPlayer = new Map<string, number[]>();
  const teammateShotsByPlayer = new Map<string, TeammateShots>();
  const zonePrepByPlayer = new Map<string, ZonePrep>();
  const twoPointAnchorByPlayer = new Map<string, number | null>();
  const positionModifiersByPlayer = new Map<string, PositionResponsibilityModifiers>();
  let pressureTotal = 0;
  let stealTotal = 0;
  players.forEach((player, slot) => {
    slotByPlayerId.set(player.playerId, slot);
    const positionModifiers = responsibilityModifiersForSlot(slot);
    positionModifiersByPlayer.set(player.playerId, positionModifiers);
    actionWeightsByPlayer.set(player.playerId, actionWeights(player, positionModifiers));
    teammateShotsByPlayer.set(player.playerId, {
      roll: teammateShotWeights(team, player, 'pickAndRollRoll', positionModifiersByPlayer),
      pass: teammateShotWeights(team, player, 'spotUp', positionModifiersByPlayer),
    });
    const prep = zonePrep(player, profile);
    zonePrepByPlayer.set(player.playerId, prep);
    twoPointAnchorByPlayer.set(player.playerId, twoPointAnchorFactor(player, profile, prep.blend));
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
  };
}
