import type {
  EraSimulationProfile,
  ShotZone,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import type { Rng } from './rng.js';
import { GameRecorder, type SideIndex } from './recorder.js';
import { sampleTripSeconds } from './timing.js';
import {
  pickAction,
  pickDefender,
  pickInitiator,
  pickAssister,
  pickShot,
  pickZone,
  isThreePointZone,
} from './usage.js';
import { isSteal, pickStealer, turnoverProbability } from './security.js';
import { blockProbability, makeProbability, type ShotContext } from './shooting.js';
import {
  freeThrowsForZone,
  freeThrowProbability,
  nonShootingFoulProbability,
  pickFouler,
  pickFreeThrowShooter,
  shootingFoulProbability,
} from './fouls.js';
import { pickRebounder, resolveRebound } from './rebounding.js';
import { ENGINE_CONSTANTS } from './constants.js';

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

interface TripContext {
  rng: Rng;
  recorder: GameRecorder;
  state: GameState;
  profile: EraSimulationProfile;
  teams: [SimulationTeam, SimulationTeam];
}

function ctxFor(
  rng: Rng,
  recorder: GameRecorder,
  state: GameState,
  profile: EraSimulationProfile,
  teams: [SimulationTeam, SimulationTeam],
): TripContext {
  return { rng, recorder, state, profile, teams };
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

/** Assister probability for a made field goal, anchored so a passer at the
 * population anchor rating converts at the era assist rate. */
function assistProbability(passer: SimulationPlayer, profile: EraSimulationProfile): number {
  const factor = (p: SimulationPlayer) => 0.5 + (p.ratings.passing - 50) / 100;
  const anchor = factor({
    ratings: { passing: profile.parameters.assistAnchorRating },
  } as SimulationPlayer);
  const roleFactor = passer.anchors
    ? 0.75 + Math.min(1, passer.anchors.assistsPerGame / 8) * 0.25
    : 1;
  return Math.min(
    0.95,
    Math.max(
      0.1,
      profile.parameters.assistRate * 1.45 * roleFactor * (factor(passer) / Math.max(1e-9, anchor)),
    ),
  );
}

/** Records one assist for an actual passer after a made basket. */
function creditAssist(
  ctx: TripContext,
  offenseSide: SideIndex,
  team: SimulationTeam,
  shooter: SimulationPlayer,
  initiator: SimulationPlayer,
  passed: boolean,
): void {
  if (!passed) return;
  const passer = pickAssister(team, shooter, initiator, ctx.rng);
  if (!passer || !ctx.rng.chance(assistProbability(passer, ctx.profile))) return;
  const slot = team.players.findIndex((p) => p.playerId === passer.playerId);
  if (slot >= 0) ctx.recorder.assist(offenseSide, slot);
}

/** Resolves a missed last free throw (live or dead-ball rebound). */
function reboundFromMissedFreeThrow(
  ctx: TripContext,
  offenseSide: SideIndex,
  defenseSide: SideIndex,
  deadBall: boolean,
): void {
  const result = resolveRebound(
    ctx.rng,
    ctx.teams[offenseSide],
    ctx.teams[defenseSide],
    'rim',
    ctx.profile,
    deadBall,
  );
  if (result.team) {
    ctx.recorder.teamRebound(defenseSide);
    return;
  }
  const offensive = result.offensive;
  const team = ctx.teams[offensive ? offenseSide : defenseSide];
  const rebounder = pickRebounder(team, offensive, ctx.rng);
  const slot = team.players.findIndex((p) => p.playerId === rebounder.playerId);
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
  const defense = ctx.teams[defenseSide];

  const initiator = pickInitiator(team, rng);
  const action = pickAction(initiator, rng);
  const shot = pickShot(team, initiator, action, rng);
  const shooter = shot.shooter;
  const zone = pickZone(shooter, action, profile, rng);
  const defender = pickDefender(defense, shooter, zone, rng);

  const shooterSlot = team.players.findIndex((p) => p.playerId === shooter.playerId);
  const three = isThreePointZone(zone);

  // Shooting foul check (zone-aware, ability-aware).
  const foulP = shootingFoulProbability(shooter, defender, zone, profile);
  if (rng.chance(foulP)) {
    const defenderSlot = defense.players.findIndex((p) => p.playerId === defender.playerId);
    recorder.foul(defenseSide, defenderSlot >= 0 ? defenderSlot : 0);
    const shotContext: ShotContext = {
      zone,
      action,
      secondsRemainingAtShot: state.secondsRemaining,
    };
    const shotP =
      makeProbability(shooter, defender, profile, shotContext, state.secondsRemaining) *
      ENGINE_CONSTANTS.fouledShotMakeScale;
    const made = rng.chance(shotP);
    recorder.fieldGoalAttempt(offenseSide, shooterSlot, zone, made, three);
    if (made) {
      creditAssist(ctx, offenseSide, team, shooter, initiator, shot.passed);
      // And-one free throw.
      resolveFreeThrows(ctx, offenseSide, defenseSide, shooterSlot, 1, false);
    } else {
      // The missed shot on a shooting foul is a declared dead-ball miss:
      // the defensive team takes the rebound, then free throws resolve.
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
    const defenderSlot = defense.players.findIndex((p) => p.playerId === defender.playerId);
    recorder.block(defenseSide, defenderSlot >= 0 ? defenderSlot : 0);
    recorder.fieldGoalAttempt(offenseSide, shooterSlot, zone, false, three);
    return reboundAfterMiss(ctx, offenseSide, defenseSide, zone, deadBall);
  }

  // Shot resolution.
  const shotContext: ShotContext = { zone, action, secondsRemainingAtShot: state.secondsRemaining };
  const shotP = makeProbability(shooter, defender, profile, shotContext, state.secondsRemaining);
  const made = rng.chance(shotP);
  recorder.fieldGoalAttempt(offenseSide, shooterSlot, zone, made, three);
  if (made) {
    creditAssist(ctx, offenseSide, team, shooter, initiator, shot.passed);
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
  const result = resolveRebound(
    rng,
    ctx.teams[offenseSide],
    ctx.teams[defenseSide],
    zone,
    ctx.profile,
    deadBall,
  );
  if (result.team) {
    recorder.teamRebound(defenseSide);
    return false;
  }
  if (result.offensive) {
    const rebounder = pickRebounder(ctx.teams[offenseSide], true, rng);
    const slot = ctx.teams[offenseSide].players.findIndex((p) => p.playerId === rebounder.playerId);
    recorder.offensiveRebound(offenseSide, slot >= 0 ? slot : 0);
    return true;
  }
  const rebounder = pickRebounder(ctx.teams[defenseSide], false, rng);
  const slot = ctx.teams[defenseSide].players.findIndex((p) => p.playerId === rebounder.playerId);
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
export function resolveTrip(
  rng: Rng,
  recorder: GameRecorder,
  state: GameState,
  profile: EraSimulationProfile,
  teams: [SimulationTeam, SimulationTeam],
  offenseSide: SideIndex,
): TripResolution {
  const defenseSide = (1 - offenseSide) as SideIndex;
  const defense = teams[defenseSide];
  const team = teams[offenseSide];
  const overtime = state.periodIndex >= 4;
  const startedRemaining = state.secondsRemaining;

  const sampled = sampleTripSeconds(rng, profile, state.secondsRemaining);
  if (sampled === null) return { secondsElapsed: 0, ended: false };
  const consumedBase = consumeTime(state, sampled);
  const deadBall = consumedBase >= startedRemaining - ENGINE_CONSTANTS.minimumStartSeconds;

  // Ball security check.
  const handler = pickInitiator(team, rng);
  const handlerSlot = team.players.findIndex((p) => p.playerId === handler.playerId);
  if (rng.chance(turnoverProbability(handler, defense, profile))) {
    recorder.turnover(offenseSide, handlerSlot >= 0 ? handlerSlot : 0);
    if (isSteal(rng, defense, profile)) {
      const stealer = pickStealer(defense, rng);
      const stealerSlot = defense.players.findIndex((p) => p.playerId === stealer.playerId);
      recorder.steal(defenseSide, stealerSlot >= 0 ? stealerSlot : 0);
    }
    recorder.possession(offenseSide);
    return { secondsElapsed: startedRemaining - state.secondsRemaining, ended: true };
  }

  // Non-shooting foul checks stay inside the same trip: a non-bonus foul
  // consumes inbound seconds and the possession continues without a new
  // duration sample or an extra possession count.
  const ctx = ctxFor(rng, recorder, state, profile, teams);
  for (let guard = 0; guard < 4; guard += 1) {
    if (!rng.chance(nonShootingFoulProbability(profile))) break;
    const fouler = pickFouler(defense, rng);
    const foulerSlot = defense.players.findIndex((p) => p.playerId === fouler.playerId);
    recorder.foul(defenseSide, foulerSlot >= 0 ? foulerSlot : 0);
    state.periodFouls[defenseSide] += 1;
    if (teamInBonus(state.periodFouls[defenseSide], overtime)) {
      const shooter = pickFreeThrowShooter(team, rng);
      const shooterSlot = team.players.findIndex((p) => p.playerId === shooter.playerId);
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
