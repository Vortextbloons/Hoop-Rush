import type {
  SeasonFoulOut,
  SeasonGamePlayerInput,
  SeasonGamePlayerResult,
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
import { createEngineContext } from '../sim/context.ts';
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

const REGULATION_PERIOD_SECONDS = 720;
const OVERTIME_PERIOD_SECONDS = 300;
const MAX_PERIODS = 12;
const REGULATION_TOTAL_SECONDS = 5 * 2880;
const OVERTIME_TOTAL_SECONDS = 5 * 300;

/** Whole-minute checkpoint marks of a regulation period (descending). */
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
} /** Per-side controller state: roster, rotation facts, unit, events, stints. */
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
    this.removalQueue = [...seam.removals].sort((a, b) => {
      const byPeriod = a.period - b.period;
      if (byPeriod !== 0) return byPeriod;
      const byClock = a.secondsRemaining - b.secondsRemaining;
      if (byClock !== 0) return byClock;
      return a.side === b.side ? 0 : a.side === 'home' ? -1 : 1;
    });
    this.returnQueue = [...seam.returns].sort((a, b) => {
      const byPeriod = a.period - b.period;
      if (byPeriod !== 0) return byPeriod;
      const byClock = a.secondsRemaining - b.secondsRemaining;
      if (byClock !== 0) return byClock;
      return a.side === b.side ? 0 : a.side === 'home' ? -1 : 1;
    });
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
    while (this.removalQueue.length > 0) {
      const removal = this.removalQueue[0];
      if (removal === undefined) break;
      if (removal.period > period) break;
      if (!periodEnded && removal.period === period && floatClock > removal.secondsRemaining) {
        break;
      }
      this.removalQueue.shift();
      const side = removal.side === 'home' ? this.home : this.away;
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
    while (this.returnQueue.length > 0) {
      const ret = this.returnQueue[0];
      if (ret === undefined) break;
      if (ret.period > period) break;
      if (!periodEnded && ret.period === period && floatClock > ret.secondsRemaining) {
        break;
      }
      this.returnQueue.shift();
      const side = ret.side === 'home' ? this.home : this.away;
      // A return never re-enables a fouled-out player (the seeded seam only
      // returns injury-removed players; the guard keeps the invariant).
      if (side.fouledOut.has(ret.playerVersionId)) continue;
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
    }
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
    const team = this.buildUnitTeam(side);
    this.tripContext.teams[side.sideIndex] = team;
    this.tripContext.preps[side.sideIndex] = prepareTeam(team, this.profile);
    const rosterIndices: number[] = [];
    for (const playerVersionId of side.unit) {
      const rosterIndex = side.rosterIndexByVersion.get(playerVersionId);
      if (rosterIndex === undefined) {
        throw new Error(`season: unit references an unrostered version ${playerVersionId}`);
      }
      rosterIndices.push(rosterIndex);
    }
    this.recorder.setActiveFive(side.sideIndex, rosterIndices);
    // M2.4: the effects hook needs the active units for unit chemistry and
    // defensive-unit fatigue (consumes no RNG; no-op when absent).
    this.effectsMode?.buffer.hook.setActiveUnits(this.home.unit, this.away.unit);
  }

  private buildUnitTeam(side: SideState): SimulationTeam {
    const players: SimulationPlayer[] = [];
    for (const playerVersionId of side.unit) {
      const player = side.simPlayers.find((p) => p.playerVersionId === playerVersionId);
      if (player === undefined) {
        throw new Error(`season: no simulation player for version ${playerVersionId}`);
      }
      players.push(player);
    }
    return {
      teamId: side.teamInput.teamId,
      displayName: side.teamInput.displayName,
      players,
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
    const overtimePeriods = Math.max(0, this.recorder.sides[0].periodPoints.length - 4);
    const homeScore = this.recorder.sides[0].points;
    const awayScore = this.recorder.sides[1].points;
    // A tie after the period cap is a pathological guard; the seeded draw decides.
    const winner: 'home' | 'away' =
      homeScore > awayScore
        ? 'home'
        : awayScore > homeScore
          ? 'away'
          : this.rng.chance(0.5)
            ? 'home'
            : 'away';

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
function sameUnit(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/**
 * Audits a Season game result against its input: legality (no player plays
 * while unavailable/fouled out or for both teams), ownership, exact-seconds
 * reconciliation (14,400 per side in regulation plus 1,500 per overtime),
 * substitution timestamps on approved boundaries, player/team accounting,
 * unit-stint intervals, foul totals, deviation facts, and determinism
 * evidence. Returns failure strings; empty means valid.
 */
export function checkSeasonGameResult(
  result: SeasonGameSimulationResult,
  input: SeasonGameSimulationInput,
): string[] {
  const failures: string[] = [];

  // Determinism evidence: the same input re-simulates to a byte-identical result.
  const replay = simulateSeasonGame(input, createEngineContext());
  if (JSON.stringify(replay) !== JSON.stringify(result)) {
    failures.push('determinism: re-running the same input produced a different result');
  }

  // Cross-team ownership: playerVersionIds are disjoint across sides.
  const homeIds = new Set(input.home.players.map((p) => p.playerVersionId));
  const awayIds = new Set(input.away.players.map((p) => p.playerVersionId));
  for (const id of homeIds) {
    if (awayIds.has(id)) failures.push(`cross-team ownership: ${id} rostered on both sides`);
  }

  if (result.outcome === 'no-legal-five-both') {
    if (sideHasLegalFiveAtTipoff(input, 'home')) {
      failures.push('no-legal-five-both: home can field a legal five at tipoff');
    }
    if (sideHasLegalFiveAtTipoff(input, 'away')) {
      failures.push('no-legal-five-both: away can field a legal five at tipoff');
    }
    return failures;
  }

  if (result.outcome === 'forfeit') {
    const loserSide = result.winner === 'home' ? 'away' : 'home';
    if (result.losingFranchiseId !== input[loserSide].franchiseId) {
      failures.push('forfeit: losingFranchiseId does not match the losing side');
    }
    const winnerScore = result.winner === 'home' ? result.homeScore : result.awayScore;
    const loserScore = result.winner === 'home' ? result.awayScore : result.homeScore;
    if (winnerScore !== 2 || loserScore !== 0) {
      failures.push(
        `forfeit: official result must be 2-0 (got ${String(winnerScore)}-${String(loserScore)})`,
      );
    }
    if (result.trigger === 'no-legal-five-tipoff' && sideHasLegalFiveAtTipoff(input, loserSide)) {
      failures.push('forfeit: losing side can field a legal five at tipoff');
    }
    return failures;
  }

  // ---- completed game audit ----
  const ot = result.overtimePeriods;
  const expectedTotalSeconds = REGULATION_TOTAL_SECONDS + OVERTIME_TOTAL_SECONDS * ot;

  for (const sideKey of ['home', 'away'] as const) {
    const side = result[sideKey];
    const teamInput = input[sideKey];
    const box = side.box;
    const players = side.players;
    const playerIds = players.map((p) => p.playerVersionId);

    // Rostered identity: ten distinct results matching the input roster.
    if (players.length !== 10) {
      failures.push(`${sideKey}: expected ten player results, got ${String(players.length)}`);
    }
    if (new Set(playerIds).size !== playerIds.length) {
      failures.push(`${sideKey}: duplicate playerVersionIds in results`);
    }
    for (const player of players) {
      if (!teamInput.players.some((r) => r.playerVersionId === player.playerVersionId)) {
        failures.push(
          `${sideKey}: result references an unrostered version ${player.playerVersionId}`,
        );
      }
    }

    // Exact-seconds reconciliation: 14,400 regulation + 1,500 per OT per side.
    const playerSeconds = players.reduce((sum, p) => sum + p.seconds, 0);
    if (playerSeconds !== expectedTotalSeconds) {
      failures.push(
        `${sideKey}: player seconds (${String(playerSeconds)}) != ${String(expectedTotalSeconds)}`,
      );
    }
    for (const p of players) {
      if (!Number.isInteger(p.seconds)) {
        failures.push(`${sideKey}: ${p.playerVersionId} seconds are not integers`);
      }
      if (Math.abs(p.minutes - p.seconds / 60) > 1e-9) {
        failures.push(`${sideKey}: ${p.playerVersionId} minutes != seconds / 60`);
      }
    }

    // Scoring identities.
    const sumOf = (select: (p: SeasonGamePlayerResult) => number): number =>
      players.reduce((acc, p) => acc + select(p), 0);
    if (sumOf((p) => p.points) !== box.points) {
      failures.push(`${sideKey}: player points != team points`);
    }
    const fgm = box.fieldGoals.made;
    const fga = box.fieldGoals.attempted;
    const tpm = box.threes.made;
    const tpa = box.threes.attempted;
    const ftm = box.freeThrows.made;
    const fta = box.freeThrows.attempted;
    if (box.points !== (fgm - tpm) * 2 + tpm * 3 + ftm) {
      failures.push(`${sideKey}: team points != 2*2fg + 3*3fg + ft`);
    }
    if (fgm > fga || tpm > tpa || ftm > fta) {
      failures.push(`${sideKey}: makes exceed attempts`);
    }
    if (box.assists > fgm) failures.push(`${sideKey}: assists exceed made field goals`);
    if (
      box.rebounds.offensive + box.rebounds.defensive + box.rebounds.team !==
      box.rebounds.total
    ) {
      failures.push(`${sideKey}: rebound buckets do not sum to total`);
    }
    const reconcile = (
      label: string,
      select: (p: SeasonGamePlayerResult) => number,
      teamValue: number,
    ): void => {
      const total = sumOf(select);
      if (total !== teamValue) {
        failures.push(
          `${sideKey}: player ${label} (${String(total)}) != team ${label} (${String(teamValue)})`,
        );
      }
    };
    reconcile('fieldGoalMakes', (p) => p.fieldGoals.made, fgm);
    reconcile('fieldGoalAttempts', (p) => p.fieldGoals.attempted, fga);
    reconcile('threeMakes', (p) => p.threes.made, tpm);
    reconcile('threeAttempts', (p) => p.threes.attempted, tpa);
    reconcile('freeThrowMakes', (p) => p.freeThrows.made, ftm);
    reconcile('freeThrowAttempts', (p) => p.freeThrows.attempted, fta);
    reconcile('assists', (p) => p.assists, box.assists);
    reconcile('steals', (p) => p.steals, box.steals);
    reconcile('blocks', (p) => p.blocks, box.blocks);
    reconcile('turnovers', (p) => p.turnovers, box.turnovers);
    reconcile('fouls', (p) => p.fouls, box.fouls);
    reconcile('offensiveRebounds', (p) => p.rebounds.offensive, box.rebounds.offensive);
    reconcile('defensiveRebounds', (p) => p.rebounds.defensive, box.rebounds.defensive);

    // Opportunity diagnostics (same invariants as checkGameResult).
    const misses = fga - fgm + (fta - ftm);
    const d = box.diagnostics;
    if (d.reboundOpportunities !== misses) {
      failures.push(`${sideKey}: rebound opportunities != misses`);
    }
    if (d.assistedFieldGoals + d.unassistedFieldGoals !== fgm) {
      failures.push(`${sideKey}: assisted + unassisted != made field goals`);
    }
    const playerDiag = (
      select: (dd: NonNullable<SeasonGamePlayerResult['diagnostics']>) => number,
    ) => players.reduce((acc, p) => acc + select(p.diagnostics), 0);
    if (playerDiag((p) => p.contestedShots) !== d.contestedShots) {
      failures.push(`${sideKey}: player contested shots != team contested shots`);
    }
    if (playerDiag((p) => p.offensiveReboundChances) !== d.reboundOpportunities * 5) {
      failures.push(`${sideKey}: player offensive-rebound chances != 5 * rebound opportunities`);
    }
    const other = result[sideKey === 'home' ? 'away' : 'home'];
    const otherMisses =
      other.box.fieldGoals.attempted -
      other.box.fieldGoals.made +
      (other.box.freeThrows.attempted - other.box.freeThrows.made);
    if (playerDiag((p) => p.defensiveReboundChances) !== otherMisses * 5) {
      failures.push(`${sideKey}: player defensive-rebound chances != 5 * opponent misses`);
    }
    for (const zone of side.shotZones) {
      const attempts = playerDiag(
        (d) => d.shotZones.find((z) => z.zone === zone.zone)?.attempts ?? 0,
      );
      const makes = playerDiag((d) => d.shotZones.find((z) => z.zone === zone.zone)?.makes ?? 0);
      if (attempts !== zone.attempts || makes !== zone.makes) {
        failures.push(`${sideKey}: player zone splits (${zone.zone}) != team zone summary`);
      }
    }
    for (const p of players) {
      if (p.diagnostics.assistOpportunities < p.assists) {
        failures.push(`${sideKey}: ${p.playerVersionId} assist opportunities < assists`);
      }
      const usageIdentity = p.fieldGoals.attempted + p.freeThrows.attempted * 0.44 + p.turnovers;
      if (Math.abs(p.diagnostics.usage - usageIdentity) > 0.6) {
        failures.push(`${sideKey}: ${p.playerVersionId} usage identity broken`);
      }
    }

    // Period scores reconcile with totals.
    const periodTotal = side.periodScores.reduce((a, b) => a + b, 0);
    if (side.periodScores.length !== 4 + ot) {
      failures.push(
        `${sideKey}: period count (${String(side.periodScores.length)}) != 4 + OT (${String(4 + ot)})`,
      );
    }
    if (periodTotal !== side.score || side.score !== box.points) {
      failures.push(`${sideKey}: period scores do not reconcile with the box`);
    }

    // Unit-stint interval consistency and seconds accounting.
    stintAudit(failures, sideKey, result, input);
  }

  // Winner fact (a tie after the 12-period cap is decided by the seeded draw).
  const homeScore = result.home.score;
  const awayScore = result.away.score;
  if (homeScore !== awayScore && result.winner !== (homeScore > awayScore ? 'home' : 'away')) {
    failures.push('winner does not match the final scores');
  }

  // Substitution and event facts per side.
  for (const sideKey of ['home', 'away'] as const) {
    substitutionAudit(failures, sideKey, result, input);
    deviationAudit(failures, sideKey, result, input);
  }

  return failures;
}

/** Stint audit: contiguous intervals, exact durations, tipoff unit, totals. */
function stintAudit(
  failures: string[],
  sideKey: 'home' | 'away',
  result: Extract<SeasonGameSimulationResult, { outcome: 'completed' }>,
  input: SeasonGameSimulationInput,
): void {
  const stints = result.unitStints.filter((s) => s.side === sideKey);
  for (let i = 0; i < stints.length; i += 1) {
    const stint = stints[i];
    if (stint === undefined) continue;
    if (stint.durationSeconds !== stint.startSecondsRemaining - stint.endSecondsRemaining) {
      failures.push(`${sideKey}: stint duration != start - end (period ${String(stint.period)})`);
    }
    if (stint.endSecondsRemaining > stint.startSecondsRemaining) {
      failures.push(`${sideKey}: stint end clock exceeds start clock`);
    }
    if (new Set(stint.players).size !== 5) {
      failures.push(`${sideKey}: stint unit must be five distinct players`);
    }
  }
  const first = stints[0];
  if (first !== undefined) {
    if (first.period !== 1 || first.startSecondsRemaining !== 720) {
      failures.push(`${sideKey}: first stint must open at (1, 720)`);
    }
    const initial = initialUnitAtTipoff(input, sideKey);
    if (initial !== null && !sameUnit(first.players, initial)) {
      failures.push(`${sideKey}: tipoff unit does not match the planner's initial unit`);
    }
  }
  for (let i = 1; i < stints.length; i += 1) {
    const prev = stints[i - 1];
    const cur = stints[i];
    if (prev === undefined || cur === undefined) continue;
    if (cur.period === prev.period) {
      if (cur.startSecondsRemaining !== prev.endSecondsRemaining) {
        failures.push(`${sideKey}: stint gap in period ${String(prev.period)}`);
      }
    } else if (cur.period === prev.period + 1) {
      if (prev.endSecondsRemaining !== 0) {
        failures.push(`${sideKey}: stint crossing period ${String(prev.period)} does not end at 0`);
      }
      const expectedStart = cur.period <= 4 ? 720 : 300;
      if (cur.startSecondsRemaining !== expectedStart) {
        failures.push(
          `${sideKey}: stint opening period ${String(cur.period)} does not start at ${String(expectedStart)}`,
        );
      }
    } else {
      failures.push(
        `${sideKey}: stint period jump ${String(prev.period)} -> ${String(cur.period)}`,
      );
    }
  }
  const last = stints[stints.length - 1];
  if (last !== undefined) {
    if (last.period !== 4 + result.overtimePeriods || last.endSecondsRemaining !== 0) {
      failures.push(`${sideKey}: last stint must end at the final period's zero`);
    }
  }
  const stintSeconds = stints.reduce((sum, stint) => sum + stint.durationSeconds, 0);
  // Stint durations cover the game clock once per side (five players share
  // the court), so they sum to the regulation + overtime game length.
  const expectedGameSeconds = 2880 + 300 * result.overtimePeriods;
  if (stintSeconds !== expectedGameSeconds) {
    failures.push(
      `${sideKey}: stint seconds (${String(stintSeconds)}) != game length (${String(expectedGameSeconds)})`,
    );
  }
  const secondsByPlayer = new Map<string, number>();
  for (const stint of stints) {
    for (const playerVersionId of stint.players) {
      secondsByPlayer.set(
        playerVersionId,
        (secondsByPlayer.get(playerVersionId) ?? 0) + stint.durationSeconds,
      );
    }
  }
  for (const player of result[sideKey].players) {
    const fromStints = secondsByPlayer.get(player.playerVersionId) ?? 0;
    if (fromStints !== player.seconds) {
      failures.push(
        `${sideKey}: ${player.playerVersionId} seconds (${String(player.seconds)}) != stint seconds (${String(fromStints)})`,
      );
    }
  }
}

/** Substitution audit: boundary linkage, in/out facts, legality, events. */
function substitutionAudit(
  failures: string[],
  sideKey: 'home' | 'away',
  result: Extract<SeasonGameSimulationResult, { outcome: 'completed' }>,
  input: SeasonGameSimulationInput,
): void {
  const subs = result.substitutions.filter((s) => s.side === sideKey);
  const stints = result.unitStints.filter((s) => s.side === sideKey);

  const unavailable = new Set<string>();
  for (const entry of input.availability) {
    if (entry.available) continue;
    if (input[sideKey].players.some((p) => p.playerVersionId === entry.playerVersionId)) {
      unavailable.add(entry.playerVersionId);
    }
  }

  for (let i = 0; i < subs.length; i += 1) {
    const sub = subs[i];
    if (sub === undefined) continue;
    if (
      sub.period < 1 ||
      sub.period > 12 ||
      !Number.isInteger(sub.secondsRemaining) ||
      sub.secondsRemaining < 0 ||
      sub.secondsRemaining > 720
    ) {
      failures.push(`${sideKey}: substitution outside legal clock bounds`);
    }
    if (sub.playerIn === sub.playerOut) {
      failures.push(`${sideKey}: substitution with identical in/out player`);
    }
    if (!sub.unit.includes(sub.playerIn) || sub.unit.includes(sub.playerOut)) {
      failures.push(`${sideKey}: substitution unit inconsistent with playerIn/playerOut`);
    }
    if (unavailable.has(sub.playerIn)) {
      failures.push(`${sideKey}: substitution brings an unavailable player in`);
    }
    // The substitution must land on a stint boundary with the resulting unit:
    // a next-period stint for a period-end sub, or a same-period stint start
    // otherwise (including the rare same-clock floor-zero edge).
    const atPeriodEnd = sub.secondsRemaining === 0;
    const matchingStint = stints.find((stint) => {
      if (
        stint.period === sub.period + 1 &&
        stint.startSecondsRemaining === (stint.period <= 4 ? 720 : 300) &&
        sameUnit(stint.players, sub.unit)
      ) {
        return true;
      }
      return (
        stint.period === sub.period &&
        stint.startSecondsRemaining === sub.secondsRemaining &&
        sameUnit(stint.players, sub.unit)
      );
    });
    if (matchingStint === undefined) {
      failures.push(
        `${sideKey}: substitution at (${String(sub.period)}, ${String(sub.secondsRemaining)}) has no matching unit stint`,
      );
    }
    // The out player must belong to the unit that just finished.
    const previousUnit = stints.find((stint) => {
      if (atPeriodEnd) {
        return stint.period === sub.period && stint.endSecondsRemaining === 0;
      }
      return stint.period === sub.period && stint.endSecondsRemaining === sub.secondsRemaining;
    });
    if (previousUnit !== undefined && !previousUnit.players.includes(sub.playerOut)) {
      failures.push(`${sideKey}: ${sub.playerOut} was not on the floor at the substitution`);
    }
    // Event-driven reason linkage: the exit of a player who fouled out at a
    // boundary must be recorded as a foul-out substitution at that boundary
    // (the boundary's other rebalancing exits share the boundary reason).
    // A foul-out at the game's final boundary needs no substitution: the
    // controller stops planning when the game is decided.
    const finalPeriod = 4 + result.overtimePeriods;
    for (const event of result.foulOuts) {
      if (event.side !== sideKey) continue;
      if (event.period === finalPeriod && event.secondsRemaining === 0) continue;
      const backed = subs.some(
        (sub) =>
          sub.reason === 'foul-out' &&
          sub.playerOut === event.playerVersionId &&
          sub.period === event.period &&
          sub.secondsRemaining === event.secondsRemaining,
      );
      if (!backed) {
        failures.push(
          `${sideKey}: foul-out of ${event.playerVersionId} at (${String(event.period)}, ${String(event.secondsRemaining)}) has no removal substitution`,
        );
      }
    }
    for (const sub of subs) {
      if (sub.reason !== 'foul-out' && sub.reason !== 'injected-injury-removal') continue;
      const boundaryHasEvent = (sub.reason === 'foul-out' ? result.foulOuts : result.removals).some(
        (event) =>
          event.side === sideKey &&
          event.period === sub.period &&
          event.secondsRemaining === sub.secondsRemaining,
      );
      const playerWasRemoved = (sub.reason === 'foul-out' ? result.foulOuts : result.removals).some(
        (event) =>
          event.side === sideKey &&
          event.playerVersionId === sub.playerOut &&
          (event.period < sub.period ||
            (event.period === sub.period && event.secondsRemaining >= sub.secondsRemaining)),
      );
      if (!boundaryHasEvent && !playerWasRemoved) {
        failures.push(`${sideKey}: ${sub.reason} substitution without a matching event`);
      }
    }
  }

  // Every unit change must be backed by at least one substitution record.
  for (let i = 1; i < stints.length; i += 1) {
    const prev = stints[i - 1];
    const cur = stints[i];
    if (prev === undefined || cur === undefined) continue;
    if (sameUnit(prev.players, cur.players)) continue;
    const backed = subs.some(
      (sub) =>
        sameUnit(sub.unit, cur.players) &&
        ((sub.period === cur.period && sub.secondsRemaining === cur.startSecondsRemaining) ||
          (sub.period === cur.period - 1 && sub.secondsRemaining === 0)),
    );
    if (!backed) {
      failures.push(
        `${sideKey}: unit change at (${String(cur.period)}, ${String(cur.startSecondsRemaining)}) without a substitution record`,
      );
    }
  }

  // Legality: no stint contains a player after their foul-out or removal
  // clock, unless a same-game return re-enabled them at or before the
  // stint's start (the M2.5 injury seam removes and returns players).
  const momentBefore = (
    a: { period: number; secondsRemaining: number },
    b: { period: number; secondsRemaining: number },
  ): boolean =>
    a.period < b.period || (a.period === b.period && a.secondsRemaining > b.secondsRemaining);
  for (const stint of stints) {
    for (const playerVersionId of stint.players) {
      if (unavailable.has(playerVersionId)) {
        failures.push(`${sideKey}: stint contains pregame-unavailable ${playerVersionId}`);
      }
    }
  }
  for (const event of [
    ...result.foulOuts.filter((e) => e.side === sideKey),
    ...result.removals.filter((e) => e.side === sideKey),
  ]) {
    for (const stint of stints) {
      if (!stint.players.includes(event.playerVersionId)) continue;
      const playsPast =
        stint.period > event.period ||
        (stint.period === event.period && stint.endSecondsRemaining < event.secondsRemaining);
      if (!playsPast) continue;
      const reenabledBeforeStintStart = result[sideKey].returns.some(
        (ret) =>
          ret.playerVersionId === event.playerVersionId &&
          !momentBefore(
            { period: stint.period, secondsRemaining: stint.startSecondsRemaining },
            ret,
          ),
      );
      if (reenabledBeforeStintStart) continue;
      failures.push(
        `${sideKey}: ${event.playerVersionId} plays in period ${String(stint.period)} after removal in period ${String(event.period)}`,
      );
    }
  }
  // M2.5 legality mirror for returns: no stint overlapping the unavailable
  // window — after the player's removal boundary and before the return
  // boundary — contains them. A stint entirely before the removal (the
  // player was available) or entirely at/after the return boundary is legal;
  // a return without a removal is a no-op and never flags.
  for (const event of result[sideKey].returns) {
    const removal = result.removals.find(
      (entry) => entry.side === sideKey && entry.playerVersionId === event.playerVersionId,
    );
    if (removal === undefined) continue;
    for (const stint of stints) {
      if (!stint.players.includes(event.playerVersionId)) continue;
      const stintStart = { period: stint.period, secondsRemaining: stint.startSecondsRemaining };
      const stintEnd = { period: stint.period, secondsRemaining: stint.endSecondsRemaining };
      const afterRemoval = momentBefore(removal, stintEnd);
      const beforeReturn = momentBefore(stintStart, event);
      if (afterRemoval && beforeReturn) {
        failures.push(
          `${sideKey}: ${event.playerVersionId} plays between the removal and (${String(event.period)}, ${String(event.secondsRemaining)}) return`,
        );
      }
    }
  }
  for (const event of result.foulOuts) {
    if (event.side !== sideKey) continue;
    const player = result[sideKey].players.find((p) => p.playerVersionId === event.playerVersionId);
    if (player === undefined || player.fouls < 6) {
      failures.push(`${sideKey}: foul-out for a player with fewer than six fouls`);
    }
  }
  const playerFouls = result[sideKey].players.reduce((sum, p) => sum + p.fouls, 0);
  if (playerFouls !== result[sideKey].box.fouls) {
    failures.push(`${sideKey}: player fouls != team fouls`);
  }
}

/** Deviation audit: exact emission set, causes, regulation-only seconds. */
function deviationAudit(
  failures: string[],
  sideKey: 'home' | 'away',
  result: Extract<SeasonGameSimulationResult, { outcome: 'completed' }>,
  input: SeasonGameSimulationInput,
): void {
  const rotation = sideKey === 'home' ? input.homeRotation : input.awayRotation;
  const regSeconds = new Map<string, number>();
  for (const stint of result.unitStints) {
    if (stint.side !== sideKey || stint.period > 4) continue;
    for (const playerVersionId of stint.players) {
      regSeconds.set(
        playerVersionId,
        (regSeconds.get(playerVersionId) ?? 0) + stint.durationSeconds,
      );
    }
  }
  const targets = new Map<string, number>();
  for (const entry of rotation.targetMinutes) {
    targets.set(entry.playerVersionId, entry.minutes * 60);
  }
  const devs = result.deviations.filter((d) => d.side === sideKey);
  const devIds = new Set(devs.map((d) => d.playerVersionId));
  for (const player of result[sideKey].players) {
    const actual = regSeconds.get(player.playerVersionId) ?? 0;
    const target = targets.get(player.playerVersionId) ?? 0;
    const hasDeviation = devIds.has(player.playerVersionId);
    if (actual !== target && !hasDeviation) {
      failures.push(`${sideKey}: missing deviation for ${player.playerVersionId}`);
    }
    if (actual === target && hasDeviation) {
      failures.push(`${sideKey}: spurious deviation for ${player.playerVersionId}`);
    }
  }
  for (const dev of devs) {
    if (dev.reasons.length === 0) {
      failures.push(`${sideKey}: deviation for ${dev.playerVersionId} has no reasons`);
    }
    if (dev.reasons.some((reason) => !isDeviationReason(reason))) {
      failures.push(`${sideKey}: deviation with an unknown reason`);
    }
    if (targets.get(dev.playerVersionId) === undefined) {
      failures.push(`${sideKey}: deviation for an unrostered version ${dev.playerVersionId}`);
    }
  }
  const unavailable = new Set<string>();
  for (const entry of input.availability) {
    if (
      !entry.available &&
      input[sideKey].players.some((p) => p.playerVersionId === entry.playerVersionId)
    ) {
      unavailable.add(entry.playerVersionId);
    }
  }
  for (const dev of devs) {
    if (unavailable.has(dev.playerVersionId) && !dev.reasons.includes('pregame-unavailable')) {
      failures.push(`${sideKey}: ${dev.playerVersionId} missing pregame-unavailable reason`);
    }
    if (
      result.foulOuts.some(
        (e) => e.side === sideKey && e.playerVersionId === dev.playerVersionId,
      ) &&
      !dev.reasons.includes('foul-out')
    ) {
      failures.push(`${sideKey}: ${dev.playerVersionId} missing foul-out reason`);
    }
    if (
      result.removals.some(
        (e) => e.side === sideKey && e.playerVersionId === dev.playerVersionId,
      ) &&
      !dev.reasons.includes('injected-injury-removal')
    ) {
      failures.push(`${sideKey}: ${dev.playerVersionId} missing injected-injury-removal reason`);
    }
    if (
      result[sideKey].returns.some((e) => e.playerVersionId === dev.playerVersionId) &&
      !dev.reasons.includes('injury-return')
    ) {
      failures.push(`${sideKey}: ${dev.playerVersionId} missing injury-return reason`);
    }
  }
  let balance = 0;
  for (const dev of devs) balance += dev.actualSeconds - dev.targetSeconds;
  if (balance !== 0) {
    failures.push(`${sideKey}: deviation seconds do not balance (${String(balance)})`);
  }
}

function isDeviationReason(reason: string): boolean {
  return (
    reason === 'dead-ball-timing' ||
    reason === 'closing-preference' ||
    reason === 'foul-out' ||
    reason === 'pregame-unavailable' ||
    reason === 'injected-injury-removal' ||
    reason === 'contingency-legality' ||
    reason === 'injury-return'
  );
}

/** Pregame legality: available roster can field the planner's initial five. */
function sideHasLegalFiveAtTipoff(
  input: SeasonGameSimulationInput,
  sideKey: 'home' | 'away',
): boolean {
  return initialUnitAtTipoff(input, sideKey) !== null;
}

/** Planner initial unit (starters if legal, else the first contingency). */
function initialUnitAtTipoff(
  input: SeasonGameSimulationInput,
  sideKey: 'home' | 'away',
): string[] | null {
  const team = input[sideKey];
  const rotation = sideKey === 'home' ? input.homeRotation : input.awayRotation;
  const unavailable = new Set<string>();
  for (const entry of input.availability) {
    if (!entry.available && team.players.some((p) => p.playerVersionId === entry.playerVersionId)) {
      unavailable.add(entry.playerVersionId);
    }
  }
  for (const removal of input.removals) {
    if (
      removal.side === sideKey &&
      removal.period === 1 &&
      removal.secondsRemaining >= REGULATION_PERIOD_SECONDS
    ) {
      unavailable.add(removal.playerVersionId);
    }
  }
  const context: PlannerRotationContext = {
    rotation,
    members: new Map(team.players.map((p) => [p.playerVersionId, p.positions])),
    targets: new Map(rotation.targetMinutes.map((t) => [t.playerVersionId, t.minutes * 60])),
  };
  return chooseInitialUnit(context, unavailable);
}
