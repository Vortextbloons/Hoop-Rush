import type {
  EraSimulationProfile,
  ShotZone,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import type { Rng } from './rng.ts';
import { GameRecorder, type SideIndex } from './recorder.ts';
import { meanTripSeconds, sampleTripSeconds } from './timing.ts';
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
} from './usage.ts';
import { eraPossEstimatePerTrip, isSteal, pickStealer, turnoverProbability } from './security.ts';
import { blockProbability, makeProbability, type ShotPrep } from './shooting.ts';
import {
  freeThrowsForZone,
  freeThrowProbability,
  nonShootingFoulProbability,
  pickFouler,
  pickFreeThrowShooter,
  shootingFoulProbability,
} from './fouls.ts';
import { pickRebounder, resolveRebound } from './rebounding.ts';
import { prepareTeamCached, enginePlayerKey, type TeamPrep } from './prepare.ts';
import { ENGINE_CONSTANTS } from './constants.ts';
import { creationScore } from '../domain/archetypes.ts';
import type { SeasonHomeCourtMechanisms } from '../season/home-court.ts';
import type { SeasonEffectsHook } from '../season/effects.ts';

/**
 * One offensive trip (spec/03 pipeline stages 1-9), executed as resumable
 * steps so a controller can pause at legal dead-ball boundaries (spec/2.0/04
 * M2.2): made baskets, completed foul/free-throw sequences, inbound-producing
 * fouls, dead-ball team rebounds, and period endings. Live turnovers, live
 * rebounds, and unresolved shot/free-throw sequences never pause. An and-one
 * made basket is followed immediately by its free throw; no step splits that
 * sequence. All clock consumption flows through `state.secondsRemaining`,
 * which the caller owns and seals per period.
 *
 * The step decomposition preserves the monolithic trip's RNG call order
 * exactly: each step performs one atomic unit of work in the original
 * sequence, so `resolveTrip` (the run-to-completion driver) is behavior- and
 * digest-identical to the pre-M2.2 engine, and the Season controller that
 * pauses between steps consumes RNG only through this same pipeline.
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

/**
 * Fresh game state. The clock is initialized by the game loop immediately
 * after creation (game.ts), so this factory takes no inputs.
 */
export function createGameState(): GameState {
  return {
    periodFouls: [0, 0],
    periodIndex: 0,
    secondsRemaining: 0,
  };
}

/**
 * Shared per-game trip context. Constructed once per game and passed by
 * reference: the RNG, recorder, state, teams, and all per-team preparation
 * tables are game-stable, so no trip rebuilds them. Season Run substitutes by
 * replacing `teams[side]` and `preps[side]` at a legal boundary; rebuilding
 * consumes no RNG (prepareTeam is pure).
 */
export interface TripContext {
  rng: Rng;
  recorder: GameRecorder;
  state: GameState;
  profile: EraSimulationProfile;
  teams: [SimulationTeam, SimulationTeam];
  /**
   * Per-side playerVersionId arrays mirroring `teams` (the current on-court
   * five for Season Run, the full roster for Classic). Hoisted so the
   * effects hook never rebuilds them per trip; the Season controller keeps
   * them in sync when a substitution replaces `teams[side]`.
   */
  teamUnits: [readonly string[], readonly string[]];
  /** Per-team per-game weight and lookup tables, in side order. */
  preps: [TeamPrep, TeamPrep];
  /** Hoisted game scalars (pure functions of the profile). */
  meanTripSeconds: number;
  eraPossEstimatePerTrip: number;
  passingAnchorFactor: number;
  /**
   * M2.3 home-court mechanisms (season-home-court-v1). Absent for Classic
   * and neutral Season games: both adjustments are zero and every draw and
   * probability is byte-identical to the M2.2 engine. The season controller
   * computes the signed, bounded adjustments from the versioned profile.
   */
  homeCourt?: SeasonHomeCourtMechanisms;
  /**
   * M2.4 stamina/chemistry effects hook (season-stamina-v1 +
   * season-chemistry-v1). Absent for Classic and neutral Season games: every
   * adjustment is exactly +0, no extra RNG draw exists, and all probabilities
   * stay byte-identical to the M2.3 engine. The season controller builds the
   * hook from the versioned effects state via `createSeasonEffectsBuffer`.
   */
  effects?: SeasonEffectsHook;
}

