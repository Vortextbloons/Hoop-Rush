import type {
  SeasonFoulOut,
  SeasonGamePlayerInput,
  SeasonGameSimulationInput,
  SeasonGameSimulationResult,
  SeasonGameSideResult,
  SeasonGameTeamInput,
  SeasonGameEffectsTransition,
  SeasonPlayerLoadState,
  SeasonRemoval,
  SeasonRemovalEvent,
  SeasonReturn,
  SeasonReturnEvent,
  SeasonRotation,
  SeasonRotationDeviation,
  SeasonRotationDeviationReason,
  SeasonStaminaInput,
  SeasonSubstitution,
  SeasonSubstitutionReason,
  SeasonUnitStint,
  SeasonEffectsState,
} from '@hoop-rush/data-contracts';
import type { Position, SimulationPlayer, SimulationTeam } from '@hoop-rush/data-contracts';
import type { EngineContext } from '../sim/context.ts';
import {
  MAX_PERIODS_HARD_CAP,
  OVERTIME_PERIOD_SECONDS,
  REGULATION_PERIOD_SECONDS,
  overtimePeriodsOf,
} from '../sim/periods.ts';
import { GameRecorder, type SideIndex } from '../sim/recorder.ts';
import {
  createGameState,
  createTripContext,
  PossessionStepper,
  type PossessionStep,
  type TripContext,
} from '../sim/possession.ts';
import { prepareTeam, type TeamPrep } from '../sim/prepare.ts';
import {
  chooseInitialUnit,
  planUnit,
  plannerCandidates,
  type PlannerRotationContext,
} from './rotation-planner.ts';
import { seasonHomeCourtMechanisms } from './home-court.ts';
import { FIRST_TO_SEVEN_SAFETY_POSSESSIONS } from '../sim/evolution-rules.ts';
import { FirstToSevenOvertimeExhaustedError } from '../sim/evolution-rules.ts';
import { createRng } from '../sim/rng.ts';
import { seasonNamespaceSeed, SEASON_COURT_INNOVATION_VERSION } from '@hoop-rush/data-contracts';
import { createSeasonEffectsBuffer, type SeasonEffectsBuffer } from './effects.ts';
const CHECKPOINT_MARKS: readonly number[] = [660, 600, 540, 480, 420, 360, 300, 240, 180, 120, 60];
export interface SeasonGameAvailabilitySeam {
  pregame: ReadonlyMap<string, boolean>;
  removals: readonly SeasonRemoval[];
  returns: readonly SeasonReturn[];
}
export function defaultSeasonGameSeam(
  input: SeasonGameSimulationInput,
): SeasonGameAvailabilitySeam {
  return {
    pregame: new Map(input.availability.map((entry) => [entry.playerVersionId, entry.available])),
    removals: input.removals,
    returns: input.returns,
  };
}
export function simulateSeasonGame(
  input: SeasonGameSimulationInput,
  context: EngineContext,
  options: {
    seam?: SeasonGameAvailabilitySeam;
  } = {},
): SeasonGameSimulationResult {
  const seam = options.seam ?? defaultSeasonGameSeam(input);
  const controller = new SeasonGameController(input, context, seam);
  return controller.run();
}
export function simulateSeasonGameWithEffects(
  input: SeasonGameSimulationInput,
  context: EngineContext,
  state: SeasonEffectsState,
  options: {
    seam?: SeasonGameAvailabilitySeam;
  } = {},
): {
  result: SeasonGameSimulationResult;
  transition: SeasonGameEffectsTransition;
} {
  const seam = options.seam ?? defaultSeasonGameSeam(input);
  const homeStamina = new Map<string, SeasonStaminaInput>();
  for (const player of input.home.players) {
    if (player.stamina === undefined) {
      throw new Error(
        `season effects: home player ${player.playerVersionId} has no stamina profile`,
      );
    }
    homeStamina.set(player.playerVersionId, player.stamina);
  }
  const awayStamina = new Map<string, SeasonStaminaInput>();
  for (const player of input.away.players) {
    if (player.stamina === undefined) {
      throw new Error(
        `season effects: away player ${player.playerVersionId} has no stamina profile`,
      );
    }
    awayStamina.set(player.playerVersionId, player.stamina);
  }
  const buffer = createSeasonEffectsBuffer(state, homeStamina, awayStamina);
  const controller = new SeasonGameController(input, context, seam, {
    buffer,
    pregamePlayerStates: state.playerStates,
  });
  const result = controller.run();
  const transition = controller.effectsTransition;
  if (transition === null) {
    throw new Error('season effects: controller produced no transition');
  }
  return { result, transition };
}
export interface SeasonGameEffectsMode {
  buffer: SeasonEffectsBuffer;
  pregamePlayerStates: readonly SeasonPlayerLoadState[];
}
function compareQueueEntries(
  a: {
    period: number;
    secondsRemaining: number;
    side: 'home' | 'away';
  },
  b: {
    period: number;
    secondsRemaining: number;
    side: 'home' | 'away';
  },
): number {
  const byPeriod = a.period - b.period;
  if (byPeriod !== 0) return byPeriod;
  const byClock = b.secondsRemaining - a.secondsRemaining;
  if (byClock !== 0) return byClock;
  return a.side === b.side ? 0 : a.side === 'home' ? -1 : 1;
}
class SideState {
  readonly side: 'home' | 'away';
  readonly sideIndex: SideIndex;
  readonly teamInput: SeasonGameTeamInput;
  readonly rotation: SeasonRotation;
  readonly planner: PlannerRotationContext;
  readonly roster: readonly SeasonGamePlayerInput[];
  readonly simPlayers: SimulationPlayer[];
  readonly rosterIndexByVersion: ReadonlyMap<string, number>;
  unit: string[] = [];
  readonly unavailable = new Set<string>();
  readonly fouledOut = new Set<string>();
  readonly removed = new Set<string>();
  readonly causes = new Map<string, Set<SeasonRotationDeviationReason>>();
  readonly regulationSeconds = new Map<string, number>();
  readonly substitutions: SeasonSubstitution[] = [];
  readonly stints: SeasonUnitStint[] = [];
  readonly foulOutEvents: SeasonFoulOut[] = [];
  readonly removalEvents: SeasonRemovalEvent[] = [];
  readonly returnEvents: SeasonReturnEvent[] = [];
  stint: {
    period: number;
    openClock: number;
    cursor: number;
    unit: string[];
  } | null = null;
  boundaryEvents: {
    foulOuts: number;
    removals: number;
    returns: number;
  } = {
    foulOuts: 0,
    removals: 0,
    returns: 0,
  };
  changedThisBoundary = false;
  private checkpointIndex = 0;
  candidateCache: {
    signature: string;
    list: readonly (readonly string[])[];
  } | null = null;
  constructor(
    side: 'home' | 'away',
    sideIndex: SideIndex,
    teamInput: SeasonGameTeamInput,
    rotation: SeasonRotation,
    pregame: ReadonlyMap<string, boolean>,
  ) {
    this.side = side;
    this.sideIndex = sideIndex;
    this.teamInput = teamInput;
    this.rotation = rotation;
    this.roster = teamInput.players;
    this.rosterIndexByVersion = new Map(
      teamInput.players.map((player, index) => [player.playerVersionId, index]),
    );
    const members = new Map<string, readonly Position[]>();
    const targets = new Map<string, number>();
    for (const player of teamInput.players) {
      members.set(player.playerVersionId, player.positions);
      targets.set(player.playerVersionId, targetSecondsFor(rotation, player.playerVersionId));
      if (pregame.get(player.playerVersionId) === false) {
        this.unavailable.add(player.playerVersionId);
        this.causesFor(player.playerVersionId).add('pregame-unavailable');
      }
    }
    this.planner = { rotation, members, targets };
    this.simPlayers = teamInput.players.map(toSimulationPlayer);
  }
  causesFor(playerVersionId: string): Set<SeasonRotationDeviationReason> {
    let set = this.causes.get(playerVersionId);
    if (set === undefined) {
      set = new Set();
      this.causes.set(playerVersionId, set);
    }
    return set;
  }
  consumeCheckpoints(period: number, clock: number): boolean {
    if (period > 4) return false;
    const before = this.checkpointIndex;
    while (
      this.checkpointIndex < CHECKPOINT_MARKS.length &&
      (CHECKPOINT_MARKS[this.checkpointIndex] ?? 0) >= clock
    ) {
      this.checkpointIndex += 1;
    }
    return this.checkpointIndex > before;
  }
  resetCheckpoints(): void {
    this.checkpointIndex = 0;
  }
}
class SeasonGameController {
  private readonly input: SeasonGameSimulationInput;
  private readonly context: EngineContext;
  private readonly rng: ReturnType<EngineContext['rngFactory']>;
  private readonly profile: SeasonGameSimulationInput['profile'];
  private readonly recorder: GameRecorder;
  private readonly state: ReturnType<typeof createGameState>;
  private readonly tripContext: TripContext;
  private readonly home: SideState;
  private readonly away: SideState;
  private readonly removalQueue: SeasonRemoval[];
  private readonly returnQueue: SeasonReturn[];
  private readonly effectsMode: SeasonGameEffectsMode | null;
  private readonly prepCache = new Map<string, TeamPrep>();
  private offense: SideIndex = 0;
  private readonly gameRule: import('@hoop-rush/data-contracts').SeasonGameRule;
  private otElapsed = 0;
  private otPossessions = 0;
  private otEventOrder = 0;
  private otLastPlanElapsed = 0;
  private otBoundaryElapsed = 0;
  private otStints: {
    home: { unit: string[]; elapsedStart: number } | null;
    away: { unit: string[]; elapsedStart: number } | null;
  } = { home: null, away: null };
  private secondsRemaining = REGULATION_PERIOD_SECONDS;
  private period = 1;
  private boundaryClock = 0;
  effectsTransition: SeasonGameEffectsTransition | null = null;
  constructor(
    input: SeasonGameSimulationInput,
    context: EngineContext,
    seam: SeasonGameAvailabilitySeam,
    effectsMode: SeasonGameEffectsMode | null = null,
  ) {
    this.input = input;
    this.gameRule = input.gameRule ?? 'standard';
    this.context = context;
    this.input = input;
    this.gameRule = input.gameRule ?? 'standard';
    this.profile = input.profile;
    this.rng = context.rngFactory(input.seed);
    this.recorder = new GameRecorder([10, 10]);
    this.state = createGameState();
    this.home = new SideState('home', 0, input.home, input.homeRotation, seam.pregame);
    this.away = new SideState('away', 1, input.away, input.awayRotation, seam.pregame);
    const placeholder: [SimulationTeam, SimulationTeam] = [
      {
        teamId: input.home.teamId,
        displayName: input.home.displayName,
        players: this.home.simPlayers.slice(0, 5),
      },
      {
        teamId: input.away.teamId,
        displayName: input.away.displayName,
        players: this.away.simPlayers.slice(0, 5),
      },
    ];
    this.effectsMode = effectsMode;
    this.tripContext = createTripContext(
      this.rng,
      this.recorder,
      this.state,
      this.profile,
      placeholder,
      seasonHomeCourtMechanisms(input.homeCourt),
      effectsMode?.buffer.hook,
    );
    this.tripContext.gameRule = this.gameRule;
    this.removalQueue = [...seam.removals].sort(compareQueueEntries);
    this.returnQueue = [...seam.returns].sort(compareQueueEntries);
  }
  run(): SeasonGameSimulationResult {
    const tipoffForfeit = this.tipoff();
    if (tipoffForfeit !== null) return this.exitWithEffects(tipoffForfeit);
    for (this.period = 1; ; this.period += 1) {
      if (this.period > MAX_PERIODS_HARD_CAP) {
        throw new Error(
          `season: exceeded hard cap ${String(MAX_PERIODS_HARD_CAP)} periods without a winner (${String(this.recorder.sides[0].points)}-${String(this.recorder.sides[1].points)})`,
        );
      }
      if (this.period > 1) {
        if (this.period >= 5) {
          if (this.recorder.sides[0].points !== this.recorder.sides[1].points) break;
        }
        if (this.period > MAX_PERIODS_HARD_CAP) {
          throw new Error(
            `season: exceeded hard cap ${String(MAX_PERIODS_HARD_CAP)} periods without a winner`,
          );
        }
        this.recorder.nextPeriod();
        this.secondsRemaining =
          this.period <= 4 ? REGULATION_PERIOD_SECONDS : OVERTIME_PERIOD_SECONDS;
        this.state.periodIndex = this.period - 1;
        this.state.periodFouls = [0, 0];
        this.tripContext.possessionStart = 'neutral';
        if (this.period === 3) this.effectsMode?.buffer.hook.halftime();
        if (
          this.period === 5 &&
          this.gameRule === 'first-to-seven-overtime' &&
          this.recorder.sides[0].points === this.recorder.sides[1].points
        ) {
          return this.exitWithEffects(this.runOvertimeRace());
        }
      }
      this.home.resetCheckpoints();
      this.away.resetCheckpoints();
      while (this.secondsRemaining > 0) {
        this.state.secondsRemaining = this.secondsRemaining;
        const trip = this.driveOneTrip();
        if (trip.forfeit !== null) return this.exitWithEffects(trip.forfeit);
        this.secondsRemaining = this.state.secondsRemaining;
        if (trip.step.ended) this.offense = (1 - this.offense) as SideIndex;
        if (trip.step.periodEnded) break;
      }
    }
    return this.exitWithEffects(this.buildResult());
  }
  private exitWithEffects(result: SeasonGameSimulationResult): SeasonGameSimulationResult {
    const effects = this.effectsMode;
    if (effects !== null && this.effectsTransition === null) {
      const finished = effects.buffer.finishGame(
        this.home.regulationSeconds,
        this.away.regulationSeconds,
      );
      this.effectsTransition = {
        schemaVersion: 1,
        pregamePlayerStates: [...effects.pregamePlayerStates],
        postgamePlayerStates: finished.postgamePlayerStates,
        pairIncrements: finished.pairIncrements,
        evidence: finished.evidence,
      };
    }
    return result;
  }
  private tipoff(): SeasonGameSimulationResult | null {
    this.applyDueRemovals(1, REGULATION_PERIOD_SECONDS, REGULATION_PERIOD_SECONDS, false, true);
    this.applyDueReturns(1, REGULATION_PERIOD_SECONDS, REGULATION_PERIOD_SECONDS, false);
    const homeUnit = chooseInitialUnit(this.home.planner, this.home.unavailable);
    const awayUnit = chooseInitialUnit(this.away.planner, this.away.unavailable);
    if (homeUnit === null && awayUnit === null) {
      return {
        schemaVersion: 1,
        outcome: 'no-legal-five-both',
        seed: this.input.seed,
        gameNumber: this.input.gameNumber,
        dataVersion: this.input.dataVersion,
        engineVersion: this.context.engineVersion,
        profileVersion: this.profile.profileVersion,
      };
    }
    if (homeUnit === null) {
      return this.forfeitResult(this.home, 'no-legal-five-tipoff');
    }
    if (awayUnit === null) {
      return this.forfeitResult(this.away, 'no-legal-five-tipoff');
    }
    this.home.unit = [...homeUnit];
    this.away.unit = [...awayUnit];
    this.markInitialCauses(this.home, homeUnit);
    this.markInitialCauses(this.away, awayUnit);
    this.activateUnit(this.home);
    this.activateUnit(this.away);
    this.offense = this.rng.chance(0.5) ? 0 : 1;
    this.secondsRemaining = REGULATION_PERIOD_SECONDS;
    this.state.periodIndex = 0;
    this.home.stint = {
      period: 1,
      openClock: REGULATION_PERIOD_SECONDS,
      cursor: REGULATION_PERIOD_SECONDS,
      unit: [...homeUnit],
    };
    this.away.stint = {
      period: 1,
      openClock: REGULATION_PERIOD_SECONDS,
      cursor: REGULATION_PERIOD_SECONDS,
      unit: [...awayUnit],
    };
    return null;
  }
  private driveOneTrip(): {
    step: PossessionStep;
    forfeit: SeasonGameSimulationResult | null;
  } {
    const machine = new PossessionStepper(this.tripContext, this.offense);
    let step: PossessionStep = { ended: false, pause: false, periodEnded: false, finished: false };
    do {
      step = machine.step();
      if (step.pause || step.periodEnded) {
        const forfeit = this.processBoundary(step.periodEnded);
        if (forfeit !== null) return { step, forfeit };
      }
    } while (!step.periodEnded && !step.finished);
    return { step, forfeit: null };
  }
  private static readonly OVERTIME_RACE_CLOCK = 1000000;
  private runOvertimeRace(): SeasonGameSimulationResult {
    const race = { home: 0, away: 0, target: 7, decided: null as 'home' | 'away' | null };
    this.tripContext.race = race;
    this.period = 5;
    this.state.periodIndex = 4;
    const tipSeed = seasonNamespaceSeed(this.input.seed, 'overtime-tip');
    this.offense = createRng(tipSeed).chance(0.5) ? 0 : 1;
    this.tripContext.possessionStart = 'neutral';
    this.otElapsed = 0;
    this.otPossessions = 0;
    this.otEventOrder = 0;
    this.otLastPlanElapsed = 0;
    this.otBoundaryElapsed = 0;
    this.home.stint = null;
    this.away.stint = null;
    this.otStints = {
      home: { unit: [...this.home.unit], elapsedStart: 0 },
      away: { unit: [...this.away.unit], elapsedStart: 0 },
    };
    for (;;) {
      if (this.otPossessions > FIRST_TO_SEVEN_SAFETY_POSSESSIONS) {
        throw new FirstToSevenOvertimeExhaustedError(this.otPossessions, race.home, race.away);
      }
      this.state.secondsRemaining = SeasonGameController.OVERTIME_RACE_CLOCK;
      const trip = this.driveOneOvertimeTrip();
      if (trip.forfeit !== null) return trip.forfeit;
      this.otElapsed += SeasonGameController.OVERTIME_RACE_CLOCK - this.state.secondsRemaining;
      this.processOvertimeBoundary(true);
      if (trip.step.ended) {
        this.otPossessions += 1;
        this.offense = (1 - this.offense) as SideIndex;
      }
      if (race.decided) break;
    }
    this.closeOvertimeStints();
    return this.buildResult(race);
  }
  private driveOneOvertimeTrip(): {
    step: PossessionStep;
    forfeit: SeasonGameSimulationResult | null;
  } {
    const machine = new PossessionStepper(this.tripContext, this.offense);
    let step: PossessionStep = { ended: false, pause: false, periodEnded: false, finished: false };
    do {
      step = machine.step();
      if (step.pause) {
        const forfeit = this.processOvertimeBoundary(false);
        if (forfeit !== null) return { step, forfeit };
      }
    } while (!step.finished);
    return { step, forfeit: null };
  }
  private overtimeElapsedFloat(): number {
    return (
      this.otElapsed + (SeasonGameController.OVERTIME_RACE_CLOCK - this.state.secondsRemaining)
    );
  }
  private distributeOvertimeMinutes(): void {
    const nowFloor = Math.floor(this.overtimeElapsedFloat());
    const delta = nowFloor - this.otBoundaryElapsed;
    if (delta <= 0) return;
    for (const side of [this.home, this.away]) {
      for (const playerVersionId of side.unit) {
        const rosterIndex = side.rosterIndexByVersion.get(playerVersionId);
        if (rosterIndex === undefined) continue;
        this.recorder.playSeconds(side.sideIndex, rosterIndex, delta);
      }
      this.effectsMode?.buffer.hook.recordStintSeconds(side.sideIndex, delta, side.unit);
    }
    this.otBoundaryElapsed = nowFloor;
  }
  private processOvertimeBoundary(final: boolean): SeasonGameSimulationResult | null {
    this.distributeOvertimeMinutes();
    const elapsedFloor = Math.floor(this.overtimeElapsedFloat());
    for (const side of [this.home, this.away]) {
      side.boundaryEvents = { foulOuts: 0, removals: 0, returns: 0 };
      side.changedThisBoundary = false;
    }
    this.applyOvertimeRemovals(elapsedFloor);
    this.applyOvertimeReturns(elapsedFloor);
    this.applyOvertimeFoulOuts(this.home, elapsedFloor);
    this.applyOvertimeFoulOuts(this.away, elapsedFloor);
    if (final) return null;
    if (this.tripContext.race?.decided) return null;
    const minuteCheck = elapsedFloor - this.otLastPlanElapsed >= 60;
    for (const side of [this.home, this.away]) {
      const events =
        side.boundaryEvents.foulOuts + side.boundaryEvents.removals + side.boundaryEvents.returns;
      if (events === 0 && !minuteCheck) continue;
      const unit = planUnit(
        side.planner,
        {
          side: side.side,
          currentUnit: side.unit,
          unavailable: side.unavailable,
          actualSeconds: side.regulationSeconds,
          period: 5,
          secondsRemaining: 0,
          closingWindow: false,
          scoreMargin: this.scoreMargin(),
        },
        { candidates: this.cachedCandidates(side) },
      );
      if (unit === null) {
        return this.forfeitResult(side, 'no-legal-five-after-removal');
      }
      const reason: SeasonSubstitutionReason =
        side.boundaryEvents.foulOuts > 0
          ? 'foul-out'
          : side.boundaryEvents.removals > 0
            ? 'injected-injury-removal'
            : 'rotation-plan';
      this.applyOvertimeSubstitution(side, unit, elapsedFloor, reason);
    }
    if (minuteCheck) this.otLastPlanElapsed = elapsedFloor;
    return null;
  }
  private applyOvertimeRemovals(elapsedFloor: number): void {
    for (let index = 0; index < this.removalQueue.length;) {
      const removal = this.removalQueue[index];
      if (removal === undefined || removal.period < 5) {
        index += 1;
        continue;
      }
      const dueElapsed = (removal.period - 5) * 300 + (300 - removal.secondsRemaining);
      if (elapsedFloor < dueElapsed) {
        index += 1;
        continue;
      }
      this.removalQueue.splice(index, 1);
      const side = removal.side === 'home' ? this.home : this.away;
      side.removed.add(removal.playerVersionId);
      side.unavailable.add(removal.playerVersionId);
      side.causesFor(removal.playerVersionId).add('injected-injury-removal');
      side.removalEvents.push({
        side: removal.side,
        playerVersionId: removal.playerVersionId,
        period: 5,
        secondsRemaining: 0,
        reason: removal.reason,
        clockKind: 'untimed' as const,
        elapsedSeconds: elapsedFloor,
        eventOrder: this.otEventOrder++,
      });
      side.boundaryEvents.removals += 1;
    }
  }
  private applyOvertimeReturns(elapsedFloor: number): void {
    for (let index = 0; index < this.returnQueue.length;) {
      const ret = this.returnQueue[index];
      if (ret === undefined || ret.period < 5) {
        index += 1;
        continue;
      }
      const dueElapsed = (ret.period - 5) * 300 + (300 - ret.secondsRemaining);
      if (elapsedFloor < dueElapsed) {
        index += 1;
        continue;
      }
      this.returnQueue.splice(index, 1);
      const side = ret.side === 'home' ? this.home : this.away;
      if (side.fouledOut.has(ret.playerVersionId)) continue;
      side.removed.delete(ret.playerVersionId);
      side.unavailable.delete(ret.playerVersionId);
      side.causesFor(ret.playerVersionId).add('injury-return');
      side.returnEvents.push({
        side: ret.side,
        playerVersionId: ret.playerVersionId,
        period: 5,
        secondsRemaining: 0,
        reason: ret.reason,
        clockKind: 'untimed' as const,
        elapsedSeconds: elapsedFloor,
        eventOrder: this.otEventOrder++,
      });
      side.boundaryEvents.returns += 1;
    }
  }
  private applyOvertimeFoulOuts(side: SideState, elapsedFloor: number): void {
    for (const playerVersionId of side.unit) {
      if (side.fouledOut.has(playerVersionId)) continue;
      const rosterIndex = side.rosterIndexByVersion.get(playerVersionId);
      const record =
        rosterIndex === undefined ? undefined : this.recorder.players[side.sideIndex][rosterIndex];
      if (record === undefined) continue;
      if (record.fouls >= 6) {
        side.fouledOut.add(playerVersionId);
        side.unavailable.add(playerVersionId);
        side.causesFor(playerVersionId).add('foul-out');
        side.foulOutEvents.push({
          side: side.side,
          playerVersionId,
          period: 5,
          secondsRemaining: 0,
          clockKind: 'untimed' as const,
          elapsedSeconds: elapsedFloor,
          eventOrder: this.otEventOrder++,
        });
        side.boundaryEvents.foulOuts += 1;
      }
    }
  }
  private applyOvertimeSubstitution(
    side: SideState,
    planned: readonly string[],
    elapsedFloor: number,
    reason: SeasonSubstitutionReason,
  ): void {
    const oldUnit = side.unit;
    if (sameUnit(planned, oldUnit)) {
      side.changedThisBoundary = false;
      return;
    }
    const oldSet = new Set(oldUnit);
    const newSet = new Set(planned);
    const outs = oldUnit.filter((id) => !newSet.has(id));
    const ins = planned.filter((id) => !oldSet.has(id));
    let changes = 0;
    for (let i = 0; i < outs.length; i += 1) {
      const out = outs[i];
      const inn = ins[i];
      if (out === undefined || inn === undefined) continue;
      changes += 1;
      side.causesFor(out).add('dead-ball-timing');
      side.causesFor(inn).add('dead-ball-timing');
      side.substitutions.push({
        side: side.side,
        period: 5,
        secondsRemaining: 0,
        playerIn: inn,
        playerOut: out,
        reason,
        unit: [...planned],
        clockKind: 'untimed' as const,
        elapsedSeconds: elapsedFloor,
        eventOrder: this.otEventOrder++,
      });
    }
    side.changedThisBoundary = changes > 0;
    if (changes > 0) {
      this.closeOvertimeStint(side);
      side.unit = [...planned];
      this.activateUnit(side);
      this.openOvertimeStint(side);
    }
  }
  private openOvertimeStint(side: SideState): void {
    const key = side.side === 'home' ? 'home' : 'away';
    this.otStints[key] = {
      unit: [...side.unit],
      elapsedStart: Math.floor(this.overtimeElapsedFloat()),
    };
  }
  private closeOvertimeStint(side: SideState): void {
    const key = side.side === 'home' ? 'home' : 'away';
    const open = this.otStints[key];
    if (open === null) return;
    const elapsedEnd = Math.floor(this.overtimeElapsedFloat());
    side.stints.push({
      side: side.side,
      period: 5,
      startSecondsRemaining: 0,
      endSecondsRemaining: 0,
      durationSeconds: Math.max(0, elapsedEnd - open.elapsedStart),
      players: [...open.unit],
      clockKind: 'untimed' as const,
      elapsedStartSeconds: open.elapsedStart,
      elapsedEndSeconds: elapsedEnd,
      eventOrder: this.otEventOrder++,
    });
    this.otStints[key] = null;
  }
  private closeOvertimeStints(): void {
    this.closeOvertimeStint(this.home);
    this.closeOvertimeStint(this.away);
  }
  private processBoundary(periodEnded: boolean): SeasonGameSimulationResult | null {
    const period = this.period;
    const floatClock = this.state.secondsRemaining;
    const clock = periodEnded ? 0 : Math.floor(floatClock);
    this.boundaryClock = clock;
    for (const side of [this.home, this.away]) {
      side.boundaryEvents = { foulOuts: 0, removals: 0, returns: 0 };
      side.changedThisBoundary = false;
    }
    this.applyDueRemovals(period, floatClock, clock, periodEnded);
    this.applyDueReturns(period, floatClock, clock, periodEnded);
    this.applyFoulOuts(this.home, period, clock);
    this.applyFoulOuts(this.away, period, clock);
    for (const side of [this.home, this.away]) {
      this.accumulateStintInterval(side, period, clock);
    }
    const gameContinues = this.gameContinuesAfter(period, periodEnded);
    for (const side of [this.home, this.away]) {
      if (!gameContinues) continue;
      const plan = this.planFor(side, period, periodEnded, clock);
      if (plan === null) continue;
      if (plan.unit === null) {
        return this.forfeitResult(side, 'no-legal-five-after-removal');
      }
      this.applySubstitutionIfChanged(side, plan.unit, period, clock, plan.reason);
    }
    for (const side of [this.home, this.away]) {
      this.finalizeStint(side, period, clock, periodEnded);
    }
    for (const side of [this.home, this.away]) {
      if (gameContinues) this.reopenStint(side, period, periodEnded);
    }
    return null;
  }
  private applyDueRemovals(
    period: number,
    floatClock: number,
    boundaryClock: number,
    periodEnded: boolean,
    _allowPregame: boolean = false,
  ): void {
    void _allowPregame;
    for (let index = 0; index < this.removalQueue.length;) {
      const removal = this.removalQueue[index];
      if (removal === undefined) break;
      if (!this.queueEntryIsDue(removal, period, floatClock, periodEnded)) {
        index += 1;
        continue;
      }
      const side = removal.side === 'home' ? this.home : this.away;
      this.removalQueue.splice(index, 1);
      side.removed.add(removal.playerVersionId);
      side.unavailable.add(removal.playerVersionId);
      side.causesFor(removal.playerVersionId).add('injected-injury-removal');
      side.removalEvents.push({
        side: removal.side,
        playerVersionId: removal.playerVersionId,
        period,
        secondsRemaining: boundaryClock,
        reason: removal.reason,
      });
      side.boundaryEvents.removals += 1;
    }
  }
  private applyDueReturns(
    period: number,
    floatClock: number,
    boundaryClock: number,
    periodEnded: boolean,
  ): void {
    this.drainQueue(
      this.returnQueue,
      period,
      floatClock,
      boundaryClock,
      periodEnded,
      (ret, side) => {
        if (side.fouledOut.has(ret.playerVersionId)) return;
        side.removed.delete(ret.playerVersionId);
        side.unavailable.delete(ret.playerVersionId);
        side.causesFor(ret.playerVersionId).add('injury-return');
        side.returnEvents.push({
          side: ret.side,
          playerVersionId: ret.playerVersionId,
          period,
          secondsRemaining: boundaryClock,
          reason: ret.reason,
        });
        side.boundaryEvents.returns += 1;
      },
    );
  }
  private drainQueue<
    T extends {
      period: number;
      secondsRemaining: number;
      side: 'home' | 'away';
    },
  >(
    queue: T[],
    period: number,
    floatClock: number,
    boundaryClock: number,
    periodEnded: boolean,
    apply: (entry: T, side: SideState) => void,
  ): void {
    while (queue.length > 0) {
      const entry = queue[0];
      if (entry === undefined) break;
      if (entry.period > period) break;
      if (!periodEnded && entry.period === period && floatClock > entry.secondsRemaining) {
        break;
      }
      queue.shift();
      const side = entry.side === 'home' ? this.home : this.away;
      apply(entry, side);
    }
  }
  private queueEntryIsDue(
    entry: {
      period: number;
      secondsRemaining: number;
    },
    period: number,
    floatClock: number,
    periodEnded: boolean,
  ): boolean {
    if (entry.period > period) return false;
    return periodEnded || entry.period < period || floatClock <= entry.secondsRemaining;
  }
  private applyFoulOuts(side: SideState, period: number, clock: number): void {
    for (const playerVersionId of side.unit) {
      if (side.fouledOut.has(playerVersionId)) continue;
      const rosterIndex = side.rosterIndexByVersion.get(playerVersionId);
      const rosterRecord =
        rosterIndex === undefined ? undefined : this.recorder.players[side.sideIndex][rosterIndex];
      if (rosterRecord === undefined) continue;
      if (rosterRecord.fouls >= 6) {
        side.fouledOut.add(playerVersionId);
        side.unavailable.add(playerVersionId);
        side.causesFor(playerVersionId).add('foul-out');
        side.foulOutEvents.push({
          side: side.side,
          playerVersionId,
          period,
          secondsRemaining: clock,
        });
        side.boundaryEvents.foulOuts += 1;
      }
    }
  }
  private cachedCandidates(side: SideState): readonly (readonly string[])[] {
    const signature = [...side.unavailable].sort().join('\u0000');
    if (side.candidateCache !== null && side.candidateCache.signature === signature) {
      return side.candidateCache.list;
    }
    const list = plannerCandidates(side.planner, side.unavailable);
    side.candidateCache = { signature, list };
    return list;
  }
  private planFor(
    side: SideState,
    period: number,
    periodEnded: boolean,
    clock: number,
  ): {
    reason: SeasonSubstitutionReason;
    unit: string[] | null;
  } | null {
    const hasFoulOut = side.boundaryEvents.foulOuts > 0;
    const hasRemoval = side.boundaryEvents.removals > 0;
    const hasReturn = side.boundaryEvents.returns > 0;
    const eventReason: SeasonSubstitutionReason | null = hasFoulOut
      ? 'foul-out'
      : hasRemoval
        ? 'injected-injury-removal'
        : hasReturn
          ? 'rotation-plan'
          : null;
    const nextPeriod = periodEnded ? period + 1 : period;
    const nextClock = periodEnded
      ? nextPeriod <= 4
        ? REGULATION_PERIOD_SECONDS
        : OVERTIME_PERIOD_SECONDS
      : clock;
    const closingWindow = !periodEnded && this.closingWindowApplies(period, clock);
    if (!periodEnded) {
      const crossed = side.consumeCheckpoints(period, clock);
      if (eventReason === null && !crossed) return null;
    }
    const unit = planUnit(
      side.planner,
      {
        side: side.side,
        currentUnit: side.unit,
        unavailable: side.unavailable,
        actualSeconds: side.regulationSeconds,
        period: nextPeriod,
        secondsRemaining: nextClock,
        closingWindow,
        scoreMargin: this.scoreMargin(),
      },
      { candidates: this.cachedCandidates(side) },
    );
    let reason: SeasonSubstitutionReason;
    if (eventReason !== null) {
      reason = eventReason;
    } else if (periodEnded) {
      reason =
        nextPeriod > 4
          ? unit !== null && sameUnit(unit, side.rotation.closingFive)
            ? 'closing-preference'
            : 'contingency-legality'
          : 'rotation-plan';
    } else {
      reason = closingWindow ? 'closing-preference' : 'rotation-plan';
    }
    return { reason, unit };
  }
  private applySubstitutionIfChanged(
    side: SideState,
    planned: readonly string[],
    period: number,
    clock: number,
    reason: SeasonSubstitutionReason,
  ): void {
    const oldUnit = side.unit;
    if (sameUnit(planned, oldUnit)) {
      side.changedThisBoundary = false;
      return;
    }
    const oldSet = new Set(oldUnit);
    const newSet = new Set(planned);
    const outs = oldUnit.filter((id) => !newSet.has(id));
    const ins = planned.filter((id) => !oldSet.has(id));
    let changes = 0;
    for (let i = 0; i < outs.length; i += 1) {
      const out = outs[i];
      const inn = ins[i];
      if (out === undefined || inn === undefined) continue;
      changes += 1;
      side.causesFor(out).add('dead-ball-timing');
      side.causesFor(inn).add('dead-ball-timing');
      if (reason === 'closing-preference' || reason === 'contingency-legality') {
        side.causesFor(out).add(reason);
        side.causesFor(inn).add(reason);
      }
      side.substitutions.push({
        side: side.side,
        period,
        secondsRemaining: clock,
        playerIn: inn,
        playerOut: out,
        reason,
        unit: [...planned],
      });
    }
    side.changedThisBoundary = changes > 0;
    if (changes > 0) {
      side.unit = [...planned];
      this.activateUnit(side);
    }
  }
  private activateUnit(side: SideState): void {
    const { team, rosterIndices } = this.buildUnitTeam(side);
    this.tripContext.teams[side.sideIndex] = team;
    this.tripContext.teamUnits[side.sideIndex] = [...side.unit];
    this.tripContext.preps[side.sideIndex] = this.cachedPrep(team);
    this.recorder.setActiveFive(side.sideIndex, rosterIndices);
    this.effectsMode?.buffer.hook.setActiveUnits(this.home.unit, this.away.unit);
  }
  private cachedPrep(team: SimulationTeam): TeamPrep {
    const key = `${team.teamId}|${team.players.map((player) => player.playerVersionId ?? player.playerId).join(',')}|${this.profile.profileVersion}`;
    let prep = this.prepCache.get(key);
    if (prep === undefined) {
      prep = prepareTeam(team, this.profile);
      this.prepCache.set(key, prep);
    }
    return prep;
  }
  private buildUnitTeam(side: SideState): {
    team: SimulationTeam;
    rosterIndices: number[];
  } {
    const players: SimulationPlayer[] = [];
    const rosterIndices: number[] = [];
    for (const playerVersionId of side.unit) {
      const rosterIndex = side.rosterIndexByVersion.get(playerVersionId);
      if (rosterIndex === undefined) {
        throw new Error(`season: no simulation player for version ${playerVersionId}`);
      }
      const player = side.simPlayers[rosterIndex];
      if (player === undefined) {
        throw new Error(`season: no simulation player for version ${playerVersionId}`);
      }
      players.push(player);
      rosterIndices.push(rosterIndex);
    }
    return {
      team: {
        teamId: side.teamInput.teamId,
        displayName: side.teamInput.displayName,
        players,
      },
      rosterIndices,
    };
  }
  private accumulateStintInterval(side: SideState, period: number, clock: number): void {
    const stint = side.stint;
    if (stint === null) {
      throw new Error(`season: no open stint for ${side.side}`);
    }
    if (stint.period !== period) {
      throw new Error(
        `season: stint opened in period ${String(stint.period)} closed in period ${String(period)}`,
      );
    }
    const duration = stint.cursor - clock;
    for (const playerVersionId of stint.unit) {
      const rosterIndex = side.rosterIndexByVersion.get(playerVersionId);
      if (rosterIndex === undefined) {
        throw new Error(`season: no roster index for version ${playerVersionId}`);
      }
      if (period <= 4) {
        side.regulationSeconds.set(
          playerVersionId,
          (side.regulationSeconds.get(playerVersionId) ?? 0) + duration,
        );
      }
      this.recorder.playSeconds(side.sideIndex, rosterIndex, duration);
    }
    this.effectsMode?.buffer.hook.recordStintSeconds(side.sideIndex, duration, stint.unit);
    stint.cursor = clock;
  }
  private finalizeStint(
    side: SideState,
    period: number,
    clock: number,
    periodEnded: boolean,
  ): void {
    const stint = side.stint;
    if (stint === null) {
      throw new Error(`season: no open stint for ${side.side}`);
    }
    if (periodEnded || side.changedThisBoundary) {
      const endClock = periodEnded ? 0 : clock;
      side.stints.push({
        side: side.side,
        period: stint.period,
        startSecondsRemaining: stint.openClock,
        endSecondsRemaining: endClock,
        durationSeconds: stint.openClock - endClock,
        players: [...stint.unit],
      });
      side.stint = null;
    }
  }
  private reopenStint(side: SideState, period: number, periodEnded: boolean): void {
    if (side.stint !== null) return;
    const clock = periodEnded
      ? period + 1 <= 4
        ? REGULATION_PERIOD_SECONDS
        : OVERTIME_PERIOD_SECONDS
      : this.boundaryClock;
    side.stint = {
      period: periodEnded ? period + 1 : period,
      openClock: clock,
      cursor: clock,
      unit: [...side.unit],
    };
  }
  private gameContinuesAfter(period: number, periodEnded: boolean): boolean {
    if (!periodEnded) return true;
    if (period >= MAX_PERIODS_HARD_CAP) return false;
    if (period <= 3) return true;
    return this.recorder.sides[0].points === this.recorder.sides[1].points;
  }
  private closingWindowApplies(period: number, clock: number): boolean {
    return period === 4 && clock <= 300 && this.scoreMargin() <= 12;
  }
  private scoreMargin(): number {
    return Math.abs(this.recorder.sides[0].points - this.recorder.sides[1].points);
  }
  private markInitialCauses(side: SideState, unit: readonly string[]): void {
    for (const playerVersionId of unit) {
      side.causesFor(playerVersionId).add('dead-ball-timing');
    }
    if (!sameUnit(unit, side.rotation.starters)) {
      for (const playerVersionId of unit) {
        side.causesFor(playerVersionId).add('contingency-legality');
      }
    }
  }
  private forfeitResult(
    loser: SideState,
    trigger: 'no-legal-five-tipoff' | 'no-legal-five-after-removal',
  ): SeasonGameSimulationResult {
    const homeWins = loser === this.away;
    return {
      schemaVersion: 1,
      outcome: 'forfeit',
      seed: this.input.seed,
      gameNumber: this.input.gameNumber,
      dataVersion: this.input.dataVersion,
      engineVersion: this.context.engineVersion,
      profileVersion: this.profile.profileVersion,
      winner: homeWins ? 'home' : 'away',
      ...(this.gameRule !== 'standard' ? { gameRule: this.gameRule } : {}),
      ...(this.gameRule !== 'standard' ? { ruleVersion: SEASON_COURT_INNOVATION_VERSION } : {}),
      losingFranchiseId: loser.teamInput.franchiseId,
      trigger,
      homeScore: (homeWins ? 2 : 0) as 2,
      awayScore: (homeWins ? 0 : 2) as 0,
    };
  }
  private buildResult(race?: {
    home: number;
    away: number;
    target: number;
  }): SeasonGameSimulationResult {
    const overtimePeriods = race
      ? 1
      : overtimePeriodsOf(this.recorder.sides[0].periodPoints.length);
    const homeScore = this.recorder.sides[0].points;
    const awayScore = this.recorder.sides[1].points;
    if (homeScore === awayScore) {
      throw new Error(
        `season: game ended tied ${String(homeScore)}-${String(awayScore)} after ${String(overtimePeriods)} overtime periods`,
      );
    }
    const winner = homeScore > awayScore ? 'home' : 'away';
    return {
      schemaVersion: 1,
      outcome: 'completed',
      seed: this.input.seed,
      gameNumber: this.input.gameNumber,
      dataVersion: this.input.dataVersion,
      engineVersion: this.context.engineVersion,
      profileVersion: this.profile.profileVersion,
      winner,
      overtimePeriods,
      ...(this.gameRule !== 'standard' ? { gameRule: this.gameRule } : {}),
      ...(this.gameRule !== 'standard' ? { ruleVersion: SEASON_COURT_INNOVATION_VERSION } : {}),
      ...(race
        ? {
            overtimeRace: {
              target: 7 as const,
              homePoints: race.home,
              awayPoints: race.away,
              possessions: this.otPossessions,
            },
          }
        : {}),
      home: this.sideResult(0, this.home),
      away: this.sideResult(1, this.away),
      substitutions: [...this.home.substitutions, ...this.away.substitutions],
      unitStints: [...this.home.stints, ...this.away.stints],
      deviations: [...this.deviationsFor(this.home), ...this.deviationsFor(this.away)],
      foulOuts: [...this.home.foulOutEvents, ...this.away.foulOutEvents],
      removals: [...this.home.removalEvents, ...this.away.removalEvents],
    };
  }
  private sideResult(index: SideIndex, side: SideState): SeasonGameSideResult {
    const teamInput = side.teamInput;
    const { teamId: _teamId, ...box } = this.recorder.seasonTeamBox(index, teamInput.teamId);
    void _teamId;
    return {
      teamId: teamInput.teamId,
      displayName: teamInput.displayName,
      franchiseId: teamInput.franchiseId,
      score: this.recorder.sides[index].points,
      periodScores: this.recorder.sides[index].periodPoints,
      box,
      players: teamInput.players.map((player, rosterIndex) => {
        const playerBox = this.recorder.seasonPlayerBox(index, rosterIndex);
        return {
          playerVersionId: player.playerVersionId,
          playerId: player.playerId,
          ...playerBox,
        };
      }),
      shotZones: this.recorder.zoneSummary(index),
      returns: [...side.returnEvents],
    };
  }
  private deviationsFor(side: SideState): SeasonRotationDeviation[] {
    const deviations: SeasonRotationDeviation[] = [];
    for (const player of side.roster) {
      const actualSeconds = side.regulationSeconds.get(player.playerVersionId) ?? 0;
      const targetSeconds = targetSecondsFor(side.rotation, player.playerVersionId);
      if (actualSeconds === targetSeconds) continue;
      const reasons = [...(side.causes.get(player.playerVersionId) ?? [])];
      if (reasons.length === 0) reasons.push('dead-ball-timing');
      deviations.push({
        side: side.side,
        playerVersionId: player.playerVersionId,
        actualSeconds,
        targetSeconds,
        reasons,
      });
    }
    return deviations;
  }
}
function toSimulationPlayer(player: SeasonGamePlayerInput): SimulationPlayer {
  return {
    playerId: player.playerId,
    playerVersionId: player.playerVersionId,
    displayName: player.displayName,
    positions: player.positions,
    heightInches: player.heightInches,
    weightLbs: player.weightLbs,
    ratings: player.ratings,
    tendencies: player.tendencies,
    ...(player.anchors !== undefined ? { anchors: player.anchors } : {}),
    ...(player.overall !== undefined ? { overall: player.overall } : {}),
    ...(player.ratingProfile !== undefined ? { ratingProfile: player.ratingProfile } : {}),
  };
}
function targetSecondsFor(rotation: SeasonRotation, playerVersionId: string): number {
  const entry = rotation.targetMinutes.find((t) => t.playerVersionId === playerVersionId);
  return (entry?.minutes ?? 0) * 60;
}
export function sameUnit(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}
