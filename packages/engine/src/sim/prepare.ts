import type {
  EraSimulationProfile,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import {
  actionWeights,
  defenderBase,
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
import { foulerWeights, freeThrowShooterWeights } from './fouls.ts';
import {
  responsibilityModifiersForSlot,
  type PositionResponsibilityModifiers,
} from './position-responsibilities.ts';

/**
 * Authoritative identity key for possession lookups and accounting
 * (spec/2.0/04 M2.2): `playerVersionId` when present, otherwise `playerId`.
 * Season Run players carry a playerVersionId so two historical versions of
 * one person (same playerId) never collide in a shared side; Classic/sandbox
 * players have no playerVersionId and key by playerId, keeping the Classic
 * path byte-identical. Lookups consume no RNG, so the key change never
 * alters a draw sequence.
 */
export function enginePlayerKey(player: SimulationPlayer): string {
  return player.playerVersionId ?? player.playerId;
}

/**
 * One-time per-game weight and lookup tables for one team. Every value is a
 * pure function of the immutable player snapshots and the era profile, so
 * precomputing once per game leaves the RNG draw sequence untouched (all
 * `weightedPick` calls consume the same weight values in the same order).
 */
export interface TeamPrep {
  /** Slot lookup keyed by enginePlayerKey (playerVersionId ?? playerId). */
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
  /** Defender selection base: zone weights + rim protection per slot. */
  defenderBase: DefenderBase;
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
    const key = enginePlayerKey(player);
    slotByPlayerId.set(key, slot);
    const positionModifiers = responsibilityModifiersForSlot(slot);
    // Keyed by engine identity for possession lookups. The playerId alias
    // keeps the weight functions that look up by playerId (teamInitiatorWeights,
    // teammateShotWeights, pickDefender, rebounderWeights) working for Season
    // players; for Classic players both keys coincide. Two versions of one
    // person sharing the same active five would alias to the last version's
    // modifiers via the playerId key only.
    positionModifiersByPlayer.set(key, positionModifiers);
    positionModifiersByPlayer.set(player.playerId, positionModifiers);
    actionWeightsByPlayer.set(key, actionWeights(player, positionModifiers));
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
  };
}

/**
 * Memoized preparation for identical (team, profile) pairs. prepareTeam is
 * pure and every prep value is consumed read-only (weightedPick never
 * mutates weights; pickZone copies before mutating), so repeated benchmark,
 * calibration, and bracket sample games against the same team objects reuse
 * the per-game tables instead of rebuilding them. Entries die with their
 * team objects (WeakMap), so a long Season Run cannot grow unbounded.
 */
const prepCache = new WeakMap<SimulationTeam, { profile: EraSimulationProfile; prep: TeamPrep }>();

export function prepareTeamCached(team: SimulationTeam, profile: EraSimulationProfile): TeamPrep {
  const cached = prepCache.get(team);
  if (cached !== undefined && cached.profile === profile) return cached.prep;
  const prep = prepareTeam(team, profile);
  prepCache.set(team, { profile, prep });
  return prep;
}