/** Builds the shared per-game trip context (state mutates in place; the rest is stable). */
export function createTripContext(
  rng: Rng,
  recorder: GameRecorder,
  state: GameState,
  profile: EraSimulationProfile,
  teams: [SimulationTeam, SimulationTeam],
  homeCourt?: SeasonHomeCourtMechanisms,
  effects?: SeasonEffectsHook,
): TripContext {
  return {
    rng,
    recorder,
    state,
    profile,
    teams,
    teamUnits: [unitVersionIdsOf(teams[0]), unitVersionIdsOf(teams[1])],
    preps: [prepareTeamCached(teams[0], profile), prepareTeamCached(teams[1], profile)],
    meanTripSeconds: meanTripSeconds(profile),
    eraPossEstimatePerTrip: eraPossEstimatePerTrip(profile) ?? 1,
    passingAnchorFactor: 0.5 + (profile.parameters.assistAnchorRating - 50) / 100,
    ...(homeCourt !== undefined ? { homeCourt } : {}),
    ...(effects !== undefined ? { effects } : {}),
  };
}

/**
 * Outcome of one atomic step of the trip machine.
 *
 * - `ended`: the trip is over and possession changed.
 * - `pause`: a legal dead-ball substitution boundary was reached. True for
 *   made baskets, completed foul/free-throw sequences, inbound-producing
 *   fouls (trip continues), dead-ball team rebounds, and period endings;
 *   false for live turnovers, live rebounds, and unresolved sequences.
 * - `periodEnded`: the game clock is exhausted or the trip was sealed with an
 *   offensive rebound below the minimum start time; the caller must end the
 *   period.
 * - `finished`: no further steps exist for this trip.
 */
export interface PossessionStep {
  ended: boolean;
  pause: boolean;
  periodEnded: boolean;
  finished: boolean;
}

/**
 * Resumable trip executor. Construct once per trip, call `step()` until a
 * finished or periodEnded step; a pause step returns control to the caller
 * (the Season controller may substitute), and the next `step()` resumes the
 * same trip. The RNG draw sequence matches the pre-M2.2 monolithic trip
 * exactly, regardless of how many steps the caller lets run.
 */
export class PossessionStepper {
  private phase: 'sample' | 'security' | 'foul' | 'inbound' | 'shot' | 'continuation' | 'done' =
    'sample';
  private foulIndex = 0;
  private continuations = 0;
  private deadBall = false;
  private readonly ctx: TripContext;
  private readonly offenseSide: SideIndex;
  private readonly startedRemaining: number;
  private finalStep: PossessionStep | null = null;
  /** M2.4 trip facts for the effects hook (stashed by the pipeline steps). */
  private handlerVersion: string | undefined;
  private shooterVersion: string | undefined;
  private defenderVersion: string | undefined;
  private readonly tripRebounds: [number, number] = [0, 0];

  constructor(ctx: TripContext, offenseSide: SideIndex) {
    this.ctx = ctx;
    this.offenseSide = offenseSide;
    this.startedRemaining = ctx.state.secondsRemaining;
  }

