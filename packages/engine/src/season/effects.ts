import type {
  SeasonEffectsState,
  SeasonGameEffectsTransition,
  SeasonMechanism,
  SeasonMechanismEvidence,
  SeasonPairChemistryState,
  SeasonPlayerLoadState,
  SeasonStaminaInput,
} from '@hoop-rush/data-contracts';
import type { SideIndex } from '../sim/recorder.ts';
import {
  canonicalRosterPairs,
  pairChemistryBasisPoints,
  seasonPairIsCanonical,
  seasonPairKey,
  unitPairs,
} from './chemistry.ts';
import { offCourtRecoveryBp, onCourtFatigueBp, recentLoadAfterGame } from './stamina.ts';

/**
 * M2.4 stamina and chemistry effects (spec/2.0/04, spec/2.0/05,
 * season-stamina-v1 + season-chemistry-v1). The effects hook sits on the
 * possession pipeline exactly like the home-court profile: when absent every
 * adjustment is exactly +0, no additional RNG draw exists, and results stay
 * byte-identical to the M2.3 engine. The zero profile skips every effect
 * code path.
 *
 * Only six bounded probability adjustments exist:
 *
 * | Mechanism               | Adjustment                                   | Cap    |
 * |-------------------------|----------------------------------------------|--------|
 * | shooter-fatigue         | make probability -= 2.5pp x shooter fatigue  | 2.5 pp |
 * | handler-fatigue         | turnover probability += 1.8pp x handler fat. | 1.8 pp |
 * | defensive-unit-fatigue  | opponent make probability += 1.2pp x mean fat| 1.2 pp |
 * | turnover-security       | turnover probability -= 1.0pp x unit chem    | 1.0 pp |
 * | assist-conversion       | assist probability += 3.5pp x unit chem      | 3.5 pp |
 * | help-defense            | make probability -= 0.8pp x defense chem     | 0.8 pp |
 *
 * All adjustments are applied BEFORE the existing probability clamps, and
 * every application is recorded as integer-millionths evidence so recaps and
 * calibration audits read recorded facts instead of narrative.
 *
 * Pure TypeScript: no Svelte, persistence, worker, or network code.
 */

/** Maximum shooter-fatigue make-probability reduction (percentage points). */
export const SEASON_EFFECTS_SHOOTER_FATIGUE_MAX_PP = 2.5;

/** Maximum handler-fatigue turnover-probability increase (pp). */
export const SEASON_EFFECTS_HANDLER_FATIGUE_MAX_PP = 1.8;

/** Maximum defensive-unit-fatigue opponent make-probability increase (pp). */
export const SEASON_EFFECTS_DEFENSE_FATIGUE_MAX_PP = 1.2;

/** Maximum chemistry turnover-security probability reduction (pp). */
export const SEASON_EFFECTS_TURNOVER_SECURITY_MAX_PP = 1.0;

/** Maximum chemistry assist-conversion probability increase (pp). */
export const SEASON_EFFECTS_ASSIST_CONVERSION_MAX_PP = 3.5;

/** Maximum chemistry help-defense make-probability reduction (pp). */
export const SEASON_EFFECTS_HELP_DEFENSE_MAX_PP = 0.8;

/** Basis-point scale (10,000 = 100%). */
const BP_SCALE = 10_000;

/** Integer-millionths scale (1,000,000 = 100%). */
const PP_TO_MILLIONTHS = 10_000;

/** Per-mechanism delta caps in integer millionths. */
export const SEASON_EFFECTS_MECHANISM_CAPS: Record<SeasonMechanism, number> = {
  'shooter-fatigue': Math.round(SEASON_EFFECTS_SHOOTER_FATIGUE_MAX_PP * PP_TO_MILLIONTHS),
  'handler-fatigue': Math.round(SEASON_EFFECTS_HANDLER_FATIGUE_MAX_PP * PP_TO_MILLIONTHS),
  'defensive-unit-fatigue': Math.round(SEASON_EFFECTS_DEFENSE_FATIGUE_MAX_PP * PP_TO_MILLIONTHS),
  'turnover-security': Math.round(SEASON_EFFECTS_TURNOVER_SECURITY_MAX_PP * PP_TO_MILLIONTHS),
  'assist-conversion': Math.round(SEASON_EFFECTS_ASSIST_CONVERSION_MAX_PP * PP_TO_MILLIONTHS),
  'help-defense': Math.round(SEASON_EFFECTS_HELP_DEFENSE_MAX_PP * PP_TO_MILLIONTHS),
};

