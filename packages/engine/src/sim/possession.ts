import type {
  EraSimulationProfile,
  ShotZone,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import type { Rng } from './rng.ts';
import { GameRecorder, type SideIndex } from './recorder.ts';
import { meanTripSeconds, sampleTripSeconds } from './clock.ts';
import {
  pickDefender,
  pickPreparedAction,
  pickShot,
  pickZone,
  isThreePointZone,
  zoneSkillRating,
  type ActionType,
  type PossessionStartType,
} from './usage.ts';
import { eraPossEstimatePerTrip, isSteal, turnoverProbability } from './security.ts';
import {
  blockProbability,
  makeProbability,
  type HavocShotProbabilityAdjustments,
  type ShotPrep,
} from './shooting.ts';
import {
  freeThrowsForZone,
  foulAvoidanceFactor,
  freeThrowProbability,
  nonShootingFoulProbability,
  shootingFoulProbability,
} from './fouls.ts';
import { resolveRebound } from './rebounding.ts';
import {
  twentySecondClockPressure,
  DEEP_FOUR_SPLIT,
  DEEP_FOUR_FT_MISS,
  DEEP_FOUR_MAKE_SCALE,
} from './evolution-rules.ts';
import { prepareTeam, type TeamPrep } from './prepare.ts';
import type { HavocRuntimeHooks, HavocEvidence } from './havoc-runtime.ts';
import type { ApronRuntimeHooks } from './apron-runtime.ts';
import { apronPlayerKeyOf } from './apron-runtime.ts';
import { ENGINE_CONSTANTS } from './constants.ts';
import { creationScore } from '../domain/archetypes.ts';
import type { HomeCourtMechanisms } from '../game/home-court.ts';
import type { EffectsHook } from '../game/effects.ts';

const HAVOC_RUSH_MAX_VIOLATION = 0.25;
const HAVOC_RUSH_VIOLATION_SCALE = 0.35;
const HAVOC_RUSH_MIN_MAKE_PENALTY = 0.02;
const HAVOC_RUSH_MAKE_PENALTY_SCALE = 0.3;
const HAVOC_RUSH_MAX_MAKE_PENALTY = 0.1;

export interface HavocRushResolution {
  violation: boolean;
  makePenalty: number;
}

export function resolveHavocRushedPossession(
  rng: Rng,
  naturalSeconds: number,
  limitSeconds: number,
): HavocRushResolution {
  const overrun =
    naturalSeconds > 0
      ? Math.min(1, Math.max(0, (naturalSeconds - limitSeconds) / naturalSeconds))
      : 0;
  const violationProbability = Math.min(
    HAVOC_RUSH_MAX_VIOLATION,
    overrun * HAVOC_RUSH_VIOLATION_SCALE,
  );
  const violation = rng.chance(violationProbability);
  const makePenalty = Math.min(
    HAVOC_RUSH_MAX_MAKE_PENALTY,
    HAVOC_RUSH_MIN_MAKE_PENALTY + overrun * HAVOC_RUSH_MAKE_PENALTY_SCALE,
  );
  return { violation, makePenalty };
}

export interface TripResolution {
  secondsElapsed: number;
  ended: boolean;
}
export interface GameState {
  periodFouls: [number, number];
  periodIndex: number;
  secondsRemaining: number;
}
export function createGameState(): GameState {
  return {
    periodFouls: [0, 0],
    periodIndex: 0,
    secondsRemaining: 0,
  };
}
export interface TripContext {
  rng: Rng;
  recorder: GameRecorder;
  state: GameState;
  profile: EraSimulationProfile;
  teams: [SimulationTeam, SimulationTeam];
  teamUnits: [readonly string[], readonly string[]];
  personalFouls: [Map<string, number>, Map<string, number>];
  preps: [TeamPrep, TeamPrep];
  meanTripSeconds: number;
  eraPossEstimatePerTrip: number;
  passingAnchorFactor: number;
  possessionStart: PossessionStartType;
  gameRule?: import('@hoop-rush/data-contracts').SeasonGameRule;
  shotClock?: { remaining: number };
  race?: { home: number; away: number; target: number; decided: 'home' | 'away' | null };
  homeCourt?: HomeCourtMechanisms;
  effects?: EffectsHook;
  havoc?: HavocRuntimeHooks;
  apron?: ApronRuntimeHooks;
}
export function createTripContext(
  rng: Rng,
  recorder: GameRecorder,
  state: GameState,
  profile: EraSimulationProfile,
  teams: [SimulationTeam, SimulationTeam],
  homeCourt?: HomeCourtMechanisms,
  effects?: EffectsHook,
  preps?: [TeamPrep, TeamPrep],
): TripContext {
  return {
    rng,
    recorder,
    state,
    profile,
    teams,
    teamUnits: [unitVersionIdsOf(teams[0]), unitVersionIdsOf(teams[1])],
    personalFouls: [new Map<string, number>(), new Map<string, number>()],
    preps: preps ?? [prepareTeam(teams[0], profile), prepareTeam(teams[1], profile)],
    meanTripSeconds: meanTripSeconds(profile),
    eraPossEstimatePerTrip: eraPossEstimatePerTrip(profile) ?? 1,
    passingAnchorFactor: 0.5 + (profile.parameters.assistAnchorRating - 50) / 100,
    possessionStart: 'neutral',
    ...(homeCourt !== undefined ? { homeCourt } : {}),
    ...(effects !== undefined ? { effects } : {}),
  };
}
export interface PossessionStep {
  ended: boolean;
  pause: boolean;
  periodEnded: boolean;
  finished: boolean;
}
function slotOf(prep: TeamPrep, player: SimulationPlayer): number {
  return prep.slotByPlayerId.get(prep.keyOf(player)) ?? -1;
}
function slotOfOrThrow(prep: TeamPrep, player: SimulationPlayer): number {
  const slot = slotOf(prep, player);
  if (slot < 0) {
    throw new Error(`possession: no slot for player ${prep.keyOf(player)}`);
  }
  return slot;
}
function personalFoulCount(
  ctx: TripContext,
  side: SideIndex,
  prep: TeamPrep,
  player: SimulationPlayer,
): number {
  return ctx.personalFouls[side].get(prep.keyOf(player)) ?? 0;
}
function recordPersonalFoul(
  ctx: TripContext,
  side: SideIndex,
  prep: TeamPrep,
  player: SimulationPlayer,
): void {
  const key = prep.keyOf(player);
  ctx.personalFouls[side].set(key, (ctx.personalFouls[side].get(key) ?? 0) + 1);
}
function pickFoulerWithAvoidance(
  ctx: TripContext,
  side: SideIndex,
  team: SimulationTeam,
  prep: TeamPrep,
): SimulationPlayer {
  for (;;) {
    const fouler = ctx.rng.weightedPickTable(team.players, prep.foulerPickTable);
    if (ctx.rng.chance(foulAvoidanceFactor(personalFoulCount(ctx, side, prep, fouler)))) {
      return fouler;
    }
  }
}
function homeDefenseShotAdjustment(ctx: TripContext, defenseSide: SideIndex): number {
  return defenseSide === 0 ? (ctx.homeCourt?.homeDefenseShotAdjustment ?? 0) : 0;
}

function forcedActorOf(ctx: TripContext, offenseSide: SideIndex): SimulationPlayer | null {
  const apron = ctx.apron;
  if (apron === undefined) return null;
  return apron.forcedActor(ctx.teams[offenseSide]);
}

const strikePrepCache = new WeakMap<
  TripContext,
  { struckKey: string; prepRef: TeamPrep; pool: SimulationTeam; prep: TeamPrep }
>();

function strikeAdjustedDefense(
  ctx: TripContext,
  defenseSide: SideIndex,
): { team: SimulationTeam; prep: TeamPrep } {
  const apron = ctx.apron;
  const team = ctx.teams[defenseSide];
  const prep = ctx.preps[defenseSide];
  if (apron === undefined) return { team, prep };
  const struck = apron.struckDefender(team);
  if (struck === null) return { team, prep };
  const struckKey = apronPlayerKeyOf(struck);
  const cached = strikePrepCache.get(ctx);
  if (cached !== undefined && cached.struckKey === struckKey && cached.prepRef === prep) {
    return { team: cached.pool, prep: cached.prep };
  }
  const pool: SimulationTeam = {
    teamId: team.teamId,
    displayName: team.displayName,
    players: team.players.filter((player) => apronPlayerKeyOf(player) !== struckKey),
  };
  if (pool.players.length !== team.players.length - 1) return { team, prep };
  const adjusted = prepareTeam(pool, ctx.profile, { aggregateDivisor: 5 });
  strikePrepCache.set(ctx, { struckKey, prepRef: prep, pool, prep: adjusted });
  return { team: pool, prep: adjusted };
}
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
  private handlerVersion: string | undefined;
  private handlerSlot = 0;
  private handlerKey: string | undefined;
  private shooterVersion: string | undefined;
  private defenderVersion: string | undefined;
  private rushMakePenalty = 0;
  private readonly tripRebounds: [number, number] = [0, 0];
  constructor(ctx: TripContext, offenseSide: SideIndex) {
    this.ctx = ctx;
    this.offenseSide = offenseSide;
    this.startedRemaining = ctx.state.secondsRemaining;
    if (ctx.gameRule === 'twenty-second-clock') ctx.shotClock = { remaining: 20 };
    if (ctx.havoc !== undefined) {
      ctx.shotClock = { remaining: ctx.havoc.fullShotClock(offenseSide) };
    }
  }
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
        consumeTime(this.ctx.state, ENGINE_CONSTANTS.inboundConsumption);
        if (this.ctx.shotClock) {
          this.ctx.shotClock.remaining -= ENGINE_CONSTANTS.inboundConsumption;
          if (this.ctx.havoc !== undefined) {
            this.ctx.shotClock.remaining = Math.max(0, this.ctx.shotClock.remaining);
          }
        }
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
    if (this.ctx.havoc !== undefined) {
      return this.stepSampleHavoc();
    }
    if (this.ctx.gameRule === 'twenty-second-clock' && this.ctx.shotClock) {
      return this.stepSampleTwentySecond();
    }
    const sampled = sampleTripSeconds(
      rng,
      profile,
      state.secondsRemaining,
      this.ctx.meanTripSeconds,
    );
    if (sampled === null) {
      return this.finish({ ended: false, pause: true, periodEnded: true });
    }
    const consumedBase = consumeTime(state, sampled);
    this.deadBall = consumedBase >= this.startedRemaining - ENGINE_CONSTANTS.minimumStartSeconds;
    this.phase = 'security';
    return { ended: false, pause: false, periodEnded: false, finished: false };
  }
  private stepSampleTwentySecond(): PossessionStep {
    const { rng, state, recorder, teams, preps } = this.ctx;
    const clock = this.ctx.shotClock;
    if (clock === undefined) {
      this.phase = 'security';
      return { ended: false, pause: false, periodEnded: false, finished: false };
    }
    if (state.secondsRemaining < ENGINE_CONSTANTS.minimumStartSeconds) {
      return this.finish({ ended: false, pause: true, periodEnded: true });
    }
    const raw = this.ctx.meanTripSeconds * (0.6 + rng.next() * 0.8);
    const planned = Math.max((raw * 20) / 24, ENGINE_CONSTANTS.minimumTripSeconds);
    if (planned > clock.remaining && planned <= state.secondsRemaining) {
      const offense = this.offenseSide;
      const team = teams[offense];
      const teamPrep = preps[offense];
      const handler = rng.weightedPickTable(team.players, teamPrep.initiatorPickTable);
      const handlerSlot = slotOf(teamPrep, handler);
      this.handlerVersion = handler.playerVersionId;
      consumeTime(state, Math.min(clock.remaining, state.secondsRemaining));
      clock.remaining = 0;
      recorder.shotClockViolation(offense, handlerSlot >= 0 ? handlerSlot : 0);
      recorder.possession(offense);
      this.ctx.possessionStart = 'deadBall';
      return this.endedStep(true);
    }
    const consumed = consumeTime(state, Math.min(planned, state.secondsRemaining));
    clock.remaining = Math.max(0, clock.remaining - consumed);
    if (state.secondsRemaining <= 0) {
      return this.finish({ ended: false, pause: true, periodEnded: true });
    }
    this.deadBall = consumed >= this.startedRemaining - ENGINE_CONSTANTS.minimumStartSeconds;
    this.phase = 'security';
    return { ended: false, pause: false, periodEnded: false, finished: false };
  }
  private stepSampleHavoc(): PossessionStep {
    const { rng, state, recorder, teams, preps } = this.ctx;
    const havoc = this.ctx.havoc;
    const clock = this.ctx.shotClock;
    if (havoc === undefined || clock === undefined) {
      this.phase = 'security';
      return { ended: false, pause: false, periodEnded: false, finished: false };
    }
    if (state.secondsRemaining < ENGINE_CONSTANTS.minimumStartSeconds) {
      return this.finish({ ended: false, pause: true, periodEnded: true });
    }
    const offense = this.offenseSide;
    const full = havoc.fullShotClock(offense);
    const raw = this.ctx.meanTripSeconds * (0.6 + rng.next() * 0.8);
    const planned =
      full === ENGINE_CONSTANTS.shotClockSeconds
        ? Math.max(
            (raw * full) / ENGINE_CONSTANTS.shotClockSeconds,
            ENGINE_CONSTANTS.minimumTripSeconds,
          )
        : Math.max(raw, ENGINE_CONSTANTS.minimumTripSeconds);
    if (planned > clock.remaining && planned <= state.secondsRemaining) {
      const rush = resolveHavocRushedPossession(rng, planned, clock.remaining);
      if (rush.violation) {
        const team = teams[offense];
        const teamPrep = preps[offense];
        const handler = rng.weightedPickTable(team.players, teamPrep.initiatorPickTable);
        const handlerSlot = slotOf(teamPrep, handler);
        this.handlerVersion = handler.playerVersionId;
        this.handlerSlot = handlerSlot >= 0 ? handlerSlot : 0;
        consumeTime(state, Math.min(Math.max(0, clock.remaining), state.secondsRemaining));
        clock.remaining = 0;
        recorder.shotClockViolation(offense, this.handlerSlot);
        havoc.onShotClockViolation(offense, full);
        recorder.possession(offense);
        this.ctx.possessionStart = 'deadBall';
        return this.endedStep(true);
      }
      const rushed = consumeTime(
        state,
        Math.min(Math.max(0, clock.remaining), state.secondsRemaining),
      );
      clock.remaining = 0;
      this.rushMakePenalty = rush.makePenalty;
      this.deadBall = rushed >= this.startedRemaining - ENGINE_CONSTANTS.minimumStartSeconds;
      this.phase = 'security';
      return { ended: false, pause: false, periodEnded: false, finished: false };
    }
    const consumed = consumeTime(state, Math.min(planned, state.secondsRemaining));
    clock.remaining = Math.max(0, clock.remaining - consumed);
    if (state.secondsRemaining <= 0) {
      return this.finish({ ended: false, pause: true, periodEnded: true });
    }
    this.deadBall = consumed >= this.startedRemaining - ENGINE_CONSTANTS.minimumStartSeconds;
    this.phase = 'security';
    return { ended: false, pause: false, periodEnded: false, finished: false };
  }
  private stepSecurity(): PossessionStep {
    const { rng, recorder, teams, preps } = this.ctx;
    const havoc = this.ctx.havoc;
    const offense = this.offenseSide;
    const defense = (1 - offense) as SideIndex;
    const team = teams[offense];
    const teamPrep = preps[offense];
    const defensePrep = preps[defense];
    const handler =
      forcedActorOf(this.ctx, offense) ??
      rng.weightedPickTable(team.players, teamPrep.initiatorPickTable);
    const handlerSlot = slotOf(teamPrep, handler);
    this.handlerKey = teamPrep.keyOf(handler);
    this.handlerVersion = handler.playerVersionId;
    this.handlerSlot = handlerSlot >= 0 ? handlerSlot : 0;
    const awayTurnoverPressure =
      this.offenseSide === 1 ? (this.ctx.homeCourt?.awayTurnoverPressureAdjustment ?? 0) : 0;
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
          effectsAdjustment / 1000000,
          havoc?.evidenceOf(handler),
        ),
      )
    ) {
      const cancelled = havoc?.cancelTurnover(offense, handler) ?? false;
      havoc?.onTurnover(offense, handler, cancelled);
      if (cancelled) {
        this.phase = 'foul';
        return { ended: false, pause: false, periodEnded: false, finished: false };
      }
      recorder.turnover(offense, this.handlerSlot);
      if (isSteal(rng, defensePrep.stealAbility, this.ctx.profile)) {
        const adjusted = strikeAdjustedDefense(this.ctx, defense);
        const stealer = rng.weightedPickTable(
          adjusted.team.players,
          adjusted.prep.stealerPickTable,
        );
        const stealerSlot = slotOf(defensePrep, stealer);
        recorder.steal(defense, stealerSlot >= 0 ? stealerSlot : 0);
        havoc?.onSteal(defense, stealer);
      }
      this.ctx.possessionStart = 'liveTurnover';
      recorder.possession(offense);
      return this.endedStep(false);
    }
    this.phase = 'foul';
    return { ended: false, pause: false, periodEnded: false, finished: false };
  }
  private stepFoulCheck(): PossessionStep {
    const { rng, recorder, state, teams, preps, profile } = this.ctx;
    const havoc = this.ctx.havoc;
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
    if (rng.chance(ENGINE_CONSTANTS.offensiveFoulShare)) {
      const offenseTeam = teams[offense];
      const offensePrep = preps[offense];
      const fouler = pickFoulerWithAvoidance(this.ctx, offense, offenseTeam, offensePrep);
      const foulerSlot = slotOf(offensePrep, fouler);
      const cancelled = havoc?.cancelTurnover(offense, fouler) ?? false;
      havoc?.onTurnover(offense, fouler, cancelled);
      recorder.foul(offense, foulerSlot >= 0 ? foulerSlot : 0);
      recordPersonalFoul(this.ctx, offense, offensePrep, fouler);
      state.periodFouls[offense] += 1;
      const awards = havoc?.onFoul({
        fouler,
        foulerSide: offense,
        offenseSide: offense,
        shooter: null,
        shooting: false,
        madeShot: false,
        inBonus: false,
        zone: null,
      });
      if (!cancelled) {
        recorder.turnover(offense, foulerSlot >= 0 ? foulerSlot : 0);
      }
      if (awards !== undefined && awards.technicalFreeThrows > 0 && awards.technicalForDefense) {
        resolveGrantedFreeThrow(this.ctx, defense, offense, true);
      }
      if (awards !== undefined) {
        for (let i = 0; i < awards.doubleOrNothingFreeThrows; i += 1) {
          resolveGrantedFreeThrow(this.ctx, defense, offense, false);
        }
      }
      if (cancelled) {
        this.phase = 'shot';
        return { ended: false, pause: false, periodEnded: false, finished: false };
      }
      recorder.possession(offense);
      this.ctx.possessionStart = 'deadBall';
      return this.endedStep(true);
    }
    const defenseTeam = teams[defense];
    const defensePrep = preps[defense];
    const fouler = pickFoulerWithAvoidance(this.ctx, defense, defenseTeam, defensePrep);
    const foulerSlot = slotOf(defensePrep, fouler);
    recorder.foul(defense, foulerSlot >= 0 ? foulerSlot : 0);
    recordPersonalFoul(this.ctx, defense, defensePrep, fouler);
    state.periodFouls[defense] += 1;
    const inBonus = teamInBonus(state.periodFouls[defense], state.periodIndex >= 4);
    const awards = havoc?.onFoul({
      fouler,
      foulerSide: defense,
      offenseSide: offense,
      shooter: null,
      shooting: false,
      madeShot: false,
      inBonus,
      zone: null,
    });
    if (inBonus) {
      const team = teams[offense];
      const teamPrep = preps[offense];
      const slot =
        this.handlerKey === undefined ? undefined : teamPrep.slotByPlayerId.get(this.handlerKey);
      const shooter =
        (slot === undefined ? undefined : team.players[slot]) ??
        rng.weightedPickTable(team.players, teamPrep.initiatorPickTable);
      const shooterSlot = slotOf(teamPrep, shooter);
      this.ctx.possessionStart = 'deadBall';
      const technical = awards?.technicalFreeThrows ?? 0;
      const extra = awards?.doubleOrNothingFreeThrows ?? 0;
      const attempts = 2 + technical + extra;
      const freeThrows = resolveFreeThrows(
        this.ctx,
        offense,
        defense,
        shooterSlot,
        attempts,
        this.deadBall,
        this.tripRebounds,
        havoc !== undefined ? { bonusAttempts: 2 + technical, trailingAttempts: extra } : undefined,
      );
      if (freeThrows.continues) {
        this.phase = 'continuation';
        return { ended: false, pause: false, periodEnded: false, finished: false };
      }
      recorder.possession(offense);
      return this.endedStep(!freeThrows.liveReboundEnd);
    }
    const technical = awards?.technicalFreeThrows ?? 0;
    const extra = awards?.doubleOrNothingFreeThrows ?? 0;
    if (technical > 0 || extra > 0) {
      const teamPrep = preps[offense];
      const shooter = rng.weightedPickTable(
        teams[offense].players,
        teamPrep.freeThrowShooterPickTable,
      );
      const shooterSlot = slotOf(teamPrep, shooter);
      resolveFreeThrows(
        this.ctx,
        offense,
        defense,
        shooterSlot,
        technical + extra,
        true,
        this.tripRebounds,
        {
          bonusAttempts: technical,
          trailingAttempts: extra,
        },
      );
      this.ctx.possessionStart = 'deadBall';
    }
    this.phase = 'inbound';
    if (this.ctx.shotClock) {
      const reset = havoc !== undefined ? Math.min(14, havoc.fullShotClock(offense)) : 14;
      this.ctx.shotClock.remaining = Math.max(this.ctx.shotClock.remaining, reset);
    }
    return { ended: false, pause: true, periodEnded: false, finished: false };
  }
  private stepShot(): PossessionStep {
    const { recorder } = this.ctx;
    const offense = this.offenseSide;
    const defense = (1 - offense) as SideIndex;
    const outcome = resolveShot(
      this.ctx,
      offense,
      defense,
      this.deadBall,
      this.tripRebounds,
      this.rushMakePenalty,
      this.continuations === 0 ? this.handlerKey : undefined,
    );
    this.shooterVersion = outcome.shooterVersion;
    this.defenderVersion = outcome.defenderVersion;
    if (!outcome.continues) {
      recorder.possession(offense);
      return this.endedStep(!outcome.liveReboundEnd);
    }
    if (this.continuations >= 4) {
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
    consumeTime(state, ENGINE_CONSTANTS.continuationConsumption);
    if (this.ctx.shotClock) {
      this.ctx.shotClock.remaining = Math.max(
        0,
        this.ctx.shotClock.remaining - ENGINE_CONSTANTS.continuationConsumption,
      );
    }
    const havoc = this.ctx.havoc;
    if (
      havoc !== undefined &&
      this.ctx.shotClock !== undefined &&
      this.ctx.shotClock.remaining <= 0
    ) {
      recorder.shotClockViolation(offense, this.handlerSlot);
      havoc.onShotClockViolation(offense, havoc.fullShotClock(offense));
      recorder.possession(offense);
      this.recordTrip();
      return this.finish({
        ended: true,
        pause: true,
        periodEnded: state.secondsRemaining <= 0,
      });
    }
    if (state.secondsRemaining < ENGINE_CONSTANTS.minimumStartSeconds) {
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
export function resolveTrip(ctx: TripContext, offenseSide: SideIndex): TripResolution {
  const startedRemaining = ctx.state.secondsRemaining;
  ctx.apron?.beginPossession(offenseSide);
  const stepper = new PossessionStepper(ctx, offenseSide);
  let step: PossessionStep;
  try {
    do {
      step = stepper.step();
    } while (!step.periodEnded && !step.finished);
  } finally {
    ctx.apron?.endPossession();
  }
  return {
    secondsElapsed: startedRemaining - ctx.state.secondsRemaining,
    ended: step.ended,
  };
}
function consumeTime(state: GameState, seconds: number): number {
  const consumed = Math.min(seconds, state.secondsRemaining);
  state.secondsRemaining -= consumed;
  return consumed;
}
function simulationPlayerVersion(player: SimulationPlayer): string {
  const version = player.playerVersionId;
  if (version === undefined) {
    throw new Error('possession: effects facts require a playerVersionId');
  }
  return version;
}
function unitVersionIdsOf(team: SimulationTeam): readonly string[] {
  return team.players.map((player) => player.playerVersionId ?? `missing:${player.playerId}`);
}
export function assistProbabilityPure(
  profile: EraSimulationProfile,
  passingAnchorFactor: number,
  passer: SimulationPlayer,
  action: ActionType,
  zone: ShotZone,
  shooter: SimulationPlayer,
  effectsAdjustment = 0,
  evidence?: HavocEvidence,
): number {
  const factor = 0.5 + (passer.ratings.passing - 50) / 100;
  const anchorAuthoritative = evidence?.isAuthoritative('assist-anchor') ?? false;
  const roleFactor =
    anchorAuthoritative || !passer.anchors
      ? 1
      : 0.75 + Math.min(1, passer.anchors.assistsPerGame / 8) * 0.25;
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
        ENGINE_CONSTANTS.assistCreditScale *
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
function creditAssist(
  ctx: TripContext,
  offenseSide: SideIndex,
  _team: SimulationTeam,
  shooter: SimulationPlayer,
  initiator: SimulationPlayer,
  action: ActionType,
  zone: ShotZone,
  passed: boolean,
): void {
  if (!passed) return;
  const passer = initiator;
  const slot = slotOf(ctx.preps[offenseSide], passer);
  if (slot < 0) return;
  ctx.recorder.assistOpportunity(offenseSide, slot);
  const effectsAdjustment = ctx.effects?.assistAdjustment({ offenseSide }) ?? 0;
  if (
    !ctx.rng.chance(
      assistProbabilityPure(
        ctx.profile,
        ctx.passingAnchorFactor,
        passer,
        action,
        zone,
        shooter,
        effectsAdjustment / 1000000,
        ctx.havoc?.evidenceOf(passer),
      ),
    )
  ) {
    return;
  }
  ctx.recorder.assist(offenseSide, slot);
  ctx.havoc?.onAssist(offenseSide, passer, shooter);
}
function reboundChances(
  ctx: TripContext,
  offenseSide: SideIndex,
  defenseSide: SideIndex,
  reboundCounter: [number, number],
): void {
  ctx.recorder.offensiveReboundChance(offenseSide);
  ctx.recorder.defensiveReboundChance(defenseSide);
  ctx.recorder.reboundOpportunity(offenseSide);
  reboundCounter[offenseSide] += 1;
  reboundCounter[defenseSide] += 1;
}
interface FreeThrowOutcome {
  continues: boolean;
  liveReboundEnd: boolean;
}
function reboundFromLiveMissedFreeThrow(
  ctx: TripContext,
  offenseSide: SideIndex,
  defenseSide: SideIndex,
  reboundCounter: [number, number],
): FreeThrowOutcome {
  reboundChances(ctx, offenseSide, defenseSide, reboundCounter);
  const result = resolveRebound(
    ctx.rng,
    ctx.preps[offenseSide].offensiveReboundMean,
    ctx.preps[defenseSide].defensiveReboundMean,
    'rim',
    ctx.profile,
    false,
  );
  if (result.team) {
    ctx.recorder.teamRebound(defenseSide);
    return { continues: false, liveReboundEnd: false };
  }
  if (result.offensive) {
    const prep = ctx.preps[offenseSide];
    const rebounder = ctx.rng.weightedPickTable(
      ctx.teams[offenseSide].players,
      prep.rebounderPickTables[0],
    );
    ctx.recorder.offensiveRebound(offenseSide, slotOfOrThrow(prep, rebounder));
    ctx.havoc?.onRebound(offenseSide, rebounder, true);
    ctx.possessionStart = 'offensiveRebound';
    if (ctx.shotClock) ctx.shotClock.remaining = reboundShotClockOf(ctx, offenseSide);
    return { continues: true, liveReboundEnd: false };
  }
  const prep = ctx.preps[defenseSide];
  const rebounder = ctx.rng.weightedPickTable(
    ctx.teams[defenseSide].players,
    prep.rebounderPickTables[1],
  );
  ctx.recorder.defensiveRebound(defenseSide, slotOfOrThrow(prep, rebounder));
  ctx.havoc?.onRebound(defenseSide, rebounder, false);
  ctx.possessionStart = 'defensiveRebound';
  return { continues: false, liveReboundEnd: true };
}
function resolveFreeThrows(
  ctx: TripContext,
  offenseSide: SideIndex,
  defenseSide: SideIndex,
  shooterSlot: number,
  attempts: number,
  deadBall: boolean,
  reboundCounter: [number, number],
  bonusOptions?: { bonusAttempts?: number; trailingAttempts?: number },
): FreeThrowOutcome {
  const { rng, recorder } = ctx;
  const shooter = ctx.teams[offenseSide].players[shooterSlot];
  if (shooter === undefined) {
    throw new Error(`possession: no player at slot ${String(shooterSlot)}`);
  }
  const bonusAttempts = bonusOptions?.bonusAttempts ?? 0;
  const trailingAttempts = bonusOptions?.trailingAttempts ?? 0;
  const bonusFrom = attempts - trailingAttempts - bonusAttempts;
  const bonusUntil = attempts - trailingAttempts;
  let outcome: FreeThrowOutcome = { continues: false, liveReboundEnd: false };
  for (let i = 0; i < attempts; i += 1) {
    if (ctx.race?.decided) break;
    const last = i === attempts - 1;
    const p =
      ctx.preps[offenseSide].freeThrowP[shooterSlot] ?? freeThrowProbability(shooter, ctx.profile);
    const made = rng.chance(p);
    recorder.freeThrow(offenseSide, shooterSlot, made);
    ctx.havoc?.onFreeThrow({
      side: offenseSide,
      shooter,
      made,
      bonus: bonusAttempts > 0 && i >= bonusFrom && i < bonusUntil,
    });
    if (made) {
      raceRecordPoints(ctx, offenseSide, 1);
      continue;
    }
    if (last) {
      if (deadBall) {
        recorder.teamRebound(defenseSide);
      } else {
        outcome = reboundFromLiveMissedFreeThrow(ctx, offenseSide, defenseSide, reboundCounter);
      }
      break;
    }
    recorder.teamRebound(defenseSide);
  }
  recorder.freeThrowTrip(offenseSide);
  return outcome;
}
interface ShotOutcome {
  continues: boolean;
  liveReboundEnd: boolean;
  shooterVersion?: string;
  defenderVersion?: string;
}
function resolveShot(
  ctx: TripContext,
  offenseSide: SideIndex,
  defenseSide: SideIndex,
  deadBall: boolean,
  reboundCounter: [number, number],
  rushMakePenalty = 0,
  handlerKey?: string,
): ShotOutcome {
  const { rng, recorder, state, profile } = ctx;
  const havoc = ctx.havoc;
  const team = ctx.teams[offenseSide];
  const teamPrep = ctx.preps[offenseSide];
  const defensePrep = ctx.preps[defenseSide];
  const handlerSlot =
    handlerKey === undefined ? undefined : teamPrep.slotByPlayerId.get(handlerKey);
  const forced = forcedActorOf(ctx, offenseSide);
  const initiator =
    forced ??
    (handlerSlot === undefined ? undefined : team.players[handlerSlot]) ??
    rng.weightedPickTable(team.players, teamPrep.initiatorPickTable);
  const initiatorKey = teamPrep.keyOf(initiator);
  const actionTables = teamPrep.actionPickTables.get(initiatorKey);
  if (actionTables === undefined) {
    throw new Error(`possession: no action tables for ${initiatorKey}`);
  }
  const action =
    forced === null ? pickPreparedAction(actionTables, rng, ctx.possessionStart) : 'isolation';
  const teammateShots = teamPrep.teammateShots.get(initiatorKey);
  if (teammateShots === undefined) {
    throw new Error(`possession: no teammate shot table for ${initiatorKey}`);
  }
  const shot =
    forced === null
      ? pickShot(teammateShots, initiator, action, rng, teamPrep.passP.get(initiatorKey))
      : { shooter: initiator, initiator, passed: false };
  const shooter = shot.shooter;
  const interceptionChance = shot.passed
    ? (ctx.apron?.passInterceptionChance?.(offenseSide) ?? 0)
    : 0;
  if (interceptionChance > 0 && rng.chance(interceptionChance)) {
    const cancelled = havoc?.cancelTurnover(offenseSide, initiator) ?? false;
    havoc?.onTurnover(offenseSide, initiator, cancelled);
    if (!cancelled) {
      const adjusted = strikeAdjustedDefense(ctx, defenseSide);
      const stealer = rng.weightedPickTable(adjusted.team.players, adjusted.prep.stealerPickTable);
      recorder.turnover(offenseSide, slotOf(teamPrep, initiator));
      recorder.steal(defenseSide, slotOf(defensePrep, stealer));
      havoc?.onSteal(defenseSide, stealer);
      ctx.apron?.onPassIntercepted?.(initiator, stealer);
      ctx.possessionStart = 'liveTurnover';
      return { continues: false, liveReboundEnd: true };
    }
  }
  const zonePrep = teamPrep.zonePrep.get(teamPrep.keyOf(shooter));
  if (zonePrep === undefined) {
    throw new Error(`possession: no zone preparation for ${teamPrep.keyOf(shooter)}`);
  }
  const zone = pickZone(action, zonePrep, rng);
  const deep =
    ctx.gameRule === 'deep-four' && zone === 'aboveBreakThree' && rng.chance(DEEP_FOUR_SPLIT);
  const ruleMakeScale =
    (deep ? DEEP_FOUR_MAKE_SCALE : 1) *
    (ctx.gameRule === 'twenty-second-clock' && ctx.shotClock
      ? twentySecondClockPressure(ctx.shotClock.remaining)
      : 1);
  const shooterSlot = slotOf(teamPrep, shooter);
  const havocPlan =
    havoc?.planShot({
      offense: offenseSide,
      defense: defenseSide,
      shooter,
      zone,
      action,
      passed: shot.passed,
    }) ?? null;
  const adjustedDefense = strikeAdjustedDefense(ctx, defenseSide);
  const defender =
    havocPlan === null
      ? pickDefender(
          adjustedDefense.team,
          zone,
          rng,
          adjustedDefense.prep.defenderBase,
          shooterSlot,
        )
      : havocPlan.defender;
  const three = isThreePointZone(zone);
  const defenderSlot = slotOf(defensePrep, defender);
  if (defenderSlot >= 0) recorder.contest(defenseSide, defenderSlot);
  const shotPrep: ShotPrep = {
    spacing: teamPrep.spacing,
    twoPointAnchor: teamPrep.twoPointAnchor.get(teamPrep.keyOf(shooter)) ?? null,
  };
  const effectsAdjustment =
    ctx.effects?.makeAdjustment({
      shooterVersion: simulationPlayerVersion(shooter),
      offenseSide,
      defenseSide,
    }) ?? 0;
  const effectsAdjustmentFraction = effectsAdjustment / 1000000;
  const makeOptions: HavocShotProbabilityAdjustments | undefined =
    havocPlan === null
      ? undefined
      : {
          contestScale: havocPlan.coverage.contestScale,
          contestPointDelta: havocPlan.coverage.contestPointDelta,
          makePointDelta: havocPlan.coverage.makePointDelta - rushMakePenalty,
          shooterEvidence: havoc?.evidenceOf(shooter),
          defenderEvidence: havoc?.evidenceOf(defender),
        };
  const havocRecord =
    havoc === undefined || havocPlan === null
      ? null
      : (made: boolean): void => {
          havoc.onFieldGoal({
            offense: offenseSide,
            shooter,
            made,
            three,
            passed: shot.passed,
            shotKind: havocPlan.shotKind,
            putback: havocPlan.putback,
            zone,
          });
        };
  const foulP = shootingFoulProbability(shooter, defender, zone, profile);
  let foulDrawn = rng.chance(foulP);
  if (foulDrawn) {
    foulDrawn = rng.chance(
      foulAvoidanceFactor(personalFoulCount(ctx, defenseSide, defensePrep, defender)),
    );
  }
  if (foulDrawn) {
    recorder.foul(defenseSide, defenderSlot >= 0 ? defenderSlot : 0);
    recordPersonalFoul(ctx, defenseSide, defensePrep, defender);
    state.periodFouls[defenseSide] += 1;
    const homeDefenseAdjustment = homeDefenseShotAdjustment(ctx, defenseSide);
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
        makeOptions,
      ) * ENGINE_CONSTANTS.fouledShotMakeScale;
    const made = rng.chance(shotP * ruleMakeScale);
    const awards = havoc?.onFoul({
      fouler: defender,
      foulerSide: defenseSide,
      offenseSide,
      shooter,
      shooting: true,
      madeShot: made,
      inBonus: false,
      zone,
    });
    recorder.fieldGoalAttempt(offenseSide, shooterSlot, zone, made, three, shot.passed, deep);
    havocRecord?.(made);
    if (made) raceRecordPoints(ctx, offenseSide, deep ? 4 : three ? 3 : 2);
    if (ctx.race?.decided) {
      ctx.possessionStart = 'deadBall';
      return {
        continues: false,
        liveReboundEnd: false,
        shooterVersion: shooter.playerVersionId,
        defenderVersion: defender.playerVersionId,
      };
    }
    const technical = awards?.technicalFreeThrows ?? 0;
    const extra = awards?.doubleOrNothingFreeThrows ?? 0;
    const bonusAttempts = (awards?.bonusAttempts ?? 0) + technical;
    const freeThrowOptions =
      havoc !== undefined && (bonusAttempts > 0 || extra > 0)
        ? { bonusAttempts, trailingAttempts: extra }
        : undefined;
    let freeThrows: FreeThrowOutcome;
    if (made) {
      creditAssist(ctx, offenseSide, team, shooter, initiator, action, zone, shot.passed);
      freeThrows = resolveFreeThrows(
        ctx,
        offenseSide,
        defenseSide,
        shooterSlot,
        (awards?.freeThrowsAwarded ?? 1) + technical + extra,
        false,
        reboundCounter,
        freeThrowOptions,
      );
    } else {
      recorder.teamRebound(defenseSide);
      freeThrows = resolveFreeThrows(
        ctx,
        offenseSide,
        defenseSide,
        shooterSlot,
        (awards?.freeThrowsAwarded ?? (deep ? DEEP_FOUR_FT_MISS : freeThrowsForZone(zone))) +
          technical +
          extra,
        deadBall,
        reboundCounter,
        freeThrowOptions,
      );
    }
    if (freeThrows.continues) {
      return {
        continues: true,
        liveReboundEnd: false,
        shooterVersion: shooter.playerVersionId,
        defenderVersion: defender.playerVersionId,
      };
    }
    if (!freeThrows.liveReboundEnd) ctx.possessionStart = 'deadBall';
    return {
      continues: false,
      liveReboundEnd: freeThrows.liveReboundEnd,
      shooterVersion: shooter.playerVersionId,
      defenderVersion: defender.playerVersionId,
    };
  }
  const blockP = blockProbability(
    defender,
    zone,
    action,
    havoc?.evidenceOf(defender),
    havocPlan?.coverage.blockPointDelta ?? 0,
  );
  if (rng.chance(blockP)) {
    recorder.block(defenseSide, defenderSlot >= 0 ? defenderSlot : 0);
    havoc?.onBlock(defenseSide, defender, shooter);
    recorder.fieldGoalAttempt(offenseSide, shooterSlot, zone, false, three, shot.passed, deep);
    havocRecord?.(false);
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
  const homeDefenseAdjustment = homeDefenseShotAdjustment(ctx, defenseSide);
  const baseShotP = makeProbability(
    shooter,
    defender,
    profile,
    zone,
    action,
    state.secondsRemaining,
    shotPrep,
    homeDefenseAdjustment,
    effectsAdjustmentFraction,
    makeOptions,
  );
  const shotP =
    shotPrep.twoPointAnchor !== null && !three
      ? Math.min(0.97, baseShotP / Math.max(0.5, 1 - blockP))
      : baseShotP;
  const made = rng.chance(shotP * ruleMakeScale);
  recorder.fieldGoalAttempt(offenseSide, shooterSlot, zone, made, three, shot.passed, deep);
  havocRecord?.(made);
  if (made) raceRecordPoints(ctx, offenseSide, deep ? 4 : three ? 3 : 2);
  if (made) {
    creditAssist(ctx, offenseSide, team, shooter, initiator, action, zone, shot.passed);
    ctx.possessionStart = 'madeBasket';
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
  if (!deadBall) reboundChances(ctx, offenseSide, defenseSide, reboundCounter);
  const adjustedDefense = strikeAdjustedDefense(ctx, defenseSide);
  const result = resolveRebound(
    rng,
    ctx.preps[offenseSide].offensiveReboundMean,
    adjustedDefense.prep.defensiveReboundMean,
    zone,
    ctx.profile,
    deadBall,
  );
  if (result.team) {
    recorder.teamRebound(defenseSide);
    ctx.possessionStart = 'deadBall';
    return {
      continues: false,
      liveReboundEnd: false,
      ...(shooterVersion !== undefined ? { shooterVersion } : {}),
      ...(defenderVersion !== undefined ? { defenderVersion } : {}),
    };
  }
  if (result.offensive) {
    const prep = ctx.preps[offenseSide];
    const rebounder = rng.weightedPickTable(
      ctx.teams[offenseSide].players,
      prep.rebounderPickTables[0],
    );
    recorder.offensiveRebound(offenseSide, slotOfOrThrow(prep, rebounder));
    ctx.havoc?.onRebound(offenseSide, rebounder, true);
    ctx.possessionStart = 'offensiveRebound';
    if (ctx.shotClock) ctx.shotClock.remaining = reboundShotClockOf(ctx, offenseSide);
    return {
      continues: true,
      liveReboundEnd: false,
      ...(shooterVersion !== undefined ? { shooterVersion } : {}),
      ...(defenderVersion !== undefined ? { defenderVersion } : {}),
    };
  }
  const rebounder = rng.weightedPickTable(
    adjustedDefense.team.players,
    adjustedDefense.prep.rebounderPickTables[1],
  );
  recorder.defensiveRebound(defenseSide, slotOfOrThrow(ctx.preps[defenseSide], rebounder));
  ctx.havoc?.onRebound(defenseSide, rebounder, false);
  ctx.possessionStart = 'defensiveRebound';
  return {
    continues: false,
    liveReboundEnd: true,
    ...(shooterVersion !== undefined ? { shooterVersion } : {}),
    ...(defenderVersion !== undefined ? { defenderVersion } : {}),
  };
}
function reboundShotClockOf(ctx: TripContext, side: SideIndex): number {
  const havoc = ctx.havoc;
  if (havoc === undefined) return 14;
  return Math.min(14, havoc.reboundShotClock(side));
}
function resolveGrantedFreeThrow(
  ctx: TripContext,
  offenseSide: SideIndex,
  defenseSide: SideIndex,
  bonus: boolean,
): void {
  const { rng } = ctx;
  const team = ctx.teams[offenseSide];
  const teamPrep = ctx.preps[offenseSide];
  const shooter = rng.weightedPickTable(team.players, teamPrep.freeThrowShooterPickTable);
  const shooterSlot = slotOf(teamPrep, shooter);
  resolveFreeThrows(ctx, offenseSide, defenseSide, shooterSlot, 1, true, [0, 0], {
    bonusAttempts: bonus ? 1 : 0,
  });
}
function raceRecordPoints(ctx: TripContext, side: SideIndex, points: number): void {
  const race = ctx.race;
  if (!race || race.decided) return;
  if (side === 0) race.home += points;
  else race.away += points;
  if (race.home >= race.target) race.decided = 'home';
  else if (race.away >= race.target) race.decided = 'away';
}
function teamInBonus(foulsInPeriod: number, overtime: boolean): boolean {
  const limit = overtime
    ? ENGINE_CONSTANTS.bonusFoulsOvertime
    : ENGINE_CONSTANTS.bonusFoulsRegulation;
  return foulsInPeriod >= limit;
}