  /** Advances exactly one atomic unit of work and reports its boundary. */
  step(): PossessionStep {
    if (this.phase === 'done') {
      if (this.finalStep === null) {
        throw new Error('possession: stepper finished without a terminal step');
      }
      return this.finalStep;
    }
    switch (this.phase) {
      case 'sample':
        return this.stepSample();
      case 'security':
        return this.stepSecurity();
      case 'foul':
        return this.stepFoulCheck();
      case 'inbound': {
        consumeTime(this.ctx.state, 2);
        this.phase = 'foul';
        return { ended: false, pause: false, periodEnded: false, finished: false };
      }
      case 'shot':
        return this.stepShot();
      case 'continuation':
        return this.stepContinuation();
    }
    throw new Error(`possession: unknown stepper phase ${String(this.phase)}`);
  }

  private stepSample(): PossessionStep {
    const { rng, state, profile } = this.ctx;
    const sampled = sampleTripSeconds(
      rng,
      profile,
      state.secondsRemaining,
      this.ctx.meanTripSeconds,
    );
    if (sampled === null) {
      // Period has less than the minimum start time left: it ends without a trip.
      return this.finish({ ended: false, pause: true, periodEnded: true });
    }
    const consumedBase = consumeTime(state, sampled);
    this.deadBall = consumedBase >= this.startedRemaining - ENGINE_CONSTANTS.minimumStartSeconds;
    this.phase = 'security';
    return { ended: false, pause: false, periodEnded: false, finished: false };
  }

  private stepSecurity(): PossessionStep {
    const { rng, recorder, teams, preps } = this.ctx;
    const offense = this.offenseSide;
    const defense = (1 - offense) as SideIndex;
    const team = teams[offense];
    const teamPrep = preps[offense];
    const defensePrep = preps[defense];

    const handler = pickInitiator(team, teamPrep.initiatorWeights, rng);
    const handlerSlot = teamPrep.slotByPlayerId.get(enginePlayerKey(handler)) ?? -1;
    this.handlerVersion = handler.playerVersionId;
    // M2.3 away-turnover-pressure mechanism: the away offense faces a small
    // bounded turnover-probability increase (zero under the neutral profile).
    const awayTurnoverPressure =
      this.offenseSide === 1 ? (this.ctx.homeCourt?.awayTurnoverPressureAdjustment ?? 0) : 0;
    // M2.4 effects: handler fatigue and unit chemistry adjust the turnover
    // probability in bounded steps (zero when the hook is absent).
    const effectsAdjustment =
      this.ctx.effects?.turnoverAdjustment({
        handlerVersion: simulationPlayerVersion(handler),
        offenseSide: offense,
      }) ?? 0;
    if (
      rng.chance(
        turnoverProbability(
          handler,
          defensePrep.pressure,
          this.ctx.eraPossEstimatePerTrip,
          this.ctx.profile,
          awayTurnoverPressure,
          effectsAdjustment / 1_000_000,
        ),
      )
    ) {
      recorder.turnover(offense, handlerSlot >= 0 ? handlerSlot : 0);
      if (isSteal(rng, defensePrep.stealAbility, this.ctx.profile)) {
        const stealer = pickStealer(teams[defense].players, defensePrep.stealerWeights, rng);
        const stealerSlot = defensePrep.slotByPlayerId.get(enginePlayerKey(stealer)) ?? -1;
        recorder.steal(defense, stealerSlot >= 0 ? stealerSlot : 0);
      }
      recorder.possession(offense);
      // A live turnover changes possession without a stoppage: no pause.
      return this.endedStep(false);
    }
    this.phase = 'foul';
    return { ended: false, pause: false, periodEnded: false, finished: false };
  }