/** Percentage-point x fraction -> integer millionths (signed). */
function ppDeltaMillionths(pp: number, fraction: number): number {
  return Math.round(pp * PP_TO_MILLIONTHS * fraction);
}

/** Per-trip facts the possession pipeline reports at trip completion. */
export interface SeasonEffectsTripFacts {
  /** Active five of each side during the trip (version ids). */
  homeUnit: readonly string[];
  awayUnit: readonly string[];
  /** The trip's ball handler (offense initiator). */
  handler: string;
  /** The shot taker when a shot resolved this trip. */
  shooter?: string;
  /** The primary defender picked when a shot resolved this trip. */
  defender?: string;
  /** Rebound opportunities recorded per side during the trip. */
  reboundContestCounts: readonly [number, number];
}

/**
 * The possession-pipeline-facing effects hook. Every adjustment query
 * returns integer millionths (may be negative) and records its mechanism
 * evidence internally; every recording method consumes no RNG. The hook is
 * absent for Classic and neutral Season games, so all queries must behave as
 * exact +0 and no method may ever be called when absent.
 */
export interface SeasonEffectsHook {
  /** Composite make-probability adjustment (shooter + defense + help). */
  makeAdjustment(facts: {
    shooterVersion: string;
    offenseSide: SideIndex;
    defenseSide: SideIndex;
  }): number;
  /** Composite turnover-probability adjustment (handler + security). */
  turnoverAdjustment(facts: { handlerVersion: string; offenseSide: SideIndex }): number;
  /** Assist-conversion adjustment for a credited assist opportunity. */
  assistAdjustment(facts: { offenseSide: SideIndex }): number;
  /** Active-unit facts (called by the controller on every unit change). */
  setActiveUnits(homeUnit: readonly string[], awayUnit: readonly string[]): void;
  /** Stint interval bookkeeping (on-court accumulation / off-court recovery). */
  recordStintSeconds(side: SideIndex, seconds: number, activeVersions: readonly string[]): void;
  /** Completed-trip bookkeeping: role bonuses and pair increments. */
  recordTrip(facts: SeasonEffectsTripFacts): void;
  /** Halftime recovery; must be called exactly once per game. */
  halftime(): void;
}

/** The authoritative per-game buffer and its postgame accessor. */
export interface SeasonEffectsBuffer {
  hook: SeasonEffectsHook;
  /**
   * Produces the game's delta facts: postgame load states for all 300
   * players (recent load updated from the regulation-minute share), the
   * canonical pair increments, and the recorded mechanism evidence. Called
   * exactly once after the last stint of the game.
   */
  finishGame(
    homeRegulationSeconds: ReadonlyMap<string, number>,
    awayRegulationSeconds: ReadonlyMap<string, number>,
  ): {
    postgamePlayerStates: SeasonPlayerLoadState[];
    pairIncrements: Array<{ a: string; b: string; sharedPossessions: number }>;
    evidence: SeasonMechanismEvidence[];
  };
}

interface GamePlayerState {
  fatigue: number;
  recentLoad: number;
  lastRound: number;
  stintSeconds: number;
}

interface EvidenceRow {
  mechanism: SeasonMechanism;
  side: 'home' | 'away';
  opportunities: number;
  shooter: number;
  handler: number;
  defenseMean: number;
  unitChemistry: number;
  deltaTotals: number;
  deltaMin: number;
  deltaMax: number;
}

class EffectsBufferImpl implements SeasonEffectsBuffer {
  private readonly pregame: ReadonlyMap<string, SeasonPlayerLoadState>;
  private readonly stamina: ReadonlyMap<string, number>;
  private readonly game: Map<string, GamePlayerState>;
  private readonly homeRoster: Set<string>;
  private readonly awayRoster: Set<string>;
  private readonly homePairs: Map<string, number>;
  private readonly awayPairs: Map<string, number>;
  private readonly increments: Map<string, number> = new Map();
  private readonly evidence = new Map<string, EvidenceRow>();
  private homeUnit: readonly string[] = [];
  private awayUnit: readonly string[] = [];
  private halftimeApplied = false;
  private finished = false;

