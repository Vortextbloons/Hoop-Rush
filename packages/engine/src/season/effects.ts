import type {
  SeasonArchivedPairChemistryState,
  SeasonEffectsState,
  SeasonGameEffectsTransition,
  SeasonMechanism,
  SeasonMechanismEvidence,
  SeasonPairChemistryState,
  SeasonPlayerLoadState,
  SeasonRoster,
  SeasonRotation,
  SeasonStaminaInput,
} from '@hoop-rush/data-contracts';
import { franchiseIdSchema } from '@hoop-rush/data-contracts';
import type { SideIndex } from '../sim/recorder.ts';
import {
  canonicalRosterPairs,
  pairChemistryBasisPoints,
  seasonPairIsCanonical,
  seasonPairKey,
  unitPairs,
} from './chemistry.ts';
import { offCourtRecoveryBp, onCourtFatigueBp, recentLoadAfterGame } from './stamina.ts';
import { halftimeRemovalBp } from './stamina.ts';
export const SEASON_EFFECTS_SHOOTER_FATIGUE_MAX_PP = 5;
export const SEASON_EFFECTS_HANDLER_FATIGUE_MAX_PP = 3.5;
export const SEASON_EFFECTS_DEFENSE_FATIGUE_MAX_PP = 2.5;
export const SEASON_EFFECTS_TURNOVER_SECURITY_MAX_PP = 1.0;
export const SEASON_EFFECTS_ASSIST_CONVERSION_MAX_PP = 3.5;
export const SEASON_EFFECTS_HELP_DEFENSE_MAX_PP = 0.8;
const BP_SCALE = 10000;
const PP_TO_MILLIONTHS = 10000;
export const SEASON_EFFECTS_MECHANISM_CAPS: Record<SeasonMechanism, number> = {
  'shooter-fatigue': Math.round(SEASON_EFFECTS_SHOOTER_FATIGUE_MAX_PP * PP_TO_MILLIONTHS),
  'handler-fatigue': Math.round(SEASON_EFFECTS_HANDLER_FATIGUE_MAX_PP * PP_TO_MILLIONTHS),
  'defensive-unit-fatigue': Math.round(SEASON_EFFECTS_DEFENSE_FATIGUE_MAX_PP * PP_TO_MILLIONTHS),
  'turnover-security': Math.round(SEASON_EFFECTS_TURNOVER_SECURITY_MAX_PP * PP_TO_MILLIONTHS),
  'assist-conversion': Math.round(SEASON_EFFECTS_ASSIST_CONVERSION_MAX_PP * PP_TO_MILLIONTHS),
  'help-defense': Math.round(SEASON_EFFECTS_HELP_DEFENSE_MAX_PP * PP_TO_MILLIONTHS),
};
function ppDeltaMillionths(pp: number, fraction: number): number {
  return Math.round(pp * PP_TO_MILLIONTHS * fraction);
}
function pairKeysOf(unit: readonly string[]): Array<{
  a: string;
  b: string;
  key: string;
}> {
  const out: Array<{
    a: string;
    b: string;
    key: string;
  }> = [];
  for (const [a, b] of unitPairs(unit)) out.push({ a, b, key: seasonPairKey(a, b) });
  return out;
}
export interface SeasonEffectsTripFacts {
  homeUnit: readonly string[];
  awayUnit: readonly string[];
  handler: string;
  shooter?: string;
  defender?: string;
  reboundContestCounts: readonly [number, number];
}
export interface SeasonEffectsHook {
  makeAdjustment(facts: {
    shooterVersion: string;
    offenseSide: SideIndex;
    defenseSide: SideIndex;
  }): number;
  turnoverAdjustment(facts: { handlerVersion: string; offenseSide: SideIndex }): number;
  assistAdjustment(facts: { offenseSide: SideIndex }): number;
  setActiveUnits(homeUnit: readonly string[], awayUnit: readonly string[]): void;
  recordStintSeconds(side: SideIndex, seconds: number, activeVersions: readonly string[]): void;
  recordTrip(facts: SeasonEffectsTripFacts): void;
  halftime(): void;
}
export interface SeasonEffectsBuffer {
  hook: SeasonEffectsHook;
  finishGame(
    homeRegulationSeconds: ReadonlyMap<string, number>,
    awayRegulationSeconds: ReadonlyMap<string, number>,
  ): {
    postgamePlayerStates: SeasonPlayerLoadState[];
    pairIncrements: Array<{
      a: string;
      b: string;
      sharedPossessions: number;
    }>;
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
  private homePairKeys: Array<{
    a: string;
    b: string;
    key: string;
  }> = [];
  private awayPairKeys: Array<{
    a: string;
    b: string;
    key: string;
  }> = [];
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
      this.syncUnit(0, homeUnit);
      this.syncUnit(1, awayUnit);
    },
    recordStintSeconds: (side, seconds, activeVersions) => {
      const roster = side === 0 ? this.homeRoster : this.awayRoster;
      for (const version of roster) {
        const state = this.game.get(version);
        if (state === undefined) continue;
        const rating = this.stamina.get(version);
        if (rating === undefined) continue;
        let onCourt = false;
        for (let i = 0; i < activeVersions.length; i += 1) {
          if (activeVersions[i] === version) {
            onCourt = true;
            break;
          }
        }
        if (onCourt) {
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
      this.syncUnit(0, homeUnit);
      this.syncUnit(1, awayUnit);
      this.applyRoleBonuses(0, homeUnit, handler, shooter, defender, reboundContestCounts[0]);
      this.applyRoleBonuses(1, awayUnit, handler, shooter, defender, reboundContestCounts[1]);
      for (const entry of this.homePairKeys) {
        this.increments.set(entry.key, (this.increments.get(entry.key) ?? 0) + 1);
        this.homePairs.set(entry.key, (this.homePairs.get(entry.key) ?? 0) + 1);
      }
      for (const entry of this.awayPairKeys) {
        this.increments.set(entry.key, (this.increments.get(entry.key) ?? 0) + 1);
        this.awayPairs.set(entry.key, (this.awayPairs.get(entry.key) ?? 0) + 1);
      }
    },
    halftime: () => {
      if (this.halftimeApplied) {
        throw new Error('season effects: halftime recovery applied more than once');
      }
      this.halftimeApplied = true;
      for (const roster of [this.homeRoster, this.awayRoster]) {
        for (const version of roster) {
          const state = this.game.get(version);
          const rating = this.stamina.get(version);
          if (state === undefined || rating === undefined) continue;
          state.fatigue = Math.max(0, state.fatigue - halftimeRemovalBp(rating));
        }
      }
    },
  };
  private syncUnit(side: SideIndex, unit: readonly string[]): void {
    const current = side === 0 ? this.homeUnit : this.awayUnit;
    if (current.length === unit.length) {
      let same = true;
      for (let i = 0; i < unit.length; i += 1) {
        if (current[i] !== unit[i]) {
          same = false;
          break;
        }
      }
      if (same) return;
    }
    const copy = [...unit];
    if (side === 0) {
      this.homeUnit = copy;
      this.homePairKeys = pairKeysOf(unit);
    } else {
      this.awayUnit = copy;
      this.awayPairKeys = pairKeysOf(unit);
    }
  }
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
    const pairKeys = side === 0 ? this.homePairKeys : this.awayPairKeys;
    if (pairKeys.length === 0) return 0;
    const pairs = side === 0 ? this.homePairs : this.awayPairs;
    let sum = 0;
    for (const entry of pairKeys) {
      sum += pairChemistryBasisPoints(pairs.get(entry.key) ?? 0);
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
    row[inputField] += Math.round(inputFraction * 1000000);
    row.deltaTotals += delta;
    row.deltaMin = Math.min(row.deltaMin, delta);
    row.deltaMax = Math.max(row.deltaMax, delta);
  }
  finishGame(
    homeRegulationSeconds: ReadonlyMap<string, number>,
    awayRegulationSeconds: ReadonlyMap<string, number>,
  ): {
    postgamePlayerStates: SeasonPlayerLoadState[];
    pairIncrements: Array<{
      a: string;
      b: string;
      sharedPossessions: number;
    }>;
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
    const pairIncrements: Array<{
      a: string;
      b: string;
      sharedPossessions: number;
    }> = [];
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
  return {
    schemaVersion: 2,
    playerStates,
    inactivePlayerStates: [],
    pairStates,
    archivedPairs: [],
  };
}
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
    inactivePlayerStates: previous.inactivePlayerStates,
    pairStates: nextPairs.sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : 1)),
    archivedPairs: previous.archivedPairs,
  };
}
export interface SeasonEffectsReconcileInput {
  previous: SeasonEffectsState;
  rosters: readonly SeasonRoster[];
  rotations: readonly SeasonRotation[];
}
export function reconcileSeasonEffects(input: SeasonEffectsReconcileInput): SeasonEffectsState {
  const { previous, rosters, rotations } = input;
  if (rosters.length !== 30 || rotations.length !== 30) {
    throw new Error('season effects: reconciliation requires 30 rosters and 30 rotations');
  }
  const rosterByFranchise = new Map(rosters.map((roster) => [roster.franchiseId, roster]));
  const rotationIdsByFranchise = new Map<string, string[]>();
  const ownerOf = new Map<string, string>();
  for (const roster of rosters) {
    for (const player of roster.players) {
      if (ownerOf.has(player.playerVersionId)) {
        throw new Error(
          `season effects: ${player.playerVersionId} appears on two rosters during reconciliation`,
        );
      }
      ownerOf.set(player.playerVersionId, roster.franchiseId);
    }
  }
  for (const rotation of rotations) {
    const roster = rosterByFranchise.get(rotation.franchiseId);
    if (roster === undefined) {
      throw new Error(`season effects: rotation for unknown franchise ${rotation.franchiseId}`);
    }
    const rosterIds = new Set(roster.players.map((player) => player.playerVersionId));
    const ids = [...rotation.starters, ...rotation.benchOrder];
    if (ids.length !== 10) {
      throw new Error(
        `season effects: rotation for ${rotation.franchiseId} must contain exactly ten players`,
      );
    }
    for (const id of ids) {
      if (!rosterIds.has(id)) {
        throw new Error(
          `season effects: rotation member ${id} is not on roster ${rotation.franchiseId}`,
        );
      }
    }
    rotationIdsByFranchise.set(rotation.franchiseId, ids);
  }
  const activeIds = new Set<string>();
  for (const ids of rotationIdsByFranchise.values()) {
    for (const id of ids) activeIds.add(id);
  }
  const previousActive = new Map(
    previous.playerStates.map((player) => [player.playerVersionId, player]),
  );
  const previousInactive = new Map(
    previous.inactivePlayerStates.map((player) => [player.playerVersionId, player]),
  );
  const zeroLoad = (playerVersionId: string): SeasonPlayerLoadState => ({
    playerVersionId,
    fatigueBasisPoints: 0,
    recentLoadBasisPoints: 0,
    lastCompletedRound: 0,
  });
  const playerStates: SeasonPlayerLoadState[] = [];
  for (const ids of rotationIdsByFranchise.values()) {
    for (const id of ids) {
      const prior = previousActive.get(id);
      if (prior !== undefined) {
        playerStates.push({ ...prior });
        continue;
      }
      const frozen = previousInactive.get(id);
      playerStates.push(frozen !== undefined ? { ...frozen } : zeroLoad(id));
    }
  }
  playerStates.sort((x, y) => (x.playerVersionId < y.playerVersionId ? -1 : 1));
  if (playerStates.length !== 300) {
    throw new Error(
      `season effects: reconciliation produced ${String(playerStates.length)} active loads`,
    );
  }
  const inactivePlayerStates: SeasonPlayerLoadState[] = [];
  for (const [id, state] of previousActive) {
    if (!activeIds.has(id)) inactivePlayerStates.push({ ...state });
  }
  for (const [id, state] of previousInactive) {
    if (!activeIds.has(id)) inactivePlayerStates.push({ ...state });
  }
  if (inactivePlayerStates.length > 150) {
    throw new Error(
      `season effects: ${String(inactivePlayerStates.length)} inactive loads exceed 150`,
    );
  }
  const previousPairByKey = new Map(
    previous.pairStates.map((pair) => [seasonPairKey(pair.a, pair.b), pair]),
  );
  const archivedByFranchise = new Map<string, Map<string, SeasonArchivedPairChemistryState>>();
  for (const archived of previous.archivedPairs) {
    let franchise = archivedByFranchise.get(archived.franchiseId);
    if (franchise === undefined) {
      franchise = new Map();
      archivedByFranchise.set(archived.franchiseId, franchise);
    }
    franchise.set(seasonPairKey(archived.a, archived.b), archived);
  }
  const pairStates: SeasonPairChemistryState[] = [];
  for (const [franchiseId, ids] of rotationIdsByFranchise) {
    const franchiseArchived = archivedByFranchise.get(franchiseId);
    for (const [a, b] of canonicalRosterPairs(ids)) {
      const key = seasonPairKey(a, b);
      const prior = previousPairByKey.get(key);
      if (prior !== undefined) {
        pairStates.push({ a, b, sharedPossessions: prior.sharedPossessions });
        continue;
      }
      const restored = franchiseArchived?.get(key);
      pairStates.push({
        a,
        b,
        sharedPossessions: restored?.sharedPossessions ?? 0,
      });
    }
  }
  pairStates.sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : 1));
  if (pairStates.length !== 1350) {
    throw new Error(
      `season effects: reconciliation produced ${String(pairStates.length)} active pairs`,
    );
  }
  const archivedPairs: SeasonArchivedPairChemistryState[] = [];
  const archivedKeys = new Set<string>();
  for (const archived of previous.archivedPairs) {
    if (ownerOf.has(archived.a) && ownerOf.has(archived.b)) {
      archivedKeys.add(`${archived.franchiseId}\u0000${seasonPairKey(archived.a, archived.b)}`);
      archivedPairs.push({ ...archived });
    }
  }
  for (const pair of previous.pairStates) {
    const franchiseA = ownerOf.get(pair.a);
    const franchiseB = ownerOf.get(pair.b);
    if (franchiseA === undefined || franchiseA !== franchiseB) continue;
    const aActive = activeIds.has(pair.a);
    const bActive = activeIds.has(pair.b);
    if (aActive && bActive) continue;
    const key = `${franchiseA}\u0000${seasonPairKey(pair.a, pair.b)}`;
    if (archivedKeys.has(key)) continue;
    archivedKeys.add(key);
    archivedPairs.push({
      franchiseId: franchiseIdSchema.parse(franchiseA),
      a: pair.a,
      b: pair.b,
      sharedPossessions: pair.sharedPossessions,
    });
  }
  if (archivedPairs.length > 1350) {
    throw new Error(`season effects: ${String(archivedPairs.length)} archived pairs exceed 1350`);
  }
  return {
    schemaVersion: previous.schemaVersion,
    playerStates,
    inactivePlayerStates,
    pairStates,
    archivedPairs,
  };
}