  private stepFoulCheck(): PossessionStep {
    const { rng, recorder, state, teams, preps, profile } = this.ctx;
    const offense = this.offenseSide;
    const defense = (1 - offense) as SideIndex;
    if (this.foulIndex >= 4) {
      this.phase = 'shot';
      return { ended: false, pause: false, periodEnded: false, finished: false };
    }
    this.foulIndex += 1;
    if (!rng.chance(nonShootingFoulProbability(profile))) {
      this.phase = 'shot';
      return { ended: false, pause: false, periodEnded: false, finished: false };
    }
    const defenseTeam = teams[defense];
    const defensePrep = preps[defense];
    const fouler = pickFouler(defenseTeam.players, defensePrep.foulerWeights, rng);
    const foulerSlot = defensePrep.slotByPlayerId.get(enginePlayerKey(fouler)) ?? -1;
    recorder.foul(defense, foulerSlot >= 0 ? foulerSlot : 0);
    state.periodFouls[defense] += 1;
    if (teamInBonus(state.periodFouls[defense], state.periodIndex >= 4)) {
      const team = teams[offense];
      const teamPrep = preps[offense];
      const shooter = pickFreeThrowShooter(team.players, teamPrep.freeThrowShooterWeights, rng);
      const shooterSlot = teamPrep.slotByPlayerId.get(enginePlayerKey(shooter)) ?? -1;
      resolveFreeThrows(
        this.ctx,
        offense,
        defense,
        shooterSlot,
        2,
        this.deadBall,
        this.tripRebounds,
      );
      recorder.possession(offense);
      // Completed free-throw sequence: legal dead-ball pause.
      return this.endedStep(true);
    }
    // Inbound-producing non-bonus foul: legal pause; the trip continues.
    this.phase = 'inbound';
    return { ended: false, pause: true, periodEnded: false, finished: false };
  }

  private stepShot(): PossessionStep {
    const { recorder } = this.ctx;
    const offense = this.offenseSide;
    const defense = (1 - offense) as SideIndex;
    const outcome = resolveShot(this.ctx, offense, defense, this.deadBall, this.tripRebounds);
    this.shooterVersion = outcome.shooterVersion;
    this.defenderVersion = outcome.defenderVersion;
    if (!outcome.continues) {
      recorder.possession(offense);
      // Made baskets, completed shooting-foul free throws, and dead-ball
      // team rebounds pause; a live defensive rebound does not.
      return this.endedStep(!outcome.liveReboundEnd);
    }
    if (this.continuations >= 4) {
      // Continuation guard reached: seal the trip to avoid unbounded loops.
      recorder.possession(offense);
      return this.endedStep(false);
    }
    this.phase = 'continuation';
    return { ended: false, pause: false, periodEnded: false, finished: false };
  }

  private stepContinuation(): PossessionStep {
    const { recorder, state } = this.ctx;
    const offense = this.offenseSide;
    this.continuations += 1;
    consumeTime(state, 3);
    if (state.secondsRemaining < ENGINE_CONSTANTS.minimumStartSeconds) {
      // The period ends with the offensive rebound: the trip is sealed.
      recorder.possession(offense);
      this.recordTrip();
      return this.finish({ ended: true, pause: true, periodEnded: true });
    }
    this.phase = 'shot';
    return { ended: false, pause: false, periodEnded: false, finished: false };
  }

  private endedStep(pause: boolean): PossessionStep {
    this.recordTrip();
    return this.finish({
      ended: true,
      pause,
      periodEnded: this.ctx.state.secondsRemaining <= 0,
    });
  }

  /**
   * M2.4: reports the completed trip's facts to the effects hook exactly
   * once per trip (no-op when the hook is absent). Consumes no RNG.
   */
  private recordTrip(): void {
    const effects = this.ctx.effects;
    if (effects === undefined) return;
    if (this.handlerVersion === undefined) {
      throw new Error('possession: effects trip facts require a recorded handler');
    }
    effects.recordTrip({
      homeUnit: this.ctx.teamUnits[0],
      awayUnit: this.ctx.teamUnits[1],
      handler: this.handlerVersion,
      ...(this.shooterVersion !== undefined ? { shooter: this.shooterVersion } : {}),
      ...(this.defenderVersion !== undefined ? { defender: this.defenderVersion } : {}),
      reboundContestCounts: this.tripRebounds,
    });
  }