  constructor(
    pregame: ReadonlyMap<string, SeasonPlayerLoadState>,
    homeStamina: ReadonlyMap<string, SeasonStaminaInput>,
    awayStamina: ReadonlyMap<string, SeasonStaminaInput>,
    pairStates: readonly SeasonPairChemistryState[],
  ) {
    this.pregame = pregame;
    this.stamina = new Map(
      [...homeStamina.values(), ...awayStamina.values()].map((input) => [
        input.playerVersionId,
        input.rating,
      ]),
    );
    this.homeRoster = new Set(homeStamina.keys());
    this.awayRoster = new Set(awayStamina.keys());
    this.game = new Map(
      [...pregame.values()].map((state) => [
        state.playerVersionId,
        {
          fatigue: state.fatigueBasisPoints,
          recentLoad: state.recentLoadBasisPoints,
          lastRound: state.lastCompletedRound,
          stintSeconds: 0,
        },
      ]),
    );
    const pairsOf = (roster: Set<string>): Map<string, number> => {
      const map = new Map<string, number>();
      for (const [a, b] of canonicalRosterPairs([...roster])) {
        const pair = pairStates.find((p) => p.a === a && p.b === b);
        map.set(seasonPairKey(a, b), pair?.sharedPossessions ?? 0);
      }
      return map;
    };
    this.homePairs = pairsOf(this.homeRoster);
    this.awayPairs = pairsOf(this.awayRoster);
  }

