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
  MAX_PERIODS,
  OVERTIME_PERIOD_SECONDS,
  REGULATION_PERIOD_SECONDS,
  overtimePeriodsOf,
  resolveGameWinner,
} from '../sim/periods.ts';
import { GameRecorder, type SideIndex } from '../sim/recorder.ts';
import {
  createGameState,
  createTripContext,
  PossessionStepper,
  type PossessionStep,
  type TripContext,
} from '../sim/possession.ts';
import { prepareTeam } from '../sim/prepare.ts';
import {
  chooseInitialUnit,
  planUnit,
  plannerCandidates,
  type PlannerRotationContext,
} from './rotation-planner.ts';
import { seasonHomeCourtMechanisms } from './home-court.ts';
import { createSeasonEffectsBuffer, type SeasonEffectsBuffer } from './effects.ts';

/**
 * M2.2 Season Run game controller (spec/2.0/04, season-game-v1). Orchestrates
 * a single game around the authoritative possession pipeline with ten-player
 * rotations, substitution planning, foul-outs, exact seconds, unit stints,
 * rotation deviations, and typed forfeits. Classic games route through the
 * fixed-five adapter in sim/game.ts and must stay byte-identical to today.
 *
 * ## Frozen controller rules (spec/2.0/04 M2.2)
 *
 * - Identity: `playerVersionId` is the authoritative simulation and recorder
 *   identity; `playerId` is person-level metadata. The recorder translates
 *   the active five slots into ten-roster records keyed by roster index (in
 *   input order), so two historical versions of one person on one roster
 *   never merge.
 * - Possession execution is resumable: the controller pauses only after
 *   made baskets, completed foul/free-throw sequences, inbound-producing
 *   fouls, dead-ball team rebounds, and period endings. Live turnovers, live
 *   rebounds, and unresolved shot/free-throw sequences never trigger
 *   substitutions. An and-one made basket is followed immediately by its
 *   free throw; no pause splits the sequence.
 * - Reconsider the lineup at period boundaries, at the first eligible dead
 *   ball after each whole-minute checkpoint (whole-minute marks 660..60 of
 *   regulation periods), and immediately after the legal boundary following
 *   a foul-out, injected removal, or other availability change. The planner
 *   produces the next unit; a substitution is recorded only when the unit
 *   changes. Overtime never chases rotation targets: every OT period starts
 *   with the legal preferred closing unit and only foul-outs/removals force
 *   later OT substitutions.
 * - Six personal fouls remove the player at the next legal pause (no rating
 *   penalty beforehand). Injected removals from the availability seam apply
 *   at the next legal boundary at or after their recorded clock.
 * - If one team cannot field a legal five at tipoff or after a removal, the
 *   controller returns the typed 2-0 forfeit with the losing franchise and
 *   trigger fact and no player statistics. If both teams are invalid before
 *   tipoff, return the `no-legal-five-both` variant instead of choosing a
 *   loser.
 * - Exact playing time is integer seconds. Regulation reconciles each side
 *   to 14,400 player-seconds (five on-court players x 2,880 seconds) plus
 *   1,500 per overtime period. Display minutes are seconds / 60. Stint
 *   boundaries are recorded at the floor of the floating clock at each
 *   pause, and a sealed period end closes at zero, so consecutive stints are
 *   exactly contiguous and the totals reconcile exactly.
 * - Per-player regulation deviations are emitted only when actual seconds
 *   differ from target seconds (target minutes x 60). Reasons are the union
 *   of causes that affected the player: dead-ball timing, closing
 *   preference, foul-out, pregame unavailability, injected injury removal,
 *   and contingency legality.
 * - Possession preparation tables are rebuilt only after a substitution;
 *   rebuilding consumes no RNG (prepareTeam is pure).
 * - The controller consumes RNG only through the possession pipeline and the
 *   fixed-five tie-break draw (a pathological guard after the 12-period cap,
 *   identical to Classic). The planner and the availability seam never draw
 *   RNG, and no presentation randomness exists in M2.2.
 */

const CHECKPOINT_MARKS: readonly number[] = [660, 600, 540, 480, 420, 360, 300, 240, 180, 120, 60];

/**
 * Deterministic availability/removal/return seam (M2.2 uses pregame
 * availability only; tests and CLI fixtures inject same-game removals; M2.5
 * supplies the seeded injury model through this seam). The default seam
 * derives from the input's `availability`, `removals`, and `returns`; tests
 * may substitute their own.
 */