  private finish(step: Omit<PossessionStep, 'finished'>): PossessionStep {
    const result: PossessionStep = { ...step, finished: true };
    this.phase = 'done';
    this.finalStep = result;
    return result;
  }
}

/**
 * Runs one offensive trip to completion (the Classic fixed-five driver).
 * Pauses are legal boundaries, but this driver never observes them: lineups
 * are immutable in Classic, so the trip always finishes in the same RNG
 * sequence as the pre-M2.2 monolithic resolver.
 */
export function resolveTrip(ctx: TripContext, offenseSide: SideIndex): TripResolution {
  const startedRemaining = ctx.state.secondsRemaining;
  const stepper = new PossessionStepper(ctx, offenseSide);
  let step: PossessionStep = { ended: false, pause: false, periodEnded: false, finished: false };
  while (!step.periodEnded && !step.finished) {
    step = stepper.step();
  }
  return {
    secondsElapsed: startedRemaining - ctx.state.secondsRemaining,
    ended: step.ended,
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
 * The simulation player's authoritative version id. The effects hook only
 * exists in Season Run context, where every player carries a playerVersionId;
 * a missing id in an effects query is an invariant failure.
 */
function simulationPlayerVersion(player: SimulationPlayer): string {
  const version = player.playerVersionId;
  if (version === undefined) {
    throw new Error('possession: effects facts require a playerVersionId');
  }
  return version;
}

/**
 * playerVersionId array of a side's players (hoisted per game/unit). The
 * arrays are consumed only by the effects hook (Season Run, where every
 * player carries a version id); Classic players without an id map to the
 * empty string and are never read.
 */
function unitVersionIdsOf(team: SimulationTeam): readonly string[] {
  return team.players.map((player) => player.playerVersionId ?? '');
}

/**
 * Assist probability for a made field goal on a passed possession (pure;
 * shared by the sampled pipeline and the projection layer). Anchored so a
 * passer at the population anchor rating converts at the era assist rate,
 * then modulated by creation ability, the play type (rolls, cuts, and
 * transition finishes are real passes; post-ups and isolations rarely earn
 * an assist), the shot zone (rim finishes off passes convert as assists),
 * and the shooter's finishing at the zone.
 */
export function assistProbabilityPure(
  profile: EraSimulationProfile,
  passingAnchorFactor: number,
  passer: SimulationPlayer,
  action: ActionType,
  zone: ShotZone,
  shooter: SimulationPlayer,
  effectsAdjustment = 0,
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
      profile.parameters.assistRate *
        0.95 *
        roleFactor *
        creation *
        actionFactor *
        zoneFactor *
        finishing *
        (factor / Math.max(1e-9, passingAnchorFactor)) +
        effectsAdjustment,
    ),
  );
}