  readonly hook: SeasonEffectsHook = {
    makeAdjustment: (facts) => {
      const { shooterVersion, offenseSide, defenseSide } = facts;
      const shooterFatigue = this.fatigueOf(shooterVersion);
      const shooterFrac = shooterFatigue / BP_SCALE;
      const shooterDelta = ppDeltaMillionths(-SEASON_EFFECTS_SHOOTER_FATIGUE_MAX_PP, shooterFrac);
      this.record(
        'shooter-fatigue',
        offenseSide === 0 ? 'home' : 'away',
        shooterDelta,
        shooterFrac,
        'shooter',
      );

      const defenseMean = this.unitMeanFatigue(defenseSide);
      const defenseFrac = defenseMean / BP_SCALE;
      const defenseDelta = ppDeltaMillionths(SEASON_EFFECTS_DEFENSE_FATIGUE_MAX_PP, defenseFrac);
      this.record(
        'defensive-unit-fatigue',
        defenseSide === 0 ? 'home' : 'away',
        defenseDelta,
        defenseFrac,
        'defenseMean',
      );

      const chemFrac = this.unitChemistry(defenseSide) / BP_SCALE;
      const helpDelta = ppDeltaMillionths(-SEASON_EFFECTS_HELP_DEFENSE_MAX_PP, chemFrac);
      this.record(
        'help-defense',
        defenseSide === 0 ? 'home' : 'away',
        helpDelta,
        chemFrac,
        'unitChemistry',
      );

      return shooterDelta + defenseDelta + helpDelta;
    },
    turnoverAdjustment: (facts) => {
      const { handlerVersion, offenseSide } = facts;
      const handlerFrac = this.fatigueOf(handlerVersion) / BP_SCALE;
      const handlerDelta = ppDeltaMillionths(SEASON_EFFECTS_HANDLER_FATIGUE_MAX_PP, handlerFrac);
      this.record(
        'handler-fatigue',
        offenseSide === 0 ? 'home' : 'away',
        handlerDelta,
        handlerFrac,
        'handler',
      );

      const chemFrac = this.unitChemistry(offenseSide) / BP_SCALE;
      const securityDelta = ppDeltaMillionths(-SEASON_EFFECTS_TURNOVER_SECURITY_MAX_PP, chemFrac);
      this.record(
        'turnover-security',
        offenseSide === 0 ? 'home' : 'away',
        securityDelta,
        chemFrac,
        'unitChemistry',
      );

      return handlerDelta + securityDelta;
    },
    assistAdjustment: (facts) => {
      const chemFrac = this.unitChemistry(facts.offenseSide) / BP_SCALE;
      const delta = ppDeltaMillionths(SEASON_EFFECTS_ASSIST_CONVERSION_MAX_PP, chemFrac);
      this.record(
        'assist-conversion',
        facts.offenseSide === 0 ? 'home' : 'away',
        delta,
        chemFrac,
        'unitChemistry',
      );
      return delta;
    },
    setActiveUnits: (homeUnit, awayUnit) => {
      this.homeUnit = [...homeUnit];
      this.awayUnit = [...awayUnit];
    },
    recordStintSeconds: (side, seconds, activeVersions) => {
      const roster = side === 0 ? this.homeRoster : this.awayRoster;
      const active = new Set(activeVersions);
      for (const version of roster) {
        const state = this.game.get(version);
        if (state === undefined) continue;
        const rating = this.stamina.get(version);
        if (rating === undefined) continue;
        if (active.has(version)) {
          state.stintSeconds = Math.min(720, state.stintSeconds + seconds);
          state.fatigue += onCourtFatigueBp(seconds, rating, state.stintSeconds, state.recentLoad);
        } else {
          state.stintSeconds = 0;
          state.fatigue = Math.max(0, state.fatigue - offCourtRecoveryBp(seconds, rating));
        }
        state.fatigue = Math.min(BP_SCALE, state.fatigue);
      }
    },
    recordTrip: (facts) => {
      const { homeUnit, awayUnit, handler, shooter, defender, reboundContestCounts } = facts;
      this.homeUnit = [...homeUnit];
      this.awayUnit = [...awayUnit];
      this.applyRoleBonuses(0, homeUnit, handler, shooter, defender, reboundContestCounts[0]);
      this.applyRoleBonuses(1, awayUnit, handler, shooter, defender, reboundContestCounts[1]);
      for (const [a, b] of unitPairs(homeUnit)) {
        const key = seasonPairKey(a, b);
        this.increments.set(key, (this.increments.get(key) ?? 0) + 1);
        this.homePairs.set(key, (this.homePairs.get(key) ?? 0) + 1);
      }
      for (const [a, b] of unitPairs(awayUnit)) {
        const key = seasonPairKey(a, b);
        this.increments.set(key, (this.increments.get(key) ?? 0) + 1);
        this.awayPairs.set(key, (this.awayPairs.get(key) ?? 0) + 1);
      }
    },
    halftime: () => {
      if (this.halftimeApplied) {
        throw new Error('season effects: halftime recovery applied more than once');
      }
      this.halftimeApplied = true;
      for (const version of [...this.homeRoster, ...this.awayRoster]) {
        const state = this.game.get(version);
        const rating = this.stamina.get(version);
        if (state === undefined || rating === undefined) continue;
        state.fatigue = Math.max(0, state.fatigue - (500 + 3 * rating));
      }
    },
  };

  private applyRoleBonuses(
    side: SideIndex,
    unit: readonly string[],
    handler: string,
    shooter: string | undefined,
    defender: string | undefined,
    reboundContests: number,
  ): void {
    for (const version of unit) {
      const state = this.game.get(version);
      if (state === undefined) continue;
      let bonus = 0;
      if (version === handler || version === shooter) bonus += 12;
      if (version === defender) bonus += 8;
      bonus += reboundContests * 2;
      if (bonus > 0) {
        state.fatigue = Math.min(BP_SCALE, state.fatigue + bonus);
      }
    }
  }

  private fatigueOf(version: string): number {
    const state = this.game.get(version);
    if (state === undefined) {
      throw new Error(`season effects: unknown version ${version}`);
    }
    return state.fatigue;
  }

  private unitMeanFatigue(side: SideIndex): number {
    const unit = side === 0 ? this.homeUnit : this.awayUnit;
    if (unit.length === 0) return 0;
    let sum = 0;
    for (const version of unit) {
      sum += this.fatigueOf(version);
    }
    return sum / unit.length;
  }

  private unitChemistry(side: SideIndex): number {
    const unit = side === 0 ? this.homeUnit : this.awayUnit;
    if (unit.length === 0) return 0;
    const pairs = side === 0 ? this.homePairs : this.awayPairs;
    let sum = 0;
    for (const [a, b] of unitPairs(unit)) {
      const shared = pairs.get(seasonPairKey(a, b)) ?? 0;
      sum += pairChemistryBasisPoints(shared);
    }
    return Math.round(sum / 10);
  }