export interface SeasonGameAvailabilitySeam {
  /** Pregame availability per playerVersionId (both sides). */
  pregame: ReadonlyMap<string, boolean>;
  /** Same-game removals, applied at the next legal boundary at/after their clock. */
  removals: readonly SeasonRemoval[];
  /**
   * M2.5: same-game returns (seeded injury returns, reason `injury-return`),
   * applied at the next legal boundary at/after their clock (mirror of
   * removals); a returned player re-enters only at legal boundaries.
   */
  returns: readonly SeasonReturn[];
}

/** Default seam: input availability entries, removals, and returns. */
export function defaultSeasonGameSeam(
  input: SeasonGameSimulationInput,
): SeasonGameAvailabilitySeam {
  return {
    pregame: new Map(input.availability.map((entry) => [entry.playerVersionId, entry.available])),
    removals: input.removals,
    returns: input.returns,
  };
}

/**
 * Simulates one Season game (season-game-v1). Deterministic: identical input
 * and seed produce a byte-identical result including substitutions, unit
 * stints, deviations, foul-outs, and removals.
 */
export function simulateSeasonGame(
  input: SeasonGameSimulationInput,
  context: EngineContext,
  options: { seam?: SeasonGameAvailabilitySeam } = {},
): SeasonGameSimulationResult {
  const seam = options.seam ?? defaultSeasonGameSeam(input);
  const controller = new SeasonGameController(input, context, seam);
  return controller.run();
}

/**
 * Simulates one Season game with the M2.4 stamina/chemistry effects
 * (season-stamina-v1 + season-chemistry-v1). Identical flow to
 * `simulateSeasonGame` plus the per-game effects accumulation; returns the
 * result and the explicit effects transition (pregame/postgame load states,
 * pair increments, and mechanism evidence). `state` is the carried league
 * effects state; every rostered player of both sides must carry a stamina
 * profile (absence is a typed error). The neutral zero profile never reaches
 * this entry point: Classic and neutral Season games route through
 * `simulateSeasonGame` and stay byte-identical to M2.3.
 */
