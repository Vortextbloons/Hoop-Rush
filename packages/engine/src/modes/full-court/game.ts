import type {
  EraSimulationProfile,
  FullCourtDefensiveMatchups,
  FullCourtOffensiveHierarchy,
  FullCourtTactics,
  PlayerDiagnostics,
  Seed,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import { hexSeed } from '../../challenge/seeds.ts';
import { MAX_PERIODS_HARD_CAP } from '../../sim/clock.ts';
import { ENGINE_CONSTANTS } from '../../sim/constants.ts';
import type { EffectsHook } from '../../game/effects.ts';
import { freeThrowProbability } from '../../sim/fouls.ts';
import type { EngineContext } from '../../sim/kernel.ts';
import {
  createGameState,
  createTripContext,
  resolveTrip,
  type TripContext,
} from '../../sim/possession.ts';
import { prepareTeam, type TeamPrep } from '../../sim/prepare.ts';
import { GameRecorder, type SideIndex } from '../../sim/recorder.ts';
import { createRng, type Rng } from '../../sim/rng.ts';
import {
  FULL_COURT_FOUL_LIMIT,
  FULL_COURT_HALFTIME_RECOVERY,
  FULL_COURT_MAX_PLAYER_SECONDS,
  FULL_COURT_MIN_ROSTER,
  FULL_COURT_OVERTIME_PLAYER_SECONDS,
  FULL_COURT_PERIOD_BREAK_RECOVERY,
  FULL_COURT_REGULATION_SECONDS,
  FULL_COURT_REGULATION_TEAM_SECONDS,
  FullCourtSetupError,
  drainedEnergy,
  fatigueLevelOf,
  fatiguedPlayer,
  planSubstitution,
  recoveredEnergy,
  resolveRotationPlan,
  type FullCourtAvailabilityEntry,
  type FullCourtPlanNote,
  type FullCourtRotationContext,
  type FullCourtRotationPlan,
  type FullCourtRotationPlanInput,
  type FullCourtRotationSnapshot,
  type FullCourtRotationUnit,
  type FullCourtRuleRuntimeState,
  type FullCourtStaggeringInput,
  type FullCourtSubstitutionReason,
} from './rotation.ts';
import {
  activeDefensiveMatchupSignature,
  applyFullCourtDefensiveMatchupsToPrep,
  resolveFullCourtDefensiveMatchups,
} from './matchups.ts';
import { resolveFullCourtRouletteTeam, type FullCourtRouletteTeamInput } from './roulette.ts';
import { FullCourtRouletteRuntime, type FullCourtMutationRollup } from './roulette-runtime.ts';
import {
  applyFullCourtTacticsToPrep,
  fullCourtPaceMultiplier,
  fullCourtPressureEnergyScale,
  fullCourtProfiledPace,
  fullCourtTacticsEffects,
  resolveFullCourtTactics,
} from './tactics.ts';

export {
  FULL_COURT_CLOSING_MARGIN,
  FULL_COURT_CLOSING_MIN_ENERGY,
  FULL_COURT_CLOSING_WINDOW_SECONDS,
  FULL_COURT_FATIGUE_STEPS,
  FULL_COURT_FOUL_LIMIT,
  FULL_COURT_MAX_PLAYER_MINUTES,
  FULL_COURT_MAX_PLAYER_SECONDS,
  FULL_COURT_MAX_ROSTER,
  FULL_COURT_MIN_ROSTER,
  FULL_COURT_PACE_DEVIATION_SECONDS,
  FULL_COURT_REGULATION_SECONDS,
  FULL_COURT_REGULATION_TEAM_SECONDS,
  FULL_COURT_ROTATION_VERSION,
  FULL_COURT_RULE_COOLDOWN_SECONDS,
  FULL_COURT_SEVERE_FATIGUE_ENERGY,
  FULL_COURT_TIRED_ENERGY,
  FullCourtSetupError,
  fatigueLevelOf,
  fatiguePenaltyOf,
  fatiguedPlayer,
  isClosingWindow,
  planSubstitution,
  resolveRotationPlan,
  staminaProfileOf,
  unitNameFor,
  type FullCourtAvailabilityEntry,
  type FullCourtAvailabilityReason,
  type FullCourtPlanNote,
  type FullCourtRotationContext,
  type FullCourtRotationPlan,
  type FullCourtRotationPlanInput,
  type FullCourtRotationSnapshot,
  type FullCourtRotationUnit,
  type FullCourtRulePlan,
  type FullCourtRuleRuntimeState,
  type FullCourtSetupErrorCode,
  type FullCourtStaminaProfile,
  type FullCourtStaminaSource,
  type FullCourtStaggeringInput,
  type FullCourtSubstitutionDecision,
  type FullCourtSubstitutionReason,
} from './rotation.ts';

export const FULL_COURT_SEED_VERSION = 'full-court-v1';

const REGULATION_PERIOD_SECONDS = 720;
const OVERTIME_PERIOD_SECONDS = 300;
const MAX_SUBSTITUTIONS_PER_BOUNDARY = 8;

export type FullCourtSeedStream = 'possession' | 'tip' | 'technical';

/** Named per-subsystem seed streams derived from the game seed. */
export function fullCourtStreamSeed(seed: Seed, stream: FullCourtSeedStream): Seed {
  return hexSeed(`hoop-rush:${FULL_COURT_SEED_VERSION}:${seed}:${stream}`);
}

export interface FullCourtTeamGameInput {
  readonly teamId: string;
  readonly displayName: string;
  /** Five to twelve players in stable roster order, used to resolve ties. */
  readonly roster: readonly SimulationPlayer[];
  readonly rotation?: FullCourtRotationPlanInput;
  /** Pregame availability, starting energy, and stamina from the health system. */
  readonly availability?: readonly FullCourtAvailabilityEntry[];
  /** Optional per-game tactics; balanced settings leave the prepared game unchanged. */
  readonly tactics?: FullCourtTactics;
  /** Optional per-player offensive hierarchy; absent leaves opportunity weights untouched. */
  readonly hierarchy?: FullCourtOffensiveHierarchy;
  /** Optional per-fixture defensive matchup assignments; absent leaves default coverage unchanged. */
  readonly defensiveMatchups?: FullCourtDefensiveMatchups;
  /** Optional Full Court Roulette mutation attachments for this team. */
  readonly roulette?: FullCourtRouletteTeamInput;
}

export interface FullCourtGameInput {
  readonly schemaVersion: 1;
  readonly seed: Seed;
  readonly gameNumber: number;
  readonly dataVersion: string;
  readonly profile: EraSimulationProfile;
  readonly home: FullCourtTeamGameInput;
  readonly away: FullCourtTeamGameInput;
}

export interface FullCourtLineupStint {
  /** Player ids on the floor for the stint, in tactical slot order. */
  readonly playerIds: readonly string[];
  readonly startSeconds: number;
  readonly seconds: number;
  readonly points: number;
  readonly possessions: number;
}

export interface FullCourtPlayerLine {
  readonly playerId: SimulationPlayer['playerId'];
  readonly displayName: string;
  readonly startedGame: boolean;
  readonly available: boolean;
  /** Planned regulation seconds, normalized so the plan sums to 240 team minutes. */
  readonly plannedSeconds: number;
  /** Exact live seconds played, including overtime. */
  readonly seconds: number;
  /** Minutes to one decimal place; `seconds` remains authoritative. */
  readonly minutes: number;
  readonly points: number;
  readonly fieldGoals: { readonly made: number; readonly attempted: number };
  readonly threes: { readonly made: number; readonly attempted: number };
  readonly freeThrows: { readonly made: number; readonly attempted: number };
  readonly rebounds: {
    readonly total: number;
    readonly offensive: number;
    readonly defensive: number;
  };
  readonly assists: number;
  readonly steals: number;
  readonly blocks: number;
  readonly turnovers: number;
  readonly fouls: number;
  readonly deepFours?: { readonly made: number; readonly attempted: number };
  readonly diagnostics: PlayerDiagnostics;
  /** Energy left at the final horn in 0..1. */
  readonly energyRemaining: number;
  readonly fatigueLevel: number;
  readonly foulsOut: boolean;
  readonly emergencyContinuation: boolean;
  /** Number of recorded lineup stints that include this player. */
  readonly stints: number;
  /** Present on generated clone participants in Full Court Roulette. */
  readonly kind?: 'roster' | 'clone';
  /** Owner roster player id for generated clones. */
  readonly ownerPlayerId?: string;
  /** Charged personal fouls after Foul Thief relief, when distinct from committed fouls. */
  readonly chargedFouls?: number;
}

export type FullCourtTeamBox = ReturnType<GameRecorder['seasonTeamBox']>;

export interface FullCourtTeamResult {
  readonly teamId: string;
  readonly displayName: string;
  readonly box: FullCourtTeamBox;
  readonly players: readonly FullCourtPlayerLine[];
  /** Live seconds the team was on the floor over regulation and overtime. */
  readonly liveSeconds: number;
  /** Sum of player seconds; always five times `liveSeconds`. */
  readonly teamSeconds: number;
  readonly plannedTeamSeconds: number;
  readonly stints: readonly FullCourtLineupStint[];
  readonly technicalFouls: number;
  readonly disqualifications: number;
  readonly notes: readonly FullCourtPlanNote[];
  readonly units: readonly FullCourtRotationUnit[];
  /** Team-level bonus points awarded by Roulette mutations (e.g. opponent misses). */
  readonly teamBonusPoints?: number;
  /** Sum of player-attributed Roulette scoring adjustments. */
  readonly pointAdjustments?: number;
  /** Per-mutation trigger and delta summary in Roulette games. */
  readonly mutationRollups?: readonly FullCourtMutationRollup[];
}

export interface FullCourtGameResult {
  readonly schemaVersion: 1;
  readonly seed: Seed;
  readonly gameNumber: number;
  readonly engineVersion: string;
  readonly dataVersion: string;
  readonly profileVersion: string;
  readonly home: FullCourtTeamResult;
  readonly away: FullCourtTeamResult;
  readonly periodScores: {
    readonly home: readonly number[];
    readonly away: readonly number[];
  };
  readonly winner: 'home' | 'away';
  readonly overtimePeriods: number;
  /** Live seconds elapsed in the game. */
  readonly totalSeconds: number;
}

export type FullCourtTapeEvent =
  | {
      readonly kind: 'period';
      readonly period: number;
      readonly homeScore: number;
      readonly awayScore: number;
    }
  | {
      readonly kind: 'substitution';
      readonly period: number;
      readonly clockSeconds: number;
      readonly side: SideIndex;
      readonly outPlayerId: string;
      readonly inPlayerId: string;
      readonly reason: FullCourtSubstitutionReason;
    }
  | {
      readonly kind: 'technical';
      readonly period: number;
      readonly clockSeconds: number;
      readonly side: SideIndex;
      readonly shooterPlayerId: string;
      readonly made: boolean;
      readonly againstPlayerId: string;
      readonly homeUnit?: readonly string[];
      readonly awayUnit?: readonly string[];
    }
  | {
      readonly kind: 'trip';
      readonly period: number;
      readonly clockSeconds: number;
      readonly secondsElapsed: number;
      readonly offense: SideIndex;
      readonly ended: boolean;
      readonly nextPossessionStart: TripContext['possessionStart'];
      readonly homeScore: number;
      readonly awayScore: number;
      readonly homeUnit: readonly string[];
      readonly awayUnit: readonly string[];
    };

export interface FullCourtGameOptions {
  /** Opt-in event writer. It never consumes RNG, so results are unchanged. */
  readonly record?: boolean;
  /** Optional possession effects. Within-game fatigue applies through player ratings. */
  readonly effects?: EffectsHook;
}

export interface FullCourtRecordedGameOutput {
  readonly result: FullCourtGameResult;
  readonly tape: readonly FullCourtTapeEvent[];
}

interface LineupState {
  readonly players: readonly SimulationPlayer[];
  readonly team: SimulationTeam;
  readonly prep: TeamPrep;
  readonly units: readonly string[];
  readonly key: number | string;
}

interface StintRecord {
  readonly playerIds: readonly string[];
  readonly startSeconds: number;
  readonly pointsAtStart: number;
  readonly possessionsAtStart: number;
}

/**
 * One side's live state: the five on the floor, exact playing time, energy,
 * fouls, and the lineup preparation the possession kernel currently sees.
 */
class RotationRuntime {
  readonly plan: FullCourtRotationPlan;
  readonly side: SideIndex;
  readonly teamId: string;
  readonly displayName: string;
  readonly slots: number[];
  readonly energy: number[];
  readonly playedSeconds: number[];
  readonly stintSeconds: number[];
  readonly fouls: number[];
  readonly emergency: boolean[];
  readonly ruleState: FullCourtRuleRuntimeState;
  readonly stints: FullCourtLineupStint[] = [];
  technicalFouls = 0;
  /** Exact live seconds this side has been on the floor. */
  teamSecondsPlayed = 0;
  lineup: LineupState;
  private stint: StintRecord;
  private readonly profile: EraSimulationProfile;
  readonly tactics: FullCourtTactics;
  private readonly opponentDefense: FullCourtTactics['defense'];
  private readonly hierarchy: FullCourtOffensiveHierarchy | undefined;
  private readonly resolvedMatchups: ReadonlyMap<string, string> | null;
  private readonly roulette: FullCourtRouletteRuntime | undefined;
  private mutationEpoch = 0;
  private currentMatchupKey = '';
  private readonly playerCache: Array<Map<number, SimulationPlayer>>;
  private readonly prepCache = new Map<number | string, LineupState>();
  private readonly matchupPrepCache = new Map<string, LineupState>();

  constructor(
    plan: FullCourtRotationPlan,
    side: SideIndex,
    teamId: string,
    displayName: string,
    profile: EraSimulationProfile,
    tactics: FullCourtTactics,
    opponentDefense: FullCourtTactics['defense'],
    hierarchy: FullCourtOffensiveHierarchy | undefined,
    resolvedMatchups: ReadonlyMap<string, string> | null,
    roulette?: FullCourtRouletteRuntime,
  ) {
    this.plan = plan;
    this.side = side;
    this.teamId = teamId;
    this.displayName = displayName;
    this.profile = profile;
    this.tactics = tactics;
    this.opponentDefense = opponentDefense;
    this.hierarchy = hierarchy;
    this.resolvedMatchups = resolvedMatchups;
    this.roulette = roulette;
    this.mutationEpoch = roulette?.profileEpoch(side) ?? 0;
    this.slots = [...plan.startingSlots];
    this.energy = [...plan.startingEnergy];
    this.playedSeconds = plan.roster.map(() => 0);
    this.stintSeconds = plan.roster.map(() => 0);
    this.fouls = plan.roster.map(() => 0);
    this.emergency = plan.roster.map(() => false);
    this.ruleState = {
      activated: plan.rules.map(() => false),
      cooldownsUntil: plan.rules.map(() => 0),
      boundarySeconds: -1,
      boundaryRuleIndex: -1,
    };
    const cacheCount = roulette?.recorderSize(side) ?? plan.roster.length;
    this.playerCache = Array.from(
      { length: cacheCount },
      () => new Map<number, SimulationPlayer>(),
    );
    this.lineup = this.buildLineup(this.lineupKey());
    this.stint = {
      playerIds: this.activePlayerIds(),
      startSeconds: 0,
      pointsAtStart: 0,
      possessionsAtStart: 0,
    };
  }

  playerAt(index: number): SimulationPlayer {
    const player = this.plan.roster[index];
    if (player === undefined) {
      throw new Error(`full court: no roster player at index ${String(index)}`);
    }
    return player;
  }

  levelOf(index: number): number {
    if (this.roulette !== undefined && index >= this.plan.roster.length) {
      return this.roulette.cloneFatigueLevel(this.side, index);
    }
    return fatigueLevelOf(this.energy[index] ?? 0);
  }

  activeRecorderIndices(): readonly number[] {
    if (this.roulette === undefined) return this.slots;
    const clones = this.roulette.activeCloneRecorderIndices(this.side);
    return clones.length === 0 ? this.slots : [...this.slots, ...clones];
  }

  activePlayerIds(): readonly string[] {
    const rosterIds = this.slots.map((index) => this.playerAt(index).playerId);
    if (this.roulette === undefined) return rosterIds;
    const cloneIds = this.roulette.activeCloneIds(this.side);
    return cloneIds.length === 0 ? rosterIds : [...rosterIds, ...cloneIds];
  }

  private lineupKey(): number | string {
    const indices = this.activeRecorderIndices();
    if (indices.length === 5 && this.roulette === undefined) {
      let key = 0;
      // Each active player's roster index and fatigue level fit in seven bits.
      for (const index of indices) key = key * 128 + index * 8 + this.levelOf(index);
      return key;
    }
    return `${String(this.mutationEpoch)}:${indices
      .map((index) => `${String(index)}:${String(this.levelOf(index))}`)
      .join(',')}`;
  }

  private buildLineup(key: number | string): LineupState {
    const cached = this.prepCache.get(key);
    if (cached !== undefined) return cached;
    const roulette = this.roulette;
    const indices = this.activeRecorderIndices();
    const players =
      roulette === undefined
        ? indices.map((index) =>
            fatiguedPlayer(this.playerAt(index), this.levelOf(index), this.playerCache[index]),
          )
        : indices.map((index) =>
            roulette.effectiveSimulationPlayer(
              this.side,
              index,
              this.levelOf(index),
              this.playerCache[index],
            ),
          );
    const team: SimulationTeam = {
      teamId: this.teamId,
      displayName: this.displayName,
      players,
    };
    const rawPrep =
      roulette === undefined
        ? prepareTeam(team, this.profile)
        : prepareTeam(team, this.profile, {
            keyOf: (player) => roulette.hooks.keyOf(player),
            responsibilitySlotOf: (player) => roulette.hooks.responsibilitySlotOf(player),
            evidenceOf: (player) => roulette.hooks.evidenceOf(player),
            aggregateDivisor: roulette.hooks.aggregateDivisor(),
            rebounderWeightScale: (player) => roulette.hooks.reboundWeightScale(player),
            reboundMeanReach: (lineup) => roulette.hooks.reboundMeanReach(lineup),
          });
    const prep = applyFullCourtTacticsToPrep(
      rawPrep,
      players,
      this.profile,
      this.tactics,
      this.opponentDefense,
      this.hierarchy,
    );
    const lineup: LineupState = {
      players,
      team,
      prep,
      units:
        roulette === undefined
          ? indices.map((index) => this.plan.playerKeys[index] ?? '')
          : indices.map((index) => roulette.playerKeyForRecorderIndex(this.side, index)),
      key,
    };
    this.prepCache.set(key, lineup);
    return lineup;
  }

  /**
   * Rebuilds the lineup only when the on-court unit, dynamic mutation profile,
   * or fatigue level changed, so the kernel reuses one prepared layout across
   * ordinary trips.
   */
  refreshLineup(opponentActivePlayerIds?: readonly string[]): boolean {
    const epoch = this.roulette?.profileEpoch(this.side) ?? 0;
    if (epoch !== this.mutationEpoch) {
      this.mutationEpoch = epoch;
      for (const cache of this.playerCache) cache.clear();
      this.prepCache.clear();
      this.matchupPrepCache.clear();
      this.currentMatchupKey = '';
    }
    const key = this.lineupKey();
    if (this.resolvedMatchups === null) {
      if (key !== this.lineup.key) {
        this.lineup = this.buildLineup(key);
        return true;
      }
      return false;
    }
    const active =
      opponentActivePlayerIds === undefined
        ? null
        : activeDefensiveMatchupSignature(
            this.slots,
            this.plan.roster,
            opponentActivePlayerIds,
            this.resolvedMatchups,
          );
    const nextMatchupKey = active?.key ?? '';
    if (key === this.lineup.key && nextMatchupKey === this.currentMatchupKey) return false;
    const base = this.buildLineup(key);
    if (active === null) {
      this.lineup = base;
      this.currentMatchupKey = '';
      return true;
    }
    const cacheKey = `${String(key)}|${active.key}`;
    let matched = this.matchupPrepCache.get(cacheKey);
    if (matched === undefined) {
      matched = {
        ...base,
        prep: applyFullCourtDefensiveMatchupsToPrep(base.prep, active.pairs),
      };
      this.matchupPrepCache.set(cacheKey, matched);
    }
    this.lineup = matched;
    this.currentMatchupKey = active.key;
    return true;
  }

  snapshot(): FullCourtRotationSnapshot {
    return {
      plan: this.plan,
      slots: this.slots,
      energies: this.energy,
      fouls: this.fouls,
      emergency: this.emergency,
      playedSeconds: this.playedSeconds,
      stintSeconds: this.slots.map((index) => this.stintSeconds[index] ?? 0),
    };
  }

  beginStint(globalSeconds: number, recorder: GameRecorder): void {
    this.stint = {
      playerIds: this.activePlayerIds(),
      startSeconds: globalSeconds,
      pointsAtStart: recorder.sides[this.side].points,
      possessionsAtStart: recorder.sides[this.side].possessions,
    };
  }

  closeStint(globalSeconds: number, recorder: GameRecorder): void {
    const side = recorder.sides[this.side];
    const seconds = Math.max(0, globalSeconds - this.stint.startSeconds);
    const points = side.points - this.stint.pointsAtStart;
    const possessions = side.possessions - this.stint.possessionsAtStart;
    const playerIds = this.stint.playerIds;
    const previous = this.stints.at(-1);
    if (
      previous !== undefined &&
      previous.startSeconds + previous.seconds === this.stint.startSeconds &&
      previous.playerIds.length === playerIds.length &&
      previous.playerIds.every((id, index) => id === playerIds[index])
    ) {
      // A period break does not change the five, so keep one continuous stint.
      this.stints[this.stints.length - 1] = {
        playerIds: previous.playerIds,
        startSeconds: previous.startSeconds,
        seconds: previous.seconds + seconds,
        points: previous.points + points,
        possessions: previous.possessions + possessions,
      };
    } else if (seconds > 0 || points !== 0 || possessions !== 0) {
      this.stints.push({
        playerIds,
        startSeconds: this.stint.startSeconds,
        seconds,
        points,
        possessions,
      });
    }
    this.beginStint(globalSeconds, recorder);
  }
}

/**
 * The staggering preference reuses the saved offensive hierarchy, so it never
 * introduces another roster assignment. Only the two scoring roles count.
 */
function fullCourtStaggering(team: FullCourtTeamGameInput): FullCourtStaggeringInput | undefined {
  if (team.rotation?.staggerStars !== true) return undefined;
  const scorerPlayerIds = [
    team.hierarchy?.primaryPlayerId,
    team.hierarchy?.secondaryPlayerId,
  ].filter((playerId): playerId is string => playerId !== undefined);
  return scorerPlayerIds.length === 0 ? undefined : { scorerPlayerIds };
}

export function simulateFullCourtGame(
  input: FullCourtGameInput,
  context: EngineContext,
  options: FullCourtGameOptions = {},
): FullCourtGameResult {
  return runFullCourtGame(input, context, options).result;
}

export function simulateRecordedFullCourtGame(
  input: FullCourtGameInput,
  context: EngineContext,
  options: FullCourtGameOptions = {},
): FullCourtRecordedGameOutput {
  const run = runFullCourtGame(input, context, { ...options, record: true });
  return { result: run.result, tape: run.tape ?? [] };
}

export interface FullCourtGameRun {
  readonly result: FullCourtGameResult;
  readonly tape: readonly FullCourtTapeEvent[] | null;
}

export function runFullCourtGame(
  input: FullCourtGameInput,
  context: EngineContext,
  options: FullCourtGameOptions = {},
): FullCourtGameRun {
  if (input.home.teamId === input.away.teamId) {
    throw new FullCourtSetupError(
      'invalid-lineup',
      'full court requires distinct home and away team ids',
    );
  }
  if (
    input.home.roster.length < FULL_COURT_MIN_ROSTER ||
    input.away.roster.length < FULL_COURT_MIN_ROSTER
  ) {
    throw new FullCourtSetupError(
      'roster-size',
      `full court requires at least ${String(FULL_COURT_MIN_ROSTER)} players per roster`,
    );
  }
  const hasRoulette = FullCourtRouletteRuntime.hasMutations(input.home, input.away);
  const homeRoster =
    input.home.roulette !== undefined
      ? resolveFullCourtRouletteTeam(input.home).roster
      : input.home.roster;
  const awayRoster =
    input.away.roulette !== undefined
      ? resolveFullCourtRouletteTeam(input.away).roster
      : input.away.roster;
  const homePlan = resolveRotationPlan(
    homeRoster,
    input.home.rotation ?? {},
    input.home.availability ?? [],
    fullCourtStaggering(input.home),
  );
  const awayPlan = resolveRotationPlan(
    awayRoster,
    input.away.rotation ?? {},
    input.away.availability ?? [],
    fullCourtStaggering(input.away),
  );
  const homeTactics = resolveFullCourtTactics(input.home.tactics);
  const awayTactics = resolveFullCourtTactics(input.away.tactics);
  const profile = fullCourtProfiledPace(
    input.profile,
    fullCourtPaceMultiplier([homeTactics, awayTactics]),
  );
  const roulette = hasRoulette
    ? new FullCourtRouletteRuntime({
        seed: input.seed,
        rngFactory: context.rngFactory,
        homeTeam: input.home,
        awayTeam: input.away,
        homePlan,
        awayPlan,
      })
    : undefined;
  const homeMatchups = resolveFullCourtDefensiveMatchups({
    ownRoster: homePlan.roster,
    opponentTeamId: input.away.teamId,
    opponentRoster: awayPlan.roster,
    matchups: input.home.defensiveMatchups,
  });
  const awayMatchups = resolveFullCourtDefensiveMatchups({
    ownRoster: awayPlan.roster,
    opponentTeamId: input.home.teamId,
    opponentRoster: homePlan.roster,
    matchups: input.away.defensiveMatchups,
  });
  const home = new RotationRuntime(
    homePlan,
    0,
    input.home.teamId,
    input.home.displayName,
    profile,
    homeTactics,
    awayTactics.defense,
    input.home.hierarchy,
    homeMatchups,
    roulette,
  );
  const away = new RotationRuntime(
    awayPlan,
    1,
    input.away.teamId,
    input.away.displayName,
    profile,
    awayTactics,
    homeTactics.defense,
    input.away.hierarchy,
    awayMatchups,
    roulette,
  );
  const runtimes: readonly [RotationRuntime, RotationRuntime] = [home, away];
  roulette?.onTipoff([home.slots, away.slots]);
  refreshLineups(runtimes);

  const recorder = new GameRecorder(
    roulette === undefined
      ? [homePlan.roster.length, awayPlan.roster.length]
      : [roulette.recorderSize(0), roulette.recorderSize(1)],
  );
  roulette?.bindRecorder(recorder);
  setRecorderActiveUnits(recorder, 0, home.activeRecorderIndices());
  setRecorderActiveUnits(recorder, 1, away.activeRecorderIndices());
  const state = createGameState();
  const possessionRng = context.rngFactory(fullCourtStreamSeed(input.seed, 'possession'));
  const tipRng = context.rngFactory(fullCourtStreamSeed(input.seed, 'tip'));
  const technicalRng = context.rngFactory(fullCourtStreamSeed(input.seed, 'technical'));
  const tacticalEffects = fullCourtTacticsEffects(options.effects, [homeTactics, awayTactics]);
  // The shared effects channel looks up player versions. Legacy rosters still use lineup tactics.
  const effects =
    tacticalEffects !== options.effects &&
    [homePlan, awayPlan].some((plan) =>
      plan.roster.some(
        (player, index) => plan.available[index] && player.playerVersionId === undefined,
      ),
    )
      ? options.effects
      : tacticalEffects;
  const ctx: TripContext = createTripContext(
    possessionRng,
    recorder,
    state,
    profile,
    [home.lineup.team, away.lineup.team],
    undefined,
    effects,
    [home.lineup.prep, away.lineup.prep],
  );
  ctx.externalRng = context.rngFactory !== createRng;
  ctx.disqualificationLimit = FULL_COURT_FOUL_LIMIT;
  ctx.teamUnits = [home.lineup.units, away.lineup.units];
  if (roulette !== undefined) {
    ctx.havoc = roulette.hooks;
    roulette.bindShotClock(() => ctx.shotClock?.remaining ?? null);
  }
  effects?.setActiveUnits(home.lineup.units, away.lineup.units);

  const tape: FullCourtTapeEvent[] | null = options.record === true ? [] : null;
  home.beginStint(0, recorder);
  away.beginStint(0, recorder);

  const openingTipWinner: SideIndex = tipRng.chance(0.5) ? 0 : 1;
  let offense = openingTipWinner;
  let globalSeconds = 0;
  let period = 0;

  for (;;) {
    if (period > 0) {
      const homeScore = recorder.sides[0].points;
      const awayScore = recorder.sides[1].points;
      if (period >= 4 && homeScore !== awayScore) break;
      if (period >= MAX_PERIODS_HARD_CAP) {
        throw new Error(
          `full court: exceeded ${String(MAX_PERIODS_HARD_CAP)} periods without a winner (${String(homeScore)}-${String(awayScore)})`,
        );
      }
      for (const runtime of runtimes) runtime.closeStint(globalSeconds, recorder);
      recorder.nextPeriod();
      state.periodIndex = period;
      state.periodFouls = [0, 0];
      ctx.possessionStart = 'neutral';
      if (period >= 4) {
        offense = tipRng.chance(0.5) ? 0 : 1;
      } else {
        offense = period === 3 ? openingTipWinner : ((1 - openingTipWinner) as SideIndex);
      }
      applyBreakRecovery(runtimes, period, effects, roulette);
      tape?.push({
        kind: 'period',
        period,
        homeScore: recorder.sides[0].points,
        awayScore: recorder.sides[1].points,
      });
      refreshFouls(runtimes, ctx);
      resolveSubstitutions(
        runtimes,
        recorder,
        {
          globalSeconds,
          period,
          periodSecondsRemaining: period < 4 ? REGULATION_PERIOD_SECONDS : OVERTIME_PERIOD_SECONDS,
          scoreMargin: Math.abs(recorder.sides[0].points - recorder.sides[1].points),
          legalWindow: true,
        },
        tape,
        roulette,
      );
      refreshLineups(runtimes);
      syncKernel(ctx, runtimes, recorder, effects);
    } else {
      resolveSubstitutions(
        runtimes,
        recorder,
        {
          globalSeconds,
          period,
          periodSecondsRemaining: REGULATION_PERIOD_SECONDS,
          scoreMargin: 0,
          legalWindow: true,
        },
        tape,
        roulette,
      );
      refreshLineups(runtimes);
      syncKernel(ctx, runtimes, recorder, effects);
    }

    let secondsRemaining = period < 4 ? REGULATION_PERIOD_SECONDS : OVERTIME_PERIOD_SECONDS;
    let periodStart = true;
    while (secondsRemaining > 0) {
      state.secondsRemaining = secondsRemaining;
      const homeUnit = tape !== null ? home.activePlayerIds() : null;
      const awayUnit = tape !== null ? away.activePlayerIds() : null;
      roulette?.beginPossession(offense, period, periodStart);
      periodStart = false;
      const trip = resolveTrip(ctx, offense);
      if (!trip.ended && trip.secondsElapsed === 0 && state.secondsRemaining > 0) {
        if (state.secondsRemaining >= ENGINE_CONSTANTS.minimumStartSeconds) {
          throw new Error(
            `full court: trip stalled with ${String(state.secondsRemaining)}s remaining`,
          );
        }
        // The kernel declines to start a new play. The clock still runs to the horn.
        state.secondsRemaining = 0;
      }
      const secondsElapsed = secondsRemaining - state.secondsRemaining;
      secondsRemaining = state.secondsRemaining;
      globalSeconds += secondsElapsed;
      chargeTime(runtimes, secondsElapsed, effects, roulette);
      const keepOffense =
        roulette?.afterTrip(offense, trip.ended, secondsRemaining, ctx.personalFouls, [
          homePlan.playerKeys,
          awayPlan.playerKeys,
        ]) ?? false;
      const foulCharges = refreshFouls(runtimes, ctx);
      if (roulette !== undefined) {
        let anyExited = false;
        for (const runtime of runtimes) {
          const exited = roulette.checkCloneFoulOuts(runtime.side, ctx.personalFouls[runtime.side]);
          if (exited.length > 0) {
            runtime.closeStint(globalSeconds, recorder);
            anyExited = true;
          }
        }
        if (anyExited && refreshLineups(runtimes)) {
          syncKernel(ctx, runtimes, recorder, effects);
        }
      }

      if (tape !== null && homeUnit !== null && awayUnit !== null) {
        tape.push({
          kind: 'trip',
          period,
          clockSeconds: secondsRemaining,
          secondsElapsed,
          offense,
          ended: trip.ended,
          nextPossessionStart: ctx.possessionStart,
          homeScore: recorder.sides[0].points,
          awayScore: recorder.sides[1].points,
          homeUnit,
          awayUnit,
        });
      }

      if (trip.ended && !keepOffense) offense = (1 - offense) as SideIndex;
      // Forced disqualification exits apply at once; tactical changes wait for a
      // legal dead ball so live play never gains a fresh defender for free.
      const legalWindow = secondsRemaining > 0 && ctx.possessionStart === 'deadBall';
      const boundary = {
        globalSeconds,
        period,
        periodSecondsRemaining: secondsRemaining,
        scoreMargin: Math.abs(recorder.sides[0].points - recorder.sides[1].points),
        legalWindow,
      };
      if (foulCharges.length > 0) {
        const foulUnits: readonly [readonly string[], readonly string[]] = [
          home.lineup.units,
          away.lineup.units,
        ];
        resolveSubstitutions(
          runtimes,
          recorder,
          { ...boundary, legalWindow: false },
          tape,
          roulette,
        );
        if (refreshLineups(runtimes)) {
          syncKernel(ctx, runtimes, recorder, effects);
        }
        awardEmergencyTechnicals(
          runtimes,
          recorder,
          foulCharges,
          foulUnits,
          technicalRng,
          profile,
          period,
          secondsRemaining,
          tape,
        );
      }
      resolveSubstitutions(
        runtimes,
        recorder,
        {
          ...boundary,
          scoreMargin: Math.abs(recorder.sides[0].points - recorder.sides[1].points),
        },
        tape,
        roulette,
      );
      if (refreshLineups(runtimes)) {
        syncKernel(ctx, runtimes, recorder, effects);
      }
    }
    period += 1;
    if (period >= MAX_PERIODS_HARD_CAP) break;
  }

  for (const runtime of runtimes) runtime.closeStint(globalSeconds, recorder);
  roulette?.onGameEnd();
  const overtimePeriods = Math.max(0, recorder.sides[0].periodPoints.length - 4);
  const homeScore = recorder.sides[0].points;
  const awayScore = recorder.sides[1].points;
  if (homeScore === awayScore) {
    throw new Error(
      `full court: game ended tied ${String(homeScore)}-${String(awayScore)} after ${String(overtimePeriods)} overtime periods`,
    );
  }
  const result: FullCourtGameResult = {
    schemaVersion: 1,
    seed: input.seed,
    gameNumber: input.gameNumber,
    engineVersion: context.engineVersion,
    dataVersion: input.dataVersion,
    profileVersion: profile.profileVersion,
    home: teamResult(home, recorder, roulette),
    away: teamResult(away, recorder, roulette),
    periodScores: {
      home: [...recorder.sides[0].periodPoints],
      away: [...recorder.sides[1].periodPoints],
    },
    winner: homeScore > awayScore ? 'home' : 'away',
    overtimePeriods,
    totalSeconds: globalSeconds,
  };
  return { result, tape };
}

function setRecorderActiveUnits(
  recorder: GameRecorder,
  side: SideIndex,
  indices: readonly number[],
): void {
  if (indices.length === 5) recorder.setActiveFive(side, indices);
  else recorder.setActiveUnits(side, indices);
}

function chargeTime(
  runtimes: readonly RotationRuntime[],
  seconds: number,
  effects: EffectsHook | undefined,
  roulette?: FullCourtRouletteRuntime,
): void {
  if (seconds <= 0) return;
  for (const runtime of runtimes) {
    let active = 0;
    for (const index of runtime.slots) active |= 1 << index;
    const exertionSeconds = seconds * fullCourtPressureEnergyScale(runtime.tactics);
    for (let index = 0; index < runtime.plan.roster.length; index += 1) {
      const energy = runtime.energy[index] ?? 0;
      const stamina = runtime.plan.stamina[index];
      if (stamina === undefined) {
        throw new Error(`full court: missing stamina profile at index ${String(index)}`);
      }
      const onCourt = (active & (1 << index)) !== 0;
      runtime.energy[index] = onCourt
        ? drainedEnergy(energy, stamina, exertionSeconds)
        : recoveredEnergy(energy, seconds);
      if (!onCourt) continue;
      runtime.playedSeconds[index] = (runtime.playedSeconds[index] ?? 0) + seconds;
      runtime.stintSeconds[index] = (runtime.stintSeconds[index] ?? 0) + seconds;
    }
    roulette?.drainClones(runtime.side, exertionSeconds);
    runtime.teamSecondsPlayed += seconds;
    effects?.recordStintSeconds(runtime.side, seconds, runtime.lineup.units);
  }
}

function applyBreakRecovery(
  runtimes: readonly RotationRuntime[],
  period: number,
  effects: EffectsHook | undefined,
  roulette?: FullCourtRouletteRuntime,
): void {
  const recovery = period === 2 ? FULL_COURT_HALFTIME_RECOVERY : FULL_COURT_PERIOD_BREAK_RECOVERY;
  for (const runtime of runtimes) {
    for (let index = 0; index < runtime.energy.length; index += 1) {
      runtime.energy[index] = Math.min(1, (runtime.energy[index] ?? 0) + recovery);
    }
    roulette?.recoverClones(runtime.side, recovery);
  }
  if (period === 2) effects?.halftime();
}

interface FoulCharge {
  readonly side: SideIndex;
  readonly playerIndex: number;
  readonly count: number;
}

function refreshFouls(runtimes: readonly RotationRuntime[], ctx: TripContext): FoulCharge[] {
  const charges: FoulCharge[] = [];
  for (const runtime of runtimes) {
    const map = ctx.personalFouls[runtime.side];
    runtime.plan.playerKeys.forEach((key, index) => {
      const previous = runtime.fouls[index] ?? 0;
      const current = map.get(key) ?? 0;
      runtime.fouls[index] = current;
      const count = current - Math.max(previous, FULL_COURT_FOUL_LIMIT - 1);
      if (count > 0) charges.push({ side: runtime.side, playerIndex: index, count });
    });
  }
  return charges;
}

/**
 * NBA-style emergency continuation: a disqualified player who cannot be replaced
 * keeps playing and receives a technical for the disqualifying and later fouls.
 */
function awardEmergencyTechnicals(
  runtimes: readonly [RotationRuntime, RotationRuntime],
  recorder: GameRecorder,
  charges: readonly FoulCharge[],
  unitsAtFoul: readonly [readonly string[], readonly string[]],
  rng: Rng,
  profile: EraSimulationProfile,
  period: number,
  clockSeconds: number,
  tape: FullCourtTapeEvent[] | null,
): void {
  for (const charge of charges) {
    const runtime = runtimes[charge.side];
    if (runtime.emergency[charge.playerIndex] !== true) continue;
    const opponentSide: SideIndex = charge.side === 0 ? 1 : 0;
    const opponent = runtimes[opponentSide];
    const slot = bestFreeThrowSlot(opponent, unitsAtFoul[opponentSide]);
    const shooter = opponent.lineup.players[slot];
    if (shooter === undefined) throw new Error('Full Court technical has no eligible shooter');
    for (let extra = 0; extra < charge.count; extra += 1) {
      runtime.technicalFouls += 1;
      const made = rng.chance(freeThrowProbability(shooter, profile));
      recorder.freeThrow(opponent.side, slot, made);
      if (!made) recorder.teamRebound(runtime.side);
      tape?.push({
        kind: 'technical',
        period,
        clockSeconds,
        side: opponent.side,
        shooterPlayerId: shooter.playerId,
        made,
        againstPlayerId: runtime.playerAt(charge.playerIndex).playerId,
        homeUnit: runtimes[0].activePlayerIds(),
        awayUnit: runtimes[1].activePlayerIds(),
      });
    }
  }
}

function bestFreeThrowSlot(runtime: RotationRuntime, eligible: readonly string[]): number {
  let best = -1;
  let bestRating = -1;
  for (const [slot, player] of runtime.lineup.players.entries()) {
    const key = runtime.lineup.units[slot];
    if (key === undefined || !eligible.includes(key)) continue;
    if (player.ratings.freeThrow <= bestRating) continue;
    best = slot;
    bestRating = player.ratings.freeThrow;
  }
  return best;
}

interface BoundaryRequest {
  readonly globalSeconds: number;
  readonly period: number;
  readonly periodSecondsRemaining: number;
  readonly scoreMargin: number;
  /** True at dead-ball and period-break windows. */
  readonly legalWindow: boolean;
}

function resolveSubstitutions(
  runtimes: readonly RotationRuntime[],
  recorder: GameRecorder,
  request: BoundaryRequest,
  tape: FullCourtTapeEvent[] | null,
  roulette?: FullCourtRouletteRuntime,
): void {
  const context: FullCourtRotationContext = {
    globalSeconds: request.globalSeconds,
    period: request.period,
    periodSecondsRemaining: request.periodSecondsRemaining,
    scoreMargin: request.scoreMargin,
    legalWindow: request.legalWindow,
  };
  for (const runtime of runtimes) {
    const disqualified = runtime.slots.find(
      (index) =>
        (runtime.fouls[index] ?? 0) >= FULL_COURT_FOUL_LIMIT && runtime.emergency[index] !== true,
    );
    const forced = disqualified !== undefined;
    if (!forced && !request.legalWindow) continue;
    for (let attempt = 0; attempt < MAX_SUBSTITUTIONS_PER_BOUNDARY; attempt += 1) {
      const decision = planSubstitution(runtime.snapshot(), context, runtime.ruleState);
      if (decision.kind === 'none') break;
      if (decision.kind === 'emergency') {
        runtime.emergency[decision.playerIndex] = true;
        continue;
      }
      if (!request.legalWindow && decision.reason !== 'foul-out') break;
      // Close the stint before the swap so minutes, points, and possessions belong
      // to the five that was actually on the floor.
      applySwap(
        runtime,
        recorder,
        request.globalSeconds,
        decision.slot,
        decision.inIndex,
        decision.outIndex,
        decision.reason,
        roulette,
      );
      tape?.push({
        kind: 'substitution',
        period: request.period,
        clockSeconds: request.periodSecondsRemaining,
        side: runtime.side,
        outPlayerId: runtime.playerAt(decision.outIndex).playerId,
        inPlayerId: runtime.playerAt(decision.inIndex).playerId,
        reason: decision.reason,
      });
    }
  }
}

function applySwap(
  runtime: RotationRuntime,
  recorder: GameRecorder,
  globalSeconds: number,
  slot: number,
  inIndex: number,
  outIndex: number,
  reason: FullCourtSubstitutionReason,
  roulette?: FullCourtRouletteRuntime,
): void {
  runtime.closeStint(globalSeconds, recorder);
  roulette?.onPlayerExited(runtime.side, outIndex, reason === 'foul-out');
  runtime.stintSeconds[inIndex] = 0;
  runtime.slots[slot] = inIndex;
  roulette?.onPlayerEntered(runtime.side, inIndex);
  runtime.beginStint(globalSeconds, recorder);
}

function refreshLineups(runtimes: readonly [RotationRuntime, RotationRuntime]): boolean {
  const [home, away] = runtimes;
  const homeChanged = home.refreshLineup(away.activePlayerIds());
  const awayChanged = away.refreshLineup(home.activePlayerIds());
  return homeChanged || awayChanged;
}

function syncKernel(
  ctx: TripContext,
  runtimes: readonly [RotationRuntime, RotationRuntime],
  recorder: GameRecorder,
  effects: EffectsHook | undefined,
): void {
  const [home, away] = runtimes;
  ctx.teams = [home.lineup.team, away.lineup.team];
  ctx.preps = [home.lineup.prep, away.lineup.prep];
  ctx.teamUnits = [home.lineup.units, away.lineup.units];
  setRecorderActiveUnits(recorder, 0, home.activeRecorderIndices());
  setRecorderActiveUnits(recorder, 1, away.activeRecorderIndices());
  effects?.setActiveUnits(home.lineup.units, away.lineup.units);
}

function teamResult(
  runtime: RotationRuntime,
  recorder: GameRecorder,
  roulette?: FullCourtRouletteRuntime,
): FullCourtTeamResult {
  const box = recorder.seasonTeamBox(runtime.side, runtime.teamId);
  const started = new Set(runtime.plan.startingSlots);
  const liveSeconds = Math.round(runtime.teamSecondsPlayed);
  const stints = runtime.stints.map((stint, index) => {
    const startSeconds = Math.round(stint.startSeconds);
    const endSeconds = Math.round(runtime.stints[index + 1]?.startSeconds ?? liveSeconds);
    return { ...stint, startSeconds, seconds: endSeconds - startSeconds };
  });
  const stintTotalsByPlayer = new Map<string, { seconds: number; count: number }>();
  for (const stint of stints) {
    for (const playerId of stint.playerIds) {
      const totals = stintTotalsByPlayer.get(playerId) ?? { seconds: 0, count: 0 };
      totals.seconds += stint.seconds;
      totals.count += 1;
      stintTotalsByPlayer.set(playerId, totals);
    }
  }
  const players: FullCourtPlayerLine[] = runtime.plan.roster.map((player, index) => {
    const line = recorder.seasonPlayerBox(runtime.side, index);
    const energy = runtime.energy[index] ?? 0;
    const stintTotals = stintTotalsByPlayer.get(player.playerId);
    const played = stintTotals?.seconds ?? 0;
    const charged =
      roulette === undefined ? line.fouls : roulette.chargedFoulsFor(runtime.side, index);
    return {
      playerId: player.playerId,
      displayName: player.displayName,
      startedGame: started.has(index),
      available: runtime.plan.available[index] === true,
      plannedSeconds: runtime.plan.targetSeconds[index] ?? 0,
      seconds: played,
      minutes: Math.round((played / 60) * 10) / 10,
      points: line.points,
      fieldGoals: line.fieldGoals,
      threes: line.threes,
      freeThrows: line.freeThrows,
      rebounds: line.rebounds,
      assists: line.assists,
      steals: line.steals,
      blocks: line.blocks,
      turnovers: line.turnovers,
      fouls: line.fouls,
      ...(line.deepFours === undefined ? {} : { deepFours: line.deepFours }),
      diagnostics: line.diagnostics,
      energyRemaining: Math.round(energy * 1000) / 1000,
      fatigueLevel: fatigueLevelOf(energy),
      foulsOut: (runtime.fouls[index] ?? 0) >= FULL_COURT_FOUL_LIMIT,
      emergencyContinuation: runtime.emergency[index] === true,
      stints: stintTotals?.count ?? 0,
      ...(charged !== line.fouls ? { chargedFouls: charged } : {}),
    };
  });
  if (roulette !== undefined) {
    for (const clone of roulette.spawnedClones(runtime.side)) {
      const line = recorder.seasonPlayerBox(runtime.side, clone.recorderIndex);
      const stintTotals = stintTotalsByPlayer.get(clone.playerId);
      const played = stintTotals?.seconds ?? 0;
      players.push({
        playerId: clone.playerId as SimulationPlayer['playerId'],
        displayName: clone.displayName,
        startedGame: clone.startedGame,
        available: true,
        plannedSeconds: 0,
        seconds: played,
        minutes: Math.round((played / 60) * 10) / 10,
        points: line.points,
        fieldGoals: line.fieldGoals,
        threes: line.threes,
        freeThrows: line.freeThrows,
        rebounds: line.rebounds,
        assists: line.assists,
        steals: line.steals,
        blocks: line.blocks,
        turnovers: line.turnovers,
        fouls: line.fouls,
        ...(line.deepFours === undefined ? {} : { deepFours: line.deepFours }),
        diagnostics: line.diagnostics,
        energyRemaining: Math.round(clone.energy * 1000) / 1000,
        fatigueLevel: fatigueLevelOf(clone.energy),
        foulsOut: clone.foulsOut,
        emergencyContinuation: false,
        stints: stintTotals?.count ?? 0,
        kind: 'clone',
        ownerPlayerId: clone.ownerPlayerId,
      });
    }
  }
  const meta = roulette?.teamMetadata(runtime.side);
  return {
    teamId: runtime.teamId,
    displayName: runtime.displayName,
    box,
    players,
    liveSeconds,
    teamSeconds: players.reduce((sum, player) => sum + player.seconds, 0),
    plannedTeamSeconds: runtime.plan.targetSeconds.reduce((sum, value) => sum + value, 0),
    stints,
    technicalFouls: runtime.technicalFouls,
    disqualifications: players.filter((player) => player.foulsOut).length,
    notes: runtime.plan.notes,
    units: runtime.plan.units,
    ...(meta !== undefined && meta.teamBonusPoints !== 0
      ? { teamBonusPoints: meta.teamBonusPoints }
      : {}),
    ...(meta !== undefined && meta.pointAdjustments !== 0
      ? { pointAdjustments: meta.pointAdjustments }
      : {}),
    ...(meta !== undefined && meta.mutationRollups.length > 0
      ? { mutationRollups: meta.mutationRollups }
      : {}),
  };
}

export function fullCourtTeamSeconds(overtimePeriods: number): number {
  return FULL_COURT_REGULATION_SECONDS + overtimePeriods * 5 * 60;
}

export function fullCourtPlayerSecondCeiling(overtimePeriods: number): number {
  return FULL_COURT_MAX_PLAYER_SECONDS + overtimePeriods * FULL_COURT_OVERTIME_PLAYER_SECONDS;
}

/**
 * Structural and accounting checks. Mirrors the shared invariants where they
 * apply and adds rotation guarantees: exact team seconds, legal playing-time
 * ceilings, and five-player lineup stints.
 */
export function checkFullCourtGameResult(result: FullCourtGameResult): string[] {
  const failures: string[] = [];
  const expectedLiveSeconds = fullCourtTeamSeconds(result.overtimePeriods);
  const playerCeiling = fullCourtPlayerSecondCeiling(result.overtimePeriods);

  for (const side of ['home', 'away'] as const) {
    const team = result[side];
    const box = team.box;
    const hasClones = team.players.some((player) => player.kind === 'clone');
    const cloneSeconds = team.players
      .filter((player) => player.kind === 'clone')
      .reduce((sum, player) => sum + player.seconds, 0);
    const expectedTeamSeconds = expectedLiveSeconds * FULL_COURT_MIN_ROSTER + cloneSeconds;
    const ids = new Set<string>(team.players.map((player) => player.playerId));
    if (ids.size !== team.players.length) failures.push(`${side}: duplicate player ids`);
    if (team.players.length < FULL_COURT_MIN_ROSTER) {
      failures.push(`${side}: fewer than five players in the box score`);
    }
    if (team.liveSeconds !== expectedLiveSeconds) {
      failures.push(
        `${side}: live seconds (${String(team.liveSeconds)}) != ${String(expectedLiveSeconds)}`,
      );
    }
    if (team.teamSeconds !== expectedTeamSeconds) {
      failures.push(
        `${side}: team seconds (${String(team.teamSeconds)}) != ${String(expectedTeamSeconds)}`,
      );
    }
    if (Math.abs(team.plannedTeamSeconds - FULL_COURT_REGULATION_TEAM_SECONDS) > 1) {
      failures.push(
        `${side}: planned team seconds (${String(team.plannedTeamSeconds)}) != ${String(FULL_COURT_REGULATION_TEAM_SECONDS)}`,
      );
    }
    const plannedLive = team.players.reduce((sum, player) => sum + player.plannedSeconds, 0);
    if (Math.abs(plannedLive - FULL_COURT_REGULATION_TEAM_SECONDS) > 1) {
      failures.push(
        `${side}: summed minute targets (${String(plannedLive)}) != ${String(FULL_COURT_REGULATION_TEAM_SECONDS)}`,
      );
    }
    for (const player of team.players) {
      if (player.seconds > playerCeiling) {
        failures.push(
          `${side}: ${player.playerId} played ${String(player.seconds)}s above ${String(playerCeiling)}s`,
        );
      }
      if (player.seconds < 0) failures.push(`${side}: ${player.playerId} has negative seconds`);
      const effectiveFouls = player.chargedFouls ?? player.fouls;
      if (effectiveFouls > FULL_COURT_FOUL_LIMIT && !player.emergencyContinuation) {
        failures.push(
          `${side}: ${player.playerId} has ${String(effectiveFouls)} fouls without emergency continuation`,
        );
      }
    }
    const teamBonusPoints = team.teamBonusPoints ?? 0;
    const pointAdjustments = team.pointAdjustments ?? 0;
    const playerPoints = team.players.reduce((sum, player) => sum + player.points, 0);
    if (playerPoints + teamBonusPoints !== box.points) {
      failures.push(
        `${side}: player points (${String(playerPoints)}) + bonus (${String(teamBonusPoints)}) != team points (${String(box.points)})`,
      );
    }
    const deepMakes = box.deepFours?.made ?? 0;
    const pointsIdentity =
      (box.fieldGoals.made - box.threes.made - deepMakes) * 2 +
      box.threes.made * 3 +
      deepMakes * 4 +
      box.freeThrows.made;
    if (box.points !== pointsIdentity + pointAdjustments + teamBonusPoints) {
      failures.push(
        `${side}: points ${String(box.points)} != 2*2fg + 3*3fg + 4*4fg + ft + adjustments (${String(pointsIdentity + pointAdjustments + teamBonusPoints)})`,
      );
    }
    if (box.fieldGoals.made > box.fieldGoals.attempted) {
      failures.push(`${side}: field-goal makes exceed attempts`);
    }
    if (box.threes.made > box.threes.attempted) {
      failures.push(`${side}: three-point makes exceed attempts`);
    }
    if (box.freeThrows.made > box.freeThrows.attempted) {
      failures.push(`${side}: free-throw makes exceed attempts`);
    }
    if (box.assists > box.fieldGoals.made) {
      failures.push(`${side}: assists exceed made field goals`);
    }
    if (
      box.rebounds.offensive + box.rebounds.defensive + box.rebounds.team !==
      box.rebounds.total
    ) {
      failures.push(`${side}: rebound buckets do not sum to total`);
    }
    const reconciliations: Array<[string, number, number]> = [
      [
        'field goals made',
        team.players.reduce((sum, player) => sum + player.fieldGoals.made, 0),
        box.fieldGoals.made,
      ],
      [
        'field goals attempted',
        team.players.reduce((sum, player) => sum + player.fieldGoals.attempted, 0),
        box.fieldGoals.attempted,
      ],
      [
        'three makes',
        team.players.reduce((sum, player) => sum + player.threes.made, 0),
        box.threes.made,
      ],
      [
        'three attempts',
        team.players.reduce((sum, player) => sum + player.threes.attempted, 0),
        box.threes.attempted,
      ],
      [
        'free-throw makes',
        team.players.reduce((sum, player) => sum + player.freeThrows.made, 0),
        box.freeThrows.made,
      ],
      [
        'free-throw attempts',
        team.players.reduce((sum, player) => sum + player.freeThrows.attempted, 0),
        box.freeThrows.attempted,
      ],
      ['assists', team.players.reduce((sum, player) => sum + player.assists, 0), box.assists],
      ['steals', team.players.reduce((sum, player) => sum + player.steals, 0), box.steals],
      ['blocks', team.players.reduce((sum, player) => sum + player.blocks, 0), box.blocks],
      ['turnovers', team.players.reduce((sum, player) => sum + player.turnovers, 0), box.turnovers],
      ['fouls', team.players.reduce((sum, player) => sum + player.fouls, 0), box.fouls],
      [
        'offensive rebounds',
        team.players.reduce((sum, player) => sum + player.rebounds.offensive, 0),
        box.rebounds.offensive,
      ],
      [
        'defensive rebounds',
        team.players.reduce((sum, player) => sum + player.rebounds.defensive, 0),
        box.rebounds.defensive,
      ],
    ];
    for (const [label, playerTotal, teamValue] of reconciliations) {
      if (playerTotal !== teamValue) {
        failures.push(
          `${side}: player ${label} (${String(playerTotal)}) != team (${String(teamValue)})`,
        );
      }
    }
    const other = result[side === 'home' ? 'away' : 'home'];
    const misses =
      box.fieldGoals.attempted -
      box.fieldGoals.made +
      box.freeThrows.attempted -
      box.freeThrows.made;
    const claimed = box.rebounds.offensive + other.box.rebounds.defensive + other.box.rebounds.team;
    if (misses !== claimed) {
      failures.push(
        `${side}: misses (${String(misses)}) != own OReb + opponent DREB/team (${String(claimed)})`,
      );
    }
    const stintSecondsByPlayer = new Map<string, number>();
    let stintSeconds = 0;
    for (const stint of team.stints) {
      const validStintSize = hasClones
        ? stint.playerIds.length >= FULL_COURT_MIN_ROSTER &&
          stint.playerIds.length <= FULL_COURT_MIN_ROSTER * 2
        : stint.playerIds.length === FULL_COURT_MIN_ROSTER;
      if (!validStintSize) {
        failures.push(`${side}: stint has ${String(stint.playerIds.length)} players`);
      }
      if (new Set(stint.playerIds).size !== stint.playerIds.length) {
        failures.push(`${side}: stint repeats a player`);
      }
      if (stint.seconds < 0) failures.push(`${side}: stint has negative seconds`);
      if (stint.startSeconds !== stintSeconds)
        failures.push(`${side}: noncontiguous lineup stints`);
      stintSeconds += stint.seconds;
      for (const playerId of stint.playerIds) {
        if (!ids.has(playerId)) failures.push(`${side}: stint includes unknown player ${playerId}`);
        stintSecondsByPlayer.set(
          playerId,
          (stintSecondsByPlayer.get(playerId) ?? 0) + stint.seconds,
        );
      }
    }
    if (stintSeconds !== team.liveSeconds) {
      failures.push(
        `${side}: stint seconds (${String(stintSeconds)}) != live seconds (${String(team.liveSeconds)})`,
      );
    }
    for (const player of team.players) {
      if ((stintSecondsByPlayer.get(player.playerId) ?? 0) !== player.seconds) {
        failures.push(`${side}: ${player.playerId} box score seconds differ from lineup stints`);
      }
    }
    const stintPoints = team.stints.reduce((sum, stint) => sum + stint.points, 0);
    if (stintPoints !== box.points) {
      failures.push(
        `${side}: stint points (${String(stintPoints)}) != team points (${String(box.points)})`,
      );
    }
  }

  const hasHomeClones = result.home.players.some((player) => player.kind === 'clone');
  const hasAwayClones = result.away.players.some((player) => player.kind === 'clone');
  if (!hasHomeClones && !hasAwayClones && result.home.teamSeconds !== result.away.teamSeconds) {
    failures.push('home and away team seconds differ');
  }
  if (result.home.liveSeconds !== result.away.liveSeconds) {
    failures.push('home and away live seconds differ');
  }
  if (result.periodScores.home.length !== 4 + result.overtimePeriods) {
    failures.push(
      `period count (${String(result.periodScores.home.length)}) != 4 + OT (${String(result.overtimePeriods)})`,
    );
  }
  if (result.periodScores.home.length !== result.periodScores.away.length) {
    failures.push('period score lengths differ');
  }
  for (const side of ['home', 'away'] as const) {
    const total = result.periodScores[side].reduce((sum, value) => sum + value, 0);
    if (total !== result[side].box.points) {
      failures.push(
        `${side} period scores (${String(total)}) != ${side} points (${String(result[side].box.points)})`,
      );
    }
  }
  if (result.home.box.points === result.away.box.points) {
    failures.push('tied final score: exactly one winner required');
  }
  return failures;
}

export function fullCourtGameDigest(result: FullCourtGameResult): string {
  return JSON.stringify({
    seed: result.seed,
    winner: result.winner,
    overtimePeriods: result.overtimePeriods,
    totalSeconds: result.totalSeconds,
    periodScores: result.periodScores,
    home: teamDigest(result.home),
    away: teamDigest(result.away),
  });
}

function teamDigest(team: FullCourtTeamResult): unknown {
  return {
    teamId: team.teamId,
    points: team.box.points,
    teamSeconds: team.teamSeconds,
    technicalFouls: team.technicalFouls,
    disqualifications: team.disqualifications,
    players: team.players.map((player) => [
      player.playerId,
      player.seconds,
      player.points,
      `${String(player.fieldGoals.made)}/${String(player.fieldGoals.attempted)}`,
      `${String(player.threes.made)}/${String(player.threes.attempted)}`,
      `${String(player.freeThrows.made)}/${String(player.freeThrows.attempted)}`,
      `${String(player.rebounds.offensive)}+${String(player.rebounds.defensive)}`,
      player.assists,
      player.steals,
      player.blocks,
      player.turnovers,
      player.fouls,
      player.energyRemaining,
    ]),
  };
}