  private record(
    mechanism: SeasonMechanism,
    side: 'home' | 'away',
    delta: number,
    inputFraction: number,
    inputField: 'shooter' | 'handler' | 'defenseMean' | 'unitChemistry',
  ): void {
    const key = `${mechanism}\u0000${side}`;
    let row = this.evidence.get(key);
    if (row === undefined) {
      row = {
        mechanism,
        side,
        opportunities: 0,
        shooter: 0,
        handler: 0,
        defenseMean: 0,
        unitChemistry: 0,
        deltaTotals: 0,
        deltaMin: delta,
        deltaMax: delta,
      };
      this.evidence.set(key, row);
    }
    row.opportunities += 1;
    row[inputField] += Math.round(inputFraction * 1_000_000);
    row.deltaTotals += delta;
    row.deltaMin = Math.min(row.deltaMin, delta);
    row.deltaMax = Math.max(row.deltaMax, delta);
  }

  finishGame(
    homeRegulationSeconds: ReadonlyMap<string, number>,
    awayRegulationSeconds: ReadonlyMap<string, number>,
  ): {
    postgamePlayerStates: SeasonPlayerLoadState[];
    pairIncrements: Array<{ a: string; b: string; sharedPossessions: number }>;
    evidence: SeasonMechanismEvidence[];
  } {
    if (this.finished) {
      throw new Error('season effects: buffer finished more than once');
    }
    this.finished = true;
    const postgamePlayerStates: SeasonPlayerLoadState[] = [];
    for (const [version, state] of this.game) {
      const regulationSeconds = this.homeRoster.has(version)
        ? (homeRegulationSeconds.get(version) ?? 0)
        : this.awayRoster.has(version)
          ? (awayRegulationSeconds.get(version) ?? 0)
          : 0;
      postgamePlayerStates.push({
        playerVersionId: version,
        fatigueBasisPoints: Math.min(BP_SCALE, Math.max(0, Math.round(state.fatigue))),
        recentLoadBasisPoints: recentLoadAfterGame(state.recentLoad, regulationSeconds),
        lastCompletedRound: state.lastRound,
      });
    }
    const pairIncrements: Array<{ a: string; b: string; sharedPossessions: number }> = [];
    for (const [key, added] of this.increments) {
      const sep = key.indexOf('\u0000');
      const a = key.slice(0, sep);
      const b = key.slice(sep + 1);
      if (added > 0) {
        pairIncrements.push({ a, b, sharedPossessions: added });
      }
    }
    pairIncrements.sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : 1));
    const evidence = [...this.evidence.values()]
      .filter((row) => row.opportunities > 0)
      .map((row) => ({
        mechanism: row.mechanism,
        side: row.side,
        opportunities: row.opportunities,
        inputTotals: {
          shooter: row.shooter,
          handler: row.handler,
          defenseMean: row.defenseMean,
          unitChemistry: row.unitChemistry,
        },
        deltaTotals: row.deltaTotals,
        deltaMin: row.deltaMin,
        deltaMax: row.deltaMax,
      }))
      .sort((x, y) =>
        x.mechanism < y.mechanism ? -1 : x.mechanism > y.mechanism ? 1 : x.side < y.side ? -1 : 1,
      );
    return { postgamePlayerStates, pairIncrements, evidence };
  }
}

/**
 * Builds the authoritative per-game effects buffer. `pregame` is the carried
 * league effects state (300 players, 1,350 pairs); `homeStamina`/`awayStamina`
 * cover the game's twenty players. Every adjustment of a zero state is
 * exactly 0 and the hook consumes no RNG.
 */
export function createSeasonEffectsBuffer(
  pregame: SeasonEffectsState,
  homeStamina: ReadonlyMap<string, SeasonStaminaInput>,
  awayStamina: ReadonlyMap<string, SeasonStaminaInput>,
): SeasonEffectsBuffer {
  const pregameByVersion = new Map(
    pregame.playerStates.map((player) => [player.playerVersionId, player]),
  );
  return new EffectsBufferImpl(pregameByVersion, homeStamina, awayStamina, pregame.pairStates);
}

