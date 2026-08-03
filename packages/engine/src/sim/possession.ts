import type {
  EraSimulationProfile,
  ShotZone,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import type { Rng } from './rng.js';
import { GameRecorder, type SideIndex } from './recorder.js';
import { meanTripSeconds, sampleTripSeconds } from './timing.js';
import {
  pickAction,
  pickDefender,
  pickInitiator,
  pickAssister,
  pickShot,
  pickZone,
  isThreePointZone,
  zoneSkillRating,
  type ActionType,
} from './usage.js';
import { eraPossEstimatePerTrip, isSteal, pickStealer, turnoverProbability } from './security.js';
import { blockProbability, makeProbability, type ShotPrep } from './shooting.js';
import {
  freeThrowsForZone,
  freeThrowProbability,
  nonShootingFoulProbability,
  pickFouler,
  pickFreeThrowShooter,
  shootingFoulProbability,
} from './fouls.js';
import { pickRebounder, resolveRebound } from './rebounding.js';
import { prepareTeam, type TeamPrep } from './prepare.js';
import { ENGINE_CONSTANTS } from './constants.js';
import { creationScore } from '../domain/archetypes.js';

/**
 * One offensive trip (spec/03 pipeline stages 1-9). All clock consumption
 * flows through `state.secondsRemaining`, which the caller owns and seals
 * per period; the trip returns the consumed seconds and whether the ball
 * changed possession.
 */

export interface TripResolution {
  /** Seconds of game clock consumed (base trip + fouls + free throws + continuations). */
  secondsElapsed: number;
  /** Whether the trip ended (change of possession) or continues as the same trip. */
  ended: boolean;
}

export interface GameState {
  /** Team fouls committed by each side in the current period. */
  periodFouls: [number, number];
  /** Current period index (0-based). */
  periodIndex: number;
  /** Seconds remaining in the current period; trips consume from it. */
  secondsRemaining: number;
}

export function createGameState(
  profile: EraSimulationProfile,
  home: SimulationTeam,
  away: SimulationTeam,
): GameState {
  return {
    periodFouls: [0, 0],
    periodIndex: 0,
    secondsRemaining: 0,
  };
}

/**
 * Shared per-game trip context. Constructed once per game and passed by
 * reference: the RNG, recorder, state, teams, and all per-team preparation
 * tables are game-stable, so no trip rebuilds them.
 */
export interface TripContext {
  rng: Rng;
  recorder: GameRecorder;
  state: GameState;
  profile: EraSimulationProfile;
  teams: [SimulationTeam, SimulationTeam];
  /** Per-team per-game weight and lookup tables, in side order. */
  preps: [TeamPrep, TeamPrep];
  /** Hoisted game scalars (pure functions of the profile). */
  meanTripSeconds: number;
  eraPossEstimatePerTrip: number;
  passingAnchorFactor: number;
}

/** Builds the shared per-game trip context (state mutates in place; the rest is stable). */
export function createTripContext(
  rng: Rng,
  recorder: GameRecorder,
  state: GameState,
  profile: EraSimulationProfile,
  teams: [SimulationTeam, SimulationTeam],
): TripContext {
  return {
    rng,
    recorder,
    state,
    profile,
    teams,
    preps: [prepareTeam(teams[0], profile), prepareTeam(teams[1], profile)],
    meanTripSeconds: meanTripSeconds(profile),
    eraPossEstimatePerTrip: eraPossEstimatePerTrip(profile) ?? 1,
    passingAnchorFactor: 0.5 + (profile.parameters.assistAnchorRating - 50) / 100,
  };
}

function freeThrowProbabilityFor(ctx: TripContext, shooter: SimulationPlayer): number {
  return freeThrowProbability(shooter, ctx.profile);
}

/** Consumes clock seconds (capped at remaining) and returns how much was consumed. */
function consumeTime(state: GameState, seconds: number): number {
  const consumed = Math.min(seconds, state.secondsRemaining);
  state.secondsRemaining -= consumed;
  return consumed;
}

/**
 * Assist probability for a made field goal on a passed possession. Anchored
 * so a passer at the population anchor rating converts at the era assist
 * rate, then modulated by creation ability, the play type (rolls, cuts, and
 * transition finishes are real passes; post-ups and isolations rarely earn
 * an assist), the shot zone (rim finishes off passes convert as assists),
 * and the shooter's finishing at the zone. The anchor factor is hoisted per
 * game (a pure function of the profile).
 */
function assistProbability(
  ctx: TripContext,
  passer: SimulationPlayer,
  action: ActionType,
  zone: ShotZone,
  shooter: SimulationPlayer,
): number {
  const factor = 0.5 + (passer.ratings.passing - 50) / 100;
  const roleFactor = passer.anchors
    ? 0.75 + Math.min(1, passer.anchors.assistsPerGame / 8) * 0.25
    : 1;
  // Creation spreads the conversion: real playmakers turn more of their
  // passes into assists than role players do.
  const creation = 0.6 + 0.7 * creationScore(passer);
  const actionFactor =
    action === 'transition'
      ? 1.25
      : action === 'cut'
        ? 1.2
        : action === 'pickAndRollRoll'
          ? 1.25
          : action === 'spotUp'
            ? 1.15
            : action === 'pickAndRoll'
              ? 1.1
              : action === 'postUp'
                ? 0.85
                : 0.5;
  const zoneFactor =
    zone === 'rim'
      ? 1.15
      : zone === 'shortMid'
        ? 1.05
        : zone === 'longMid'
          ? 0.95
          : zone === 'cornerThree'
            ? 1.1
            : 1;
  const finishing = 0.9 + 0.2 * (zoneSkillRating(shooter, zone) / 100);
  return Math.min(
    0.99,
    Math.max(
      0.05,
      ctx.profile.parameters.assistRate *
        0.95 *
        roleFactor *
        creation *
        actionFactor *
        zoneFactor *
        finishing *
        (factor / Math.max(1e-9, ctx.passingAnchorFactor)),
    ),
  );
}

/** Records one assist for an actual passer after a made basket. The pass
 * opportunity belongs to the credited passer, so every assist is backed by
 * an opportunity for the same player. */
function creditAssist(
  ctx: TripContext,
  offenseSide: SideIndex,
  team: SimulationTeam,
  shooter: SimulationPlayer,
  initiator: SimulationPlayer,
  action: ActionType,
  zone: ShotZone,
  passed: boolean,
): void {
  if (!passed) return;
  const passer = pickAssister(team, shooter, initiator, ctx.rng);
  if (!passer) return;
  const slot = ctx.preps[offenseSide].slotByPlayerId.get(passer.playerId) ?? -1;
  if (slot < 0) return;
  ctx.recorder.assistOpportunity(offenseSide, slot);
  if (!ctx.rng.chance(assistProbability(ctx, passer, action, zone, shooter))) return;
  ctx.recorder.assist(offenseSide, slot);
}

/** Marks one miss as a rebound opportunity for every player on both sides. */
function reboundChances(ctx: TripContext, offenseSide: SideIndex, defenseSide: SideIndex): void {
  ctx.recorder.offensiveReboundChance(offenseSide);
  ctx.recorder.defensiveReboundChance(defenseSide);
}

/** Resolves a missed last free throw (live or dead-ball rebound). */
function reboundFromMissedFreeThrow(
  ctx: TripContext,
  offenseSide: SideIndex,
  defenseSide: SideIndex,
  deadBall: boolean,
): void {
  reboundChances(ctx, offenseSide, defenseSide);
  const result = resolveRebound(
    ctx.rng,
    ctx.preps[offenseSide].offensiveReboundMean,
    ctx.preps[defenseSide].defensiveReboundMean,
    'rim',
    ctx.profile,
    deadBall,
  );
  if (result.team) {
    ctx.recorder.teamRebound(defenseSide);
    return;
  }
  const offensive = result.offensive;
  const side = offensive ? offenseSide : defenseSide;
  const team = ctx.teams[side];
  const prep = ctx.preps[side];
  const rebounder = pickRebounder(team.players, prep.rebounderWeights[offensive ? 0 : 1], ctx.rng);
  const slot = prep.slotByPlayerId.get(rebounder.playerId) ?? -1;
  if (offensive) {
    ctx.recorder.offensiveRebound(offenseSide, slot >= 0 ? slot : 0);
  } else {
    ctx.recorder.defensiveRebound(defenseSide, slot >= 0 ? slot : 0);
  }
}

/**
 * Resolves free throws after a foul. The trip always ends after free throws;
 * each attempt consumes free-throw seconds from the clock.
 */
function resolveFreeThrows(
  ctx: TripContext,
  offenseSide: SideIndex,
  defenseSide: SideIndex,
  shooterSlot: number,
  attempts: number,
  deadBall: boolean,
): void {
  const { rng, recorder } = ctx;
  const shooter = ctx.teams[offenseSide].players[shooterSlot]!;
  for (let i = 0; i < attempts; i += 1) {
    const last = i === attempts - 1;
    const p = freeThrowProbabilityFor(ctx, shooter);
    const made = rng.chance(p);
    recorder.freeThrow(offenseSide, shooterSlot, made);
    consumeTime(ctx.state, 1);
    if (last && !made) {
      reboundFromMissedFreeThrow(ctx, offenseSide, defenseSide, deadBall);
      consumeTime(ctx.state, 2);
    } else if (!made) {
      // A missed non-final free throw is a declared dead-ball miss: the
      // defensive team takes the rebound before the next attempt.
      reboundChances(ctx, offenseSide, defenseSide);
      recorder.teamRebound(defenseSide);
    }
  }
  recorder.freeThrowTrip(offenseSide);
}

/**
 * Resolves one shot attempt. Returns true when an offensive rebound keeps the
 * trip alive; every shot outcome consumes the relevant clock.
 */
function resolveShot(
  ctx: TripContext,
  offenseSide: SideIndex,
  defenseSide: SideIndex,
  deadBall: boolean,
): boolean {
  const { rng, recorder, state, profile } = ctx;
  const team = ctx.teams[offenseSide];
  const teamPrep = ctx.preps[offenseSide];
  const defense = ctx.teams[defenseSide];
  const defensePrep = ctx.preps[defenseSide];

  const initiator = pickInitiator(team, teamPrep.initiatorWeights, rng);
  const action = pickAction(initiator, teamPrep.actionWeights.get(initiator.playerId)!, rng);
  const shot = pickShot(teamPrep.teammateShots.get(initiator.playerId)!, initiator, action, rng);
  const shooter = shot.shooter;
  const zone = pickZone(action, teamPrep.zonePrep.get(shooter.playerId)!, rng);
  const defender = pickDefender(defense, shooter, zone, rng);

  const shooterSlot = teamPrep.slotByPlayerId.get(shooter.playerId) ?? -1;
  const three = isThreePointZone(zone);
  const defenderSlot = defensePrep.slotByPlayerId.get(defender.playerId) ?? -1;
  if (defenderSlot >= 0) recorder.contest(defenseSide, defenderSlot);

  const shotPrep: ShotPrep = {
    spacing: teamPrep.spacing,
    twoPointAnchor: teamPrep.twoPointAnchor.get(shooter.playerId) ?? null,
  };

  // Shooting foul check (zone-aware, ability-aware).
  const foulP = shootingFoulProbability(shooter, defender, zone, profile);
  if (rng.chance(foulP)) {
    recorder.foul(defenseSide, defenderSlot >= 0 ? defenderSlot : 0);
    const shotP =
      makeProbability(shooter, defender, profile, zone, action, state.secondsRemaining, shotPrep) *
      ENGINE_CONSTANTS.fouledShotMakeScale;
    const made = rng.chance(shotP);
    recorder.fieldGoalAttempt(offenseSide, shooterSlot, zone, made, three, shot.passed);
    if (made) {
      creditAssist(ctx, offenseSide, team, shooter, initiator, action, zone, shot.passed);
      // And-one free throw.
      resolveFreeThrows(ctx, offenseSide, defenseSide, shooterSlot, 1, false);
    } else {
      // The missed shot on a shooting foul is a declared dead-ball miss:
      // the defensive team takes the rebound, then free throws resolve.
      reboundChances(ctx, offenseSide, defenseSide);
      recorder.teamRebound(defenseSide);
      resolveFreeThrows(
        ctx,
        offenseSide,
        defenseSide,
        shooterSlot,
        freeThrowsForZone(zone),
        deadBall,
      );
    }
    return false; // free-throw trips always change possession
  }

  // Block check (a block forces a miss, then a normal rebound).
  const blockP = blockProbability(defender, zone, action);
  if (rng.chance(blockP)) {
    recorder.block(defenseSide, defenderSlot >= 0 ? defenderSlot : 0);
    recorder.fieldGoalAttempt(offenseSide, shooterSlot, zone, false, three, shot.passed);
    return reboundAfterMiss(ctx, offenseSide, defenseSide, zone, deadBall);
  }

  // Shot resolution.
  const shotP = makeProbability(
    shooter,
    defender,
    profile,
    zone,
    action,
    state.secondsRemaining,
    shotPrep,
  );
  const made = rng.chance(shotP);
  recorder.fieldGoalAttempt(offenseSide, shooterSlot, zone, made, three, shot.passed);
  if (made) {
    creditAssist(ctx, offenseSide, team, shooter, initiator, action, zone, shot.passed);
    return false; // made basket changes possession
  }
  return reboundAfterMiss(ctx, offenseSide, defenseSide, zone, deadBall);
}

/** Resolves a rebound after a missed field goal; true keeps the trip alive. */
function reboundAfterMiss(
  ctx: TripContext,
  offenseSide: SideIndex,
  defenseSide: SideIndex,
  zone: ShotZone,
  deadBall: boolean,
): boolean {
  const { rng, recorder } = ctx;
  reboundChances(ctx, offenseSide, defenseSide);
  const result = resolveRebound(
    rng,
    ctx.preps[offenseSide].offensiveReboundMean,
    ctx.preps[defenseSide].defensiveReboundMean,
    zone,
    ctx.profile,
    deadBall,
  );
  if (result.team) {
    recorder.teamRebound(defenseSide);
    return false;
  }
  if (result.offensive) {
    const prep = ctx.preps[offenseSide];
    const rebounder = pickRebounder(ctx.teams[offenseSide].players, prep.rebounderWeights[0], rng);
    const slot = prep.slotByPlayerId.get(rebounder.playerId) ?? -1;
    recorder.offensiveRebound(offenseSide, slot >= 0 ? slot : 0);
    return true;
  }
  const prep = ctx.preps[defenseSide];
  const rebounder = pickRebounder(ctx.teams[defenseSide].players, prep.rebounderWeights[1], rng);
  const slot = prep.slotByPlayerId.get(rebounder.playerId) ?? -1;
  recorder.defensiveRebound(defenseSide, slot >= 0 ? slot : 0);
  return false;
}

/** Team foul count in the current period for the defending side. */
function teamInBonus(foulsInPeriod: number, overtime: boolean): boolean {
  const limit = overtime
    ? ENGINE_CONSTANTS.bonusFoulsOvertime
    : ENGINE_CONSTANTS.bonusFoulsRegulation;
  return foulsInPeriod >= limit;
}

/**
 * Resolves one offensive trip for `offenseSide`. Consumes clock through the
 * shared game state and reports consumed seconds and possession change.
 */
export function resolveTrip(ctx: TripContext, offenseSide: SideIndex): TripResolution {
  const { rng, recorder, state, profile, teams, preps } = ctx;
  const defenseSide = (1 - offenseSide) as SideIndex;
  const defense = teams[defenseSide];
  const defensePrep = preps[defenseSide];
  const team = teams[offenseSide];
  const teamPrep = preps[offenseSide];
  const overtime = state.periodIndex >= 4;
  const startedRemaining = state.secondsRemaining;

  const sampled = sampleTripSeconds(rng, profile, state.secondsRemaining, ctx.meanTripSeconds);
  if (sampled === null) return { secondsElapsed: 0, ended: false };
  const consumedBase = consumeTime(state, sampled);
  const deadBall = consumedBase >= startedRemaining - ENGINE_CONSTANTS.minimumStartSeconds;

  // Ball security check.
  const handler = pickInitiator(team, teamPrep.initiatorWeights, rng);
  const handlerSlot = teamPrep.slotByPlayerId.get(handler.playerId) ?? -1;
  if (
    rng.chance(
      turnoverProbability(handler, defensePrep.pressure, ctx.eraPossEstimatePerTrip, profile),
    )
  ) {
    recorder.turnover(offenseSide, handlerSlot >= 0 ? handlerSlot : 0);
    if (isSteal(rng, defensePrep.stealAbility, profile)) {
      const stealer = pickStealer(defense.players, defensePrep.stealerWeights, rng);
      const stealerSlot = defensePrep.slotByPlayerId.get(stealer.playerId) ?? -1;
      recorder.steal(defenseSide, stealerSlot >= 0 ? stealerSlot : 0);
    }
    recorder.possession(offenseSide);
    return { secondsElapsed: startedRemaining - state.secondsRemaining, ended: true };
  }

  // Non-shooting foul checks stay inside the same trip: a non-bonus foul
  // consumes inbound seconds and the possession continues without a new
  // duration sample or an extra possession count.
  for (let guard = 0; guard < 4; guard += 1) {
    if (!rng.chance(nonShootingFoulProbability(profile))) break;
    const fouler = pickFouler(defense.players, defensePrep.foulerWeights, rng);
    const foulerSlot = defensePrep.slotByPlayerId.get(fouler.playerId) ?? -1;
    recorder.foul(defenseSide, foulerSlot >= 0 ? foulerSlot : 0);
    state.periodFouls[defenseSide] += 1;
    if (teamInBonus(state.periodFouls[defenseSide], overtime)) {
      const shooter = pickFreeThrowShooter(team.players, teamPrep.freeThrowShooterWeights, rng);
      const shooterSlot = teamPrep.slotByPlayerId.get(shooter.playerId) ?? -1;
      resolveFreeThrows(ctx, offenseSide, defenseSide, shooterSlot, 2, deadBall);
      recorder.possession(offenseSide);
      return { secondsElapsed: startedRemaining - state.secondsRemaining, ended: true };
    }
    consumeTime(state, 2);
  }

  // Shot resolution with possible offensive-rebound continuations.
  let continues = resolveShot(ctx, offenseSide, defenseSide, deadBall);
  let continuations = 0;
  let sealed = false;
  while (continues && continuations < 4) {
    continuations += 1;
    consumeTime(state, 3);
    if (state.secondsRemaining < ENGINE_CONSTANTS.minimumStartSeconds) {
      // The period ends with the offensive rebound: the trip is sealed.
      recorder.possession(offenseSide);
      sealed = true;
      continues = false;
      break;
    }
    continues = resolveShot(ctx, offenseSide, defenseSide, false);
  }
  if (!sealed && !continues) {
    // Trip ended by a made basket, defensive/team rebound, block rebound, or free throws.
    recorder.possession(offenseSide);
  }
  if (continues) {
    // Continuation guard reached; seal the trip to avoid unbounded loops.
    recorder.possession(offenseSide);
  }
  return { secondsElapsed: startedRemaining - state.secondsRemaining, ended: true };
}