export function simulateSeasonGameWithEffects(
  input: SeasonGameSimulationInput,
  context: EngineContext,
  state: SeasonEffectsState,
  options: { seam?: SeasonGameAvailabilitySeam } = {},
): { result: SeasonGameSimulationResult; transition: SeasonGameEffectsTransition } {
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

/** Effects mode bundle for the game controller (M2.4). */
export interface SeasonGameEffectsMode {
  buffer: SeasonEffectsBuffer;
  pregamePlayerStates: readonly SeasonPlayerLoadState[];
}

/** Stable chronological queue order: period, descending game clock, then side. */
function compareQueueEntries(
  a: { period: number; secondsRemaining: number; side: 'home' | 'away' },
  b: { period: number; secondsRemaining: number; side: 'home' | 'away' },
): number {
  const byPeriod = a.period - b.period;
  if (byPeriod !== 0) return byPeriod;
  // Game clocks count down, so 600 is earlier than 100 within a period.
  const byClock = b.secondsRemaining - a.secondsRemaining;
  if (byClock !== 0) return byClock;
  return a.side === b.side ? 0 : a.side === 'home' ? -1 : 1;
}

/** Per-side controller state: roster, rotation facts, unit, events, stints. */
class SideState {
  readonly side: 'home' | 'away';
  readonly sideIndex: SideIndex;
  readonly teamInput: SeasonGameTeamInput;
  readonly rotation: SeasonRotation;
  readonly planner: PlannerRotationContext;
  readonly roster: readonly SeasonGamePlayerInput[];
  readonly simPlayers: SimulationPlayer[];
  readonly rosterIndexByVersion: ReadonlyMap<string, number>;
  /** Current ordered unit (G, G, F, F, C). */
  unit: string[] = [];
  /** Players unavailable right now (pregame, fouled out, removed). */
  readonly unavailable = new Set<string>();
  readonly fouledOut = new Set<string>();
  readonly removed = new Set<string>();
  /** Union of deviation causes per rostered playerVersionId. */
  readonly causes = new Map<string, Set<SeasonRotationDeviationReason>>();
  /** Regulation seconds played per rostered playerVersionId (exact integers). */
  readonly regulationSeconds = new Map<string, number>();
  readonly substitutions: SeasonSubstitution[] = [];
  readonly stints: SeasonUnitStint[] = [];
  readonly foulOutEvents: SeasonFoulOut[] = [];
  readonly removalEvents: SeasonRemovalEvent[] = [];
  /** M2.5: applied same-game return events (reason `injury-return`). */
  readonly returnEvents: SeasonReturnEvent[] = [];
  /** Open stint: period, immutable open clock, cursor, unit; null between periods. */
  stint: { period: number; openClock: number; cursor: number; unit: string[] } | null = null;
  /** Events applied at the current boundary. */
  boundaryEvents: { foulOuts: number; removals: number; returns: number } = {
    foulOuts: 0,
    removals: 0,
    returns: 0,
  };
  changedThisBoundary = false;
  private checkpointIndex = 0;
  /** Cached legal-five enumeration, keyed by the availability signature. */
  candidateCache: { signature: string; list: readonly (readonly string[])[] } | null = null;

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

  /** Consumes whole-minute checkpoint marks crossed at a boundary clock. */
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
  private offense: SideIndex = 0;
  private secondsRemaining = REGULATION_PERIOD_SECONDS;
  private period = 1;
  /** Display clock of the current boundary (integer; 0 at period ends). */
  private boundaryClock = 0;
  /** Produced once per game by the effects-mode exit path. */
  effectsTransition: SeasonGameEffectsTransition | null = null;

  constructor(
    input: SeasonGameSimulationInput,
    context: EngineContext,
    seam: SeasonGameAvailabilitySeam,
    effectsMode: SeasonGameEffectsMode | null = null,
  ) {
    this.input = input;
    this.context = context;
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
    this.removalQueue = [...seam.removals].sort(compareQueueEntries);
    this.returnQueue = [...seam.returns].sort(compareQueueEntries);
  }

  run(): SeasonGameSimulationResult {
    const tipoffForfeit = this.tipoff();
    if (tipoffForfeit !== null) return this.exitWithEffects(tipoffForfeit);

    for (this.period = 1; this.period <= MAX_PERIODS; this.period += 1) {
      if (this.period > 1) {
        // Regulation periods all run; overtime only when the game is tied.
        if (this.period >= 5) {
          if (this.recorder.sides[0].points !== this.recorder.sides[1].points) break;
        }
        this.recorder.nextPeriod();
        this.secondsRemaining =
          this.period <= 4 ? REGULATION_PERIOD_SECONDS : OVERTIME_PERIOD_SECONDS;
        this.state.periodIndex = this.period - 1;
        this.state.periodFouls = [0, 0];
        this.tripContext.possessionStart = 'neutral';
        // M2.4: halftime recovery fires exactly once between periods 2 and 3.
        if (this.period === 3) this.effectsMode?.buffer.hook.halftime();
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

  /** Finishes the effects buffer exactly once and attaches the transition. */
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

  /** Tipoff: removals/returns due at (1, 720), planner initial units, forfeits. */
  private tipoff(): SeasonGameSimulationResult | null {
    this.applyDueRemovals(1, REGULATION_PERIOD_SECONDS, REGULATION_PERIOD_SECONDS, false);
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

  /** One trip through the resumable pipeline, pausing at legal boundaries. */
  private driveOneTrip(): { step: PossessionStep; forfeit: SeasonGameSimulationResult | null } {
    const machine = new PossessionStepper(this.tripContext, this.offense);
    let step: PossessionStep = { ended: false, pause: false, periodEnded: false, finished: false };
    do {
      step = machine.step();
      // A pause is a legal dead-ball boundary; a period-ending step is also
      // a boundary even when the last trip ended live (e.g. a turnover at
      // clock zero), so the stints always close exactly at period ends.
      if (step.pause || step.periodEnded) {
        const forfeit = this.processBoundary(step.periodEnded);
        if (forfeit !== null) return { step, forfeit };
      }
    } while (!step.periodEnded && !step.finished);
    return { step, forfeit: null };
  }

  /**
   * One legal dead-ball or period-ending boundary: events, seconds
   * accumulation, planning, substitution, and stint bookkeeping.
   */
  private processBoundary(periodEnded: boolean): SeasonGameSimulationResult | null {
    const period = this.period;
    const floatClock = this.state.secondsRemaining;
    const clock = periodEnded ? 0 : Math.floor(floatClock);
    this.boundaryClock = clock;
    for (const side of [this.home, this.away]) {
      side.boundaryEvents = { foulOuts: 0, removals: 0, returns: 0 };
      side.changedThisBoundary = false;
    }

    // 1. Events: removals due at/after the boundary clock, then returns
    //    (a return at the same boundary re-enables the player for planning),
    //    then foul-outs.
    this.applyDueRemovals(period, floatClock, clock, periodEnded);
    this.applyDueReturns(period, floatClock, clock, periodEnded);
    this.applyFoulOuts(this.home, period, clock);
    this.applyFoulOuts(this.away, period, clock);

    // 2. Accumulate the just-played interval into seconds (before planning,
    //    so the planner sees the current actual seconds).
    for (const side of [this.home, this.away]) {
      this.accumulateStintInterval(side, period, clock);
    }

    // 3. Planning and substitution (only when the game continues).
    const gameContinues = this.gameContinuesAfter(period, periodEnded);
    for (const side of [this.home, this.away]) {
      if (!gameContinues) continue;
      const plan = this.planFor(side, period, periodEnded, clock);
      if (plan === null) continue;
      if (plan.unit === null) {
        // No legal five can be formed: typed forfeit (no player statistics).
        return this.forfeitResult(side, 'no-legal-five-after-removal');
      }
      this.applySubstitutionIfChanged(side, plan.unit, period, clock, plan.reason);
    }

    // 4. Stint records: emit when the unit changed or the period ended.
    for (const side of [this.home, this.away]) {
      this.finalizeStint(side, period, clock, periodEnded);
    }
    for (const side of [this.home, this.away]) {
      if (gameContinues) this.reopenStint(side, period, periodEnded);
    }
    return null;
  }

  /** Applies every removal due at or before the (period, boundaryClock) boundary. */
  private applyDueRemovals(
    period: number,
    floatClock: number,
    boundaryClock: number,
    periodEnded: boolean,
  ): void {
    for (let index = 0; index < this.removalQueue.length;) {
      const removal = this.removalQueue[index];
      if (removal === undefined) break;
      if (!this.queueEntryIsDue(removal, period, floatClock, periodEnded)) {
        index += 1;
        continue;
      }
      const side = removal.side === 'home' ? this.home : this.away;
      // An in-game injury can only occur during actual court exposure. If
      // the seeded wall-clock point lands while the player is on the bench,
      // defer it to the first legal boundary after they next take the floor.
      if (!side.unit.includes(removal.playerVersionId)) {
        index += 1;
        continue;
      }
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

  /**
   * Applies every same-game return due at or before the (period,
   * boundaryClock) boundary (mirror of removals). A returned player
   * re-enters availability: the planner may bring them back at this
   * boundary or a later one, always through a legal substitution.
   */
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
        // A return never re-enables a fouled-out player (the seeded seam
        // only returns injury-removed players; the guard keeps the
        // invariant).
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

  /**
   * Drains every queue entry due at or before the boundary, applying the
   * per-entry mutation in stable sorted order. Shared by removals and
   * returns so the due-at-or-before clock/period guard lives in one place.
   */
  private drainQueue<T extends { period: number; secondsRemaining: number; side: 'home' | 'away' }>(
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
    entry: { period: number; secondsRemaining: number },
    period: number,
    floatClock: number,
    periodEnded: boolean,
  ): boolean {
    if (entry.period > period) return false;
    return periodEnded || entry.period < period || floatClock <= entry.secondsRemaining;
  }

  /** Removes every active player with six personal fouls at this boundary. */
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

  /**
   * The side's legal-five enumeration, cached until availability changes.
   * Foul-outs and removals are the only availability mutations, so the
   * enumeration is typically built once per game instead of at every
   * whole-minute checkpoint.
   */
  private cachedCandidates(side: SideState): readonly (readonly string[])[] {
    const signature = [...side.unavailable].sort().join('\u0000');
    if (side.candidateCache !== null && side.candidateCache.signature === signature) {
      return side.candidateCache.list;
    }
    const list = plannerCandidates(side.planner, side.unavailable);
    side.candidateCache = { signature, list };
    return list;
  }

  /** Decides whether to plan and with which recorded reason. */
  private planFor(
    side: SideState,
    period: number,
    periodEnded: boolean,
    clock: number,
  ): { reason: SeasonSubstitutionReason; unit: string[] | null } | null {
    const hasFoulOut = side.boundaryEvents.foulOuts > 0;
    const hasRemoval = side.boundaryEvents.removals > 0;
    const hasReturn = side.boundaryEvents.returns > 0;
    // The substitution reason enum has no return literal; a return-driven
    // re-plan records as a rotation-plan substitution (the deviation cause
    // `injury-return` carries the return fact on the player's deviation).
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

  /**
   * Records one substitution per truly-removed/truly-added player when the
   * unit changes. The player sets differ, so the removed set is the old unit
   * minus the new and the added set the reverse; slot shuffles never record
   * a player as entering and leaving at once. Pairs are matched in old-unit
   * and new-unit order respectively (deterministic).
   */
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

  /** Rebuilds the on-court five: prep tables, trip teams, recorder slots. */
  private activateUnit(side: SideState): void {
    const { team, rosterIndices } = this.buildUnitTeam(side);
    this.tripContext.teams[side.sideIndex] = team;
    this.tripContext.teamUnits[side.sideIndex] = [...side.unit];
    this.tripContext.preps[side.sideIndex] = prepareTeam(team, this.profile);
    this.recorder.setActiveFive(side.sideIndex, rosterIndices);
    // M2.4: the effects hook needs the active units for unit chemistry and
    // defensive-unit fatigue (consumes no RNG; no-op when absent).
    this.effectsMode?.buffer.hook.setActiveUnits(this.home.unit, this.away.unit);
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

  /** Adds the just-played interval to each on-court player's exact seconds. */
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
      // Regulation-only accumulation drives planner targets and deviations;
      // the recorder accumulates the full-game seconds.
      if (period <= 4) {
        side.regulationSeconds.set(
          playerVersionId,
          (side.regulationSeconds.get(playerVersionId) ?? 0) + duration,
        );
      }
      this.recorder.playSeconds(side.sideIndex, rosterIndex, duration);
    }
    // M2.4: on-court accumulation and off-court recovery for the interval
    // (consumes no RNG; no-op when the hook is absent).
    this.effectsMode?.buffer.hook.recordStintSeconds(side.sideIndex, duration, stint.unit);
    stint.cursor = clock;
  }

  /** Emits a coalesced stint when the unit changed or the period ended. */
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
    if (period >= MAX_PERIODS) return false;
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
    // NOTE (contract problem for the lead): the current season-game-simulation
    // contract types homeScore as literal 2 and awayScore as literal 0, which
    // cannot express an away forfeit win. The semantically correct official
    // result is winner 2, loser 0, so the home-win and away-win scores are
    // cast here and the data-contracts literal must be fixed to
    // z.literal(0|2) with exactly one 2 (or a 2-0 tuple).
    return {
      schemaVersion: 1,
      outcome: 'forfeit',
      seed: this.input.seed,
      gameNumber: this.input.gameNumber,
      dataVersion: this.input.dataVersion,
      engineVersion: this.context.engineVersion,
      profileVersion: this.profile.profileVersion,
      winner: homeWins ? 'home' : 'away',
      losingFranchiseId: loser.teamInput.franchiseId,
      trigger,
      homeScore: (homeWins ? 2 : 0) as 2,
      awayScore: (homeWins ? 0 : 2) as 0,
    };
  }

  private buildResult(): SeasonGameSimulationResult {
    const overtimePeriods = overtimePeriodsOf(this.recorder.sides[0].periodPoints.length);
    const homeScore = this.recorder.sides[0].points;
    const awayScore = this.recorder.sides[1].points;
    const winner = resolveGameWinner(homeScore, awayScore, this.rng);

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

/** Season game player input -> possession engine player snapshot. */
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

/** Regulation target seconds for a rostered version (target minutes x 60). */
function targetSecondsFor(rotation: SeasonRotation, playerVersionId: string): number {
  const entry = rotation.targetMinutes.find((t) => t.playerVersionId === playerVersionId);
  return (entry?.minutes ?? 0) * 60;
}

/** Set equality for ordered units (slot reordering is not a substitution). */
export function sameUnit(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/**
 * `checkSeasonGameResult` and its stint/substitution/deviation audits moved to
 * `season-game-audit.ts` (they re-simulate the game for determinism evidence
 * and import `simulateSeasonGame` from here).
 */