/** The sampled assist probability inside the per-game trip context. */
function assistProbability(
  ctx: TripContext,
  passer: SimulationPlayer,
  action: ActionType,
  zone: ShotZone,
  shooter: SimulationPlayer,
  effectsAdjustment = 0,
): number {
  return assistProbabilityPure(
    ctx.profile,
    ctx.passingAnchorFactor,
    passer,
    action,
    zone,
    shooter,
    effectsAdjustment,
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
  const slot = ctx.preps[offenseSide].slotByPlayerId.get(enginePlayerKey(passer)) ?? -1;
  if (slot < 0) return;
  ctx.recorder.assistOpportunity(offenseSide, slot);
  // M2.4 assist-conversion mechanism: unit chemistry raises the conversion
  // in a bounded step (zero when the hook is absent).
  const effectsAdjustment = ctx.effects?.assistAdjustment({ offenseSide }) ?? 0;
  if (
    !ctx.rng.chance(
      assistProbability(ctx, passer, action, zone, shooter, effectsAdjustment / 1_000_000),
    )
  ) {
    return;
  }
  ctx.recorder.assist(offenseSide, slot);
}

/** Marks one miss as a rebound opportunity for every player on both sides. */
function reboundChances(
  ctx: TripContext,
  offenseSide: SideIndex,
  defenseSide: SideIndex,
  reboundCounter: [number, number],
): void {
  ctx.recorder.offensiveReboundChance(offenseSide);
  ctx.recorder.defensiveReboundChance(defenseSide);
  reboundCounter[offenseSide] += 1;
  reboundCounter[defenseSide] += 1;
}

/** Resolves a missed last free throw (live or dead-ball rebound). */
function reboundFromMissedFreeThrow(
  ctx: TripContext,
  offenseSide: SideIndex,
  defenseSide: SideIndex,
  deadBall: boolean,
  reboundCounter: [number, number],
): void {
  reboundChances(ctx, offenseSide, defenseSide, reboundCounter);
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
  const slot = prep.slotByPlayerId.get(enginePlayerKey(rebounder)) ?? -1;
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
  reboundCounter: [number, number],
): void {
  const { rng, recorder } = ctx;
  const shooter = ctx.teams[offenseSide].players[shooterSlot];
  if (shooter === undefined) {
    throw new Error(`possession: no player at slot ${String(shooterSlot)}`);
  }
  for (let i = 0; i < attempts; i += 1) {
    const last = i === attempts - 1;
    const p = freeThrowProbabilityFor(ctx, shooter);
    const made = rng.chance(p);
    recorder.freeThrow(offenseSide, shooterSlot, made);
    consumeTime(ctx.state, 1);
    if (last && !made) {
      reboundFromMissedFreeThrow(ctx, offenseSide, defenseSide, deadBall, reboundCounter);
      consumeTime(ctx.state, 2);
    } else if (!made) {
      // A missed non-final free throw is a declared dead-ball miss: the
      // defensive team takes the rebound before the next attempt.
      reboundChances(ctx, offenseSide, defenseSide, reboundCounter);
      recorder.teamRebound(defenseSide);
    }
  }
  recorder.freeThrowTrip(offenseSide);
}

/** How one shot sequence ended, for the caller's boundary decision. */
interface ShotOutcome {
  /** True when an offensive rebound keeps the trip alive. */
  continues: boolean;
  /** True when the trip ended on a live defensive player rebound (no pause). */
  liveReboundEnd: boolean;
  /** M2.4 trip facts: the shot taker and primary defender of this shot. */
  shooterVersion?: string;
  defenderVersion?: string;
}

/**
 * Resolves one shot attempt as one atomic step. Returns the continuation and
 * boundary facts; every shot outcome consumes the relevant clock. An and-one
 * made basket is followed immediately by its free throw inside this step —
 * no pause splits the sequence.
 */
function resolveShot(
  ctx: TripContext,
  offenseSide: SideIndex,
  defenseSide: SideIndex,
  deadBall: boolean,
  reboundCounter: [number, number],
): ShotOutcome {
  const { rng, recorder, state, profile } = ctx;
  const team = ctx.teams[offenseSide];
  const teamPrep = ctx.preps[offenseSide];
  const defense = ctx.teams[defenseSide];
  const defensePrep = ctx.preps[defenseSide];

  const initiator = pickInitiator(team, teamPrep.initiatorWeights, rng);
  const actionWeights = teamPrep.actionWeights.get(enginePlayerKey(initiator));
  if (actionWeights === undefined) {
    throw new Error(`possession: no action weights for ${initiator.playerId}`);
  }
  const action = pickAction(initiator, actionWeights, rng);
  const teammateShots = teamPrep.teammateShots.get(enginePlayerKey(initiator));
  if (teammateShots === undefined) {
    throw new Error(`possession: no teammate shot table for ${initiator.playerId}`);
  }
  const shot = pickShot(teammateShots, initiator, action, rng);
  const shooter = shot.shooter;
  const zonePrep = teamPrep.zonePrep.get(enginePlayerKey(shooter));
  if (zonePrep === undefined) {
    throw new Error(`possession: no zone preparation for ${shooter.playerId}`);
  }
  const zone = pickZone(action, zonePrep, rng);
  const shooterSlot = teamPrep.slotByPlayerId.get(enginePlayerKey(shooter)) ?? -1;
  const defender = pickDefender(defense, zone, rng, defensePrep.defenderBase, shooterSlot);

  const three = isThreePointZone(zone);
  const defenderSlot = defensePrep.slotByPlayerId.get(enginePlayerKey(defender)) ?? -1;
  if (defenderSlot >= 0) recorder.contest(defenseSide, defenderSlot);

  const shotPrep: ShotPrep = {
    spacing: teamPrep.spacing,
    twoPointAnchor: teamPrep.twoPointAnchor.get(enginePlayerKey(shooter)) ?? null,
  };
  // M2.4 effects: shooter fatigue, defensive-unit fatigue, and help-defense
  // chemistry adjust the make probability in bounded steps (zero when the
  // hook is absent). Computed once per shot so evidence counts each shot once.
  const effectsAdjustment =
    ctx.effects?.makeAdjustment({
      shooterVersion: simulationPlayerVersion(shooter),
      offenseSide,
      defenseSide,
    }) ?? 0;
  const effectsAdjustmentFraction = effectsAdjustment / 1_000_000;

  // Shooting foul check (zone-aware, ability-aware).
  const foulP = shootingFoulProbability(shooter, defender, zone, profile);
  if (rng.chance(foulP)) {
    recorder.foul(defenseSide, defenderSlot >= 0 ? defenderSlot : 0);
    // M2.3 home defensive-communication mechanism: away shots against the
    // home defense convert at a small bounded lower rate (zero under the
    // neutral profile).
    const homeDefenseAdjustment =
      defenseSide === 0 ? (ctx.homeCourt?.homeDefenseShotAdjustment ?? 0) : 0;
    const shotP =
      makeProbability(
        shooter,
        defender,
        profile,
        zone,
        action,
        state.secondsRemaining,
        shotPrep,
        homeDefenseAdjustment,
        effectsAdjustmentFraction,
      ) * ENGINE_CONSTANTS.fouledShotMakeScale;
    const made = rng.chance(shotP);
    recorder.fieldGoalAttempt(offenseSide, shooterSlot, zone, made, three, shot.passed);
    if (made) {
      creditAssist(ctx, offenseSide, team, shooter, initiator, action, zone, shot.passed);
      // And-one free throw, resolved immediately (no pause between basket and FT).
      resolveFreeThrows(ctx, offenseSide, defenseSide, shooterSlot, 1, false, reboundCounter);
    } else {
      // The missed shot on a shooting foul is a declared dead-ball miss:
      // the defensive team takes the rebound, then free throws resolve.
      reboundChances(ctx, offenseSide, defenseSide, reboundCounter);
      recorder.teamRebound(defenseSide);
      resolveFreeThrows(
        ctx,
        offenseSide,
        defenseSide,
        shooterSlot,
        freeThrowsForZone(zone),
        deadBall,
        reboundCounter,
      );
    }
    // Free-throw trips always change possession at a dead-ball pause.
    return {
      continues: false,
      liveReboundEnd: false,
      shooterVersion: shooter.playerVersionId,
      defenderVersion: defender.playerVersionId,
    };
  }

  // Block check (a block forces a miss, then a normal rebound).
  const blockP = blockProbability(defender, zone, action);
  if (rng.chance(blockP)) {
    recorder.block(defenseSide, defenderSlot >= 0 ? defenderSlot : 0);
    recorder.fieldGoalAttempt(offenseSide, shooterSlot, zone, false, three, shot.passed);
    return reboundAfterMiss(
      ctx,
      offenseSide,
      defenseSide,
      zone,
      deadBall,
      reboundCounter,
      shooter.playerVersionId,
      defender.playerVersionId,
    );
  }

  // Shot resolution.
  const homeDefenseAdjustment =
    defenseSide === 0 ? (ctx.homeCourt?.homeDefenseShotAdjustment ?? 0) : 0;
  const shotP = makeProbability(
    shooter,
    defender,
    profile,
    zone,
    action,
    state.secondsRemaining,
    shotPrep,
    homeDefenseAdjustment,
    effectsAdjustmentFraction,
  );
  const made = rng.chance(shotP);
  recorder.fieldGoalAttempt(offenseSide, shooterSlot, zone, made, three, shot.passed);
  if (made) {
    creditAssist(ctx, offenseSide, team, shooter, initiator, action, zone, shot.passed);
    // A made basket is a dead-ball pause.
    return {
      continues: false,
      liveReboundEnd: false,
      shooterVersion: shooter.playerVersionId,
      defenderVersion: defender.playerVersionId,
    };
  }
  return reboundAfterMiss(
    ctx,
    offenseSide,
    defenseSide,
    zone,
    deadBall,
    reboundCounter,
    shooter.playerVersionId,
    defender.playerVersionId,
  );
}

/** Resolves a rebound after a missed field goal; true keeps the trip alive. */
function reboundAfterMiss(
  ctx: TripContext,
  offenseSide: SideIndex,
  defenseSide: SideIndex,
  zone: ShotZone,
  deadBall: boolean,
  reboundCounter: [number, number],
  shooterVersion?: string,
  defenderVersion?: string,
): ShotOutcome {
  const { rng, recorder } = ctx;
  reboundChances(ctx, offenseSide, defenseSide, reboundCounter);
  const result = resolveRebound(
    rng,
    ctx.preps[offenseSide].offensiveReboundMean,
    ctx.preps[defenseSide].defensiveReboundMean,
    zone,
    ctx.profile,
    deadBall,
  );
  if (result.team) {
    // Dead-ball team rebound: legal pause, possession changes.
    recorder.teamRebound(defenseSide);
    return {
      continues: false,
      liveReboundEnd: false,
      ...(shooterVersion !== undefined ? { shooterVersion } : {}),
      ...(defenderVersion !== undefined ? { defenderVersion } : {}),
    };
  }
  if (result.offensive) {
    const prep = ctx.preps[offenseSide];
    const rebounder = pickRebounder(ctx.teams[offenseSide].players, prep.rebounderWeights[0], rng);
    const slot = prep.slotByPlayerId.get(enginePlayerKey(rebounder)) ?? -1;
    recorder.offensiveRebound(offenseSide, slot >= 0 ? slot : 0);
    return {
      continues: true,
      liveReboundEnd: false,
      ...(shooterVersion !== undefined ? { shooterVersion } : {}),
      ...(defenderVersion !== undefined ? { defenderVersion } : {}),
    };
  }
  const prep = ctx.preps[defenseSide];
  const rebounder = pickRebounder(ctx.teams[defenseSide].players, prep.rebounderWeights[1], rng);
  const slot = prep.slotByPlayerId.get(enginePlayerKey(rebounder)) ?? -1;
  recorder.defensiveRebound(defenseSide, slot >= 0 ? slot : 0);
  // A live defensive player rebound changes possession without a stoppage.
  return {
    continues: false,
    liveReboundEnd: true,
    ...(shooterVersion !== undefined ? { shooterVersion } : {}),
    ...(defenderVersion !== undefined ? { defenderVersion } : {}),
  };
}

/** Team foul count in the current period for the defending side. */
function teamInBonus(foulsInPeriod: number, overtime: boolean): boolean {
  const limit = overtime
    ? ENGINE_CONSTANTS.bonusFoulsOvertime
    : ENGINE_CONSTANTS.bonusFoulsRegulation;
  return foulsInPeriod >= limit;
}