/**
 * The initial league effects state: exactly 300 zero load states and 1,350
 * canonical zero pairs. `playerStaminaInputs` must be exactly 300 entries
 * grouped as 30 consecutive ten-player rosters (draft order); each roster's
 * 45 canonical pairs are created from its ten versions.
 */
export function createSeasonEffectsState(
  playerStaminaInputs: readonly SeasonStaminaInput[],
): SeasonEffectsState {
  if (playerStaminaInputs.length !== 300) {
    throw new Error(
      `season effects: expected 300 stamina inputs, got ${String(playerStaminaInputs.length)}`,
    );
  }
  const seen = new Set<string>();
  for (const input of playerStaminaInputs) {
    if (seen.has(input.playerVersionId)) {
      throw new Error(`season effects: duplicate stamina input ${input.playerVersionId}`);
    }
    seen.add(input.playerVersionId);
  }
  const playerStates: SeasonPlayerLoadState[] = playerStaminaInputs.map((input) => ({
    playerVersionId: input.playerVersionId,
    fatigueBasisPoints: 0,
    recentLoadBasisPoints: 0,
    lastCompletedRound: 0,
  }));
  const pairStates: SeasonPairChemistryState[] = [];
  for (let i = 0; i < 30; i += 1) {
    const roster = playerStaminaInputs
      .slice(i * 10, i * 10 + 10)
      .map((input) => input.playerVersionId);
    for (const [a, b] of canonicalRosterPairs(roster)) {
      if (!seasonPairIsCanonical(a, b)) {
        throw new Error(`season effects: non-canonical pair ${a}-${b}`);
      }
      pairStates.push({ a, b, sharedPossessions: 0 });
    }
  }
  pairStates.sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : 1));
  return { schemaVersion: 1, playerStates, pairStates };
}

/**
 * Folds one game's transition into the authoritative next effects state.
 * Validates identity (the same 300 players), canonical add-only pair
 * increments, and range rules; the result is the state the block pipeline
 * carries to the next game.
 */
export function applySeasonGameEffectsTransition(
  previous: SeasonEffectsState,
  transition: SeasonGameEffectsTransition,
): SeasonEffectsState {
  const previousPlayers = new Map(
    previous.playerStates.map((player) => [player.playerVersionId, player]),
  );
  if (transition.pregamePlayerStates.length !== 300 || previousPlayers.size !== 300) {
    throw new Error('season effects: transition must carry exactly 300 player states');
  }
  for (const pre of transition.pregamePlayerStates) {
    if (!previousPlayers.has(pre.playerVersionId)) {
      throw new Error(`season effects: pregame version ${pre.playerVersionId} not in the state`);
    }
  }
  const postgamePlayers = new Map(
    transition.postgamePlayerStates.map((player) => [player.playerVersionId, player]),
  );
  if (postgamePlayers.size !== 300) {
    throw new Error('season effects: postgame must carry 300 distinct players');
  }
  for (const version of previousPlayers.keys()) {
    if (!postgamePlayers.has(version)) {
      throw new Error(`season effects: postgame missing ${version}`);
    }
  }
  const pairByKey = new Map(
    previous.pairStates.map((pair) => [seasonPairKey(pair.a, pair.b), pair]),
  );
  const nextPairs = previous.pairStates.map((pair) => ({ ...pair }));
  for (const increment of transition.pairIncrements) {
    if (!seasonPairIsCanonical(increment.a, increment.b)) {
      throw new Error(`season effects: non-canonical pair increment ${increment.a}-${increment.b}`);
    }
    const pair = pairByKey.get(seasonPairKey(increment.a, increment.b));
    if (pair === undefined) {
      throw new Error(
        `season effects: pair increment on untracked pair ${increment.a}-${increment.b}`,
      );
    }
    const existing = nextPairs.find((p) => p.a === increment.a && p.b === increment.b);
    if (existing !== undefined) {
      existing.sharedPossessions += increment.sharedPossessions;
    }
  }
  return {
    schemaVersion: previous.schemaVersion,
    playerStates: transition.postgamePlayerStates,
    pairStates: nextPairs.sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : 1)),
  };
}
