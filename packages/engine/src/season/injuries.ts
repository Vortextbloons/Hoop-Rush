import {
  SEASON_ENDING_MISSED_GAMES_SENTINEL,
  SEASON_SEED_NAMESPACES,
  seasonDigestHex,
  seasonNamespaceSeed,
  type SeasonHealthState,
  type SeasonInjuryRecord,
  type SeasonInjurySeverity,
  type SeasonInjuryType,
} from '@hoop-rush/data-contracts';

/**
 * M2.5 seeded injury generation (season-health-v1, engine side). The frozen
 * balanced profile (M2.5 contract §5): base risk 80 bp per exposed
 * player-game, adjusted by the durability penalty `(70 - durability) * 0.5`,
 * `fatigueBasisPoints / 400`, `recentLoadBasisPoints / 500`, minutes
 * exposure `max(0, targetMinutes - 20) * 0.6`, and the +40 bp recurrence
 * bonus, clamped 20..220 bp and rounded half up. Severity 60/28/10/2;
 * recovery minor 1-2, moderate 3-6, major 7-18 missed games; season-ending
 * until the end of the run (`SEASON_ENDING_MISSED_GAMES_SENTINEL`). Minor
 * injuries before halftime have a 35% same-game return with the return
 * clock rolled in periods 3-4. The removal clock is rolled within the
 * player's target minutes mapped from tipoff.
 *
 * Recurrence: after an ACTUAL return, `recurrenceWindowRoundsRemaining`
 * opens at 10 team games and decrements per team game played; during the
 * window the +40 bp recurrence bonus applies. Risky-rehab failure opens the
 * window through the same actual-return mechanism.
 *
 * Named seeds ONLY: every roll derives from
 * `seasonNamespaceSeed(rootSeed, 'injuries', gameId, playerVersionId,
 * eventType)` for the event types `occurrence`, `severity`, `type`, `clock`,
 * `return`, `same-game-return`, and `rehab`. No execution-order RNG exists
 * in this module, so standings, team strength, worker counts, and call
 * order can never change a roll.
 *
 * Pure TypeScript: no Svelte, persistence, worker, or network code.
 */

/** Frozen risk coefficients (M2.5 contract §5, LEAD DECISION, recorded). */
export const SEASON_INJURY_BASE_RISK_BP = 80;
export const SEASON_INJURY_RISK_MIN_BP = 20;
export const SEASON_INJURY_RISK_MAX_BP = 220;
export const SEASON_INJURY_DURABILITY_REFERENCE_RATING = 70;
export const SEASON_INJURY_DURABILITY_PENALTY_PER_RATING = 0.5;
export const SEASON_INJURY_FATIGUE_DIVISOR = 400;
export const SEASON_INJURY_RECENT_LOAD_DIVISOR = 500;
export const SEASON_INJURY_MINUTES_EXPOSURE_BASE = 20;
export const SEASON_INJURY_MINUTES_EXPOSURE_FACTOR = 0.6;
export const SEASON_INJURY_RECURRENCE_BONUS_BP = 40;
export const SEASON_INJURY_RECURRENCE_WINDOW_GAMES = 10;

/** Severity roll thresholds (bp out of 10,000): 60/28/10/2. */
export const SEASON_INJURY_MINOR_BP = 6000;
export const SEASON_INJURY_MODERATE_BP = 8800;
export const SEASON_INJURY_MAJOR_BP = 9800;
/** Same-game return rate (35%) and risky-rehab success rate (60%). */
export const SEASON_INJURY_SAME_GAME_RETURN_BP = 3500;
export const SEASON_INJURY_REHAB_SUCCESS_BP = 6000;

/** Recovery ranges per severity (missed games; season-ending is the sentinel). */
export const SEASON_INJURY_RECOVERY_RANGES: Record<
  'minor' | 'moderate' | 'major',
  readonly [number, number]
> = {
  minor: [1, 2],
  moderate: [3, 6],
  major: [7, 18],
};

/** Body-region classification of an occurrence (uniform draw). */
const INJURY_TYPES: readonly SeasonInjuryType[] = [
  'lower-body',
  'soft-tissue',
  'upper-body',
  'illness',
];

/** Regulation clock span (seconds) and the halftime boundary. */
const REGULATION_SECONDS = 2880;
const HALFTIME_SECOND = 1440;

/** Named injury-namespace seed for one event stream. */
function injurySeed(rootSeed: string, ...keys: string[]): string {
  return seasonNamespaceSeed(rootSeed, SEASON_SEED_NAMESPACES.injuries, ...keys);
}

/** Deterministic 32-bit draw from a 32-hex seed. */
function u32Of(seed: string): number {
  return Number.parseInt(seed.slice(0, 8), 16) >>> 0;
}

/** Deterministic percentage roll against a basis-point threshold (0..10,000). */
function rollBp(seed: string, thresholdBp: number): boolean {
  return u32Of(seed) % 10_000 < thresholdBp;
}

/** Deterministic uniform integer in [min, max] (inclusive). */
function uniformInt(seed: string, min: number, max: number): number {
  return min + (u32Of(seed) % (max - min + 1));
}

/** Maps seconds-from-tipoff to the game clock (period, seconds remaining). */
function clockFromTipoffSeconds(secondsFromTipoff: number): {
  period: number;
  seconds: number;
} {
  const clamped = Math.max(0, Math.min(REGULATION_SECONDS, secondsFromTipoff));
  const period = Math.floor(clamped / 720) + 1;
  const seconds = 720 - (clamped % 720);
  return { period, seconds };
}

export interface SeasonInjuryRollInput {
  rootSeed: string;
  gameId: string;
  playerVersionId: string;
  franchiseId: string;
  /** Catalog durability rating (45..95). */
  durabilityRating: number;
  /** Effects-state fatigue at this game (0..10,000 bp). */
  fatigueBasisPoints: number;
  /** Effects-state recent load at this game (0..10,000 bp). */
  recentLoadBasisPoints: number;
  /** Rotation target minutes (> 0 means exposed). */
  targetMinutes: number;
  /** Recurrence window games remaining (0..10; > 0 adds the bonus). */
  recurrenceWindowRoundsRemaining: number;
}

export interface SeasonInjuryRollResult {
  /** The computed clamped risk in basis points (20..220). */
  riskBasisPoints: number;
  occurred: boolean;
  /** Removal clock (period 1..4, seconds) when occurred; null otherwise. */
  removalClock: { period: number; seconds: number } | null;
  /** Same-game return clock (period 3..4) for returned minors; null otherwise. */
  returnClock: { period: number; seconds: number } | null;
  /** The fully seeded injury record when occurred; null otherwise. */
  injury: SeasonInjuryRecord | null;
}

/**
 * The frozen risk formula (contract §5): base 80 bp plus the durability
 * penalty, fatigue and recent-load shares, minutes exposure, and the
 * recurrence bonus, clamped 20..220 and rounded half up. Risk inputs are
 * ONLY minutes (target), fatigue, workload (recent load), durability
 * (catalog), and prior injury (recurrence window) — never standings, team
 * strength, fame, or narrative state.
 */
export function seasonInjuryRiskBasisPoints(input: {
  durabilityRating: number;
  fatigueBasisPoints: number;
  recentLoadBasisPoints: number;
  targetMinutes: number;
  recurrenceWindowRoundsRemaining: number;
}): number {
  const raw =
    SEASON_INJURY_BASE_RISK_BP +
    (SEASON_INJURY_DURABILITY_REFERENCE_RATING - input.durabilityRating) *
      SEASON_INJURY_DURABILITY_PENALTY_PER_RATING +
    input.fatigueBasisPoints / SEASON_INJURY_FATIGUE_DIVISOR +
    input.recentLoadBasisPoints / SEASON_INJURY_RECENT_LOAD_DIVISOR +
    Math.max(0, input.targetMinutes - SEASON_INJURY_MINUTES_EXPOSURE_BASE) *
      SEASON_INJURY_MINUTES_EXPOSURE_FACTOR +
    (input.recurrenceWindowRoundsRemaining > 0 ? SEASON_INJURY_RECURRENCE_BONUS_BP : 0);
  const clamped = Math.min(SEASON_INJURY_RISK_MAX_BP, Math.max(SEASON_INJURY_RISK_MIN_BP, raw));
  // Round half up (all terms are nonnegative).
  return Math.floor(clamped + 0.5);
}

/** The deterministic record id derived from the occurrence seed path. */
export function seasonInjuryIdOf(seedPath: readonly string[]): string {
  return `inj-${seasonDigestHex(seedPath.join('\u0000'))}`;
}

/** Rolls one player-game exposure against the frozen injury profile. */
export function rollSeasonInjuryForPlayer(input: SeasonInjuryRollInput): SeasonInjuryRollResult {
  const riskBasisPoints = seasonInjuryRiskBasisPoints(input);
  const occurrenceSeed = injurySeed(
    input.rootSeed,
    input.gameId,
    input.playerVersionId,
    'occurrence',
  );
  if (!rollBp(occurrenceSeed, riskBasisPoints)) {
    return {
      riskBasisPoints,
      occurred: false,
      removalClock: null,
      returnClock: null,
      injury: null,
    };
  }

  // Severity 60/28/10/2 (bp thresholds on the 10,000 scale).
  const severitySeed = injurySeed(input.rootSeed, input.gameId, input.playerVersionId, 'severity');
  const severityRoll = u32Of(severitySeed) % 10_000;
  const severity: SeasonInjurySeverity =
    severityRoll < SEASON_INJURY_MINOR_BP
      ? 'minor'
      : severityRoll < SEASON_INJURY_MODERATE_BP
        ? 'moderate'
        : severityRoll < SEASON_INJURY_MAJOR_BP
          ? 'major'
          : 'season-ending';

  const typeSeed = injurySeed(input.rootSeed, input.gameId, input.playerVersionId, 'type');
  const type = INJURY_TYPES[uniformInt(typeSeed, 0, INJURY_TYPES.length - 1)] ?? 'lower-body';

  // Removal clock: rolled within the player's target minutes mapped from
  // tipoff (a player cannot be removed after their planned minutes).
  const clockSeed = injurySeed(input.rootSeed, input.gameId, input.playerVersionId, 'clock');
  const exposureSeconds = uniformInt(
    clockSeed,
    0,
    Math.min(Math.max(0, input.targetMinutes) * 60, REGULATION_SECONDS),
  );
  const removalClock = clockFromTipoffSeconds(exposureSeconds);
  const occurredBeforeHalftime = exposureSeconds < HALFTIME_SECOND;

  // Minor injuries before halftime: 35% same-game return (periods 3-4).
  const sameGameReturnSeed = injurySeed(
    input.rootSeed,
    input.gameId,
    input.playerVersionId,
    'same-game-return',
  );
  const sameGameReturn =
    severity === 'minor' &&
    occurredBeforeHalftime &&
    rollBp(sameGameReturnSeed, SEASON_INJURY_SAME_GAME_RETURN_BP);

  const returnSeed = injurySeed(input.rootSeed, input.gameId, input.playerVersionId, 'return');
  let returnClock: { period: number; seconds: number } | null = null;
  let missedGamesTotal = 0;
  if (sameGameReturn) {
    returnClock = clockFromTipoffSeconds(
      uniformInt(returnSeed, HALFTIME_SECOND, REGULATION_SECONDS),
    );
  } else if (severity === 'season-ending') {
    missedGamesTotal = SEASON_ENDING_MISSED_GAMES_SENTINEL;
  } else {
    const range = SEASON_INJURY_RECOVERY_RANGES[severity];
    missedGamesTotal = uniformInt(returnSeed, range[0], range[1]);
  }

  const seedPath: string[] = [
    SEASON_SEED_NAMESPACES.injuries,
    input.gameId,
    input.playerVersionId,
    'occurrence',
  ];
  const injury: SeasonInjuryRecord = {
    injuryId: seasonInjuryIdOf(seedPath),
    playerVersionId: input.playerVersionId,
    franchiseId: input.franchiseId,
    gameId: input.gameId,
    type,
    severity,
    occurredBeforeHalftime,
    sameGameReturn,
    sameGameReturned: null,
    missedGamesTotal,
    missedGamesRemaining: missedGamesTotal,
    actualReturnRound: null,
    seasonEnding: severity === 'season-ending',
    rehabModifier: 0,
    recurrenceWindowRoundsRemaining: 0,
    seedPath,
  };
  return { riskBasisPoints, occurred: true, removalClock, returnClock, injury };
}

export interface SeasonGameHealthTransitionInput {
  gameId: string;
  round: number;
  /** The two franchises that played this game. */
  franchises: readonly string[];
  /** New injury records rolled for this game. */
  newInjuries: readonly SeasonInjuryRecord[];
  /** Same-game return resolutions (returned = re-entered before the end). */
  sameGameReturned: readonly { injuryId: string; returned: boolean }[];
}

/**
 * Folds one game's health facts into the run health state (M2.5 contract
 * §9): new injuries append with their game facts; same-game returns resolve
 * (a returned minor returns in the occurrence round and opens its
 * recurrence window); then the two franchises that played advance one
 * recovery cadence — active injuries decrement `missedGamesRemaining` (the
 * occurrence game itself never counts as a missed game), an injury whose
 * remaining reaches zero marks its actual return round and opens the 10-game
 * recurrence window, and returned players' open windows decrement.
 */
export function applySeasonGameHealthTransition(
  health: SeasonHealthState,
  input: SeasonGameHealthTransitionInput,
): SeasonHealthState {
  const injuries = health.injuries.map((record) => ({ ...record }));
  const byId = new Map(injuries.map((record) => [record.injuryId, record]));
  const franchiseSet = new Set(input.franchises);

  // Append the game's new records first (idempotent per injuryId, so a
  // replayed transition never duplicates a record); same-game return
  // resolutions reference them below.
  for (const record of input.newInjuries) {
    const existing = byId.get(record.injuryId);
    if (existing !== undefined) continue;
    const copy = { ...record };
    byId.set(copy.injuryId, copy);
    injuries.push(copy);
  }

  // One recovery cadence per team game for the two franchises that played.
  // Pre-existing injuries only: a new injury's occurrence game never counts
  // as a missed game (missedGamesTotal counts the games AFTER the injury).
  for (let i = 0; i < health.injuries.length; i += 1) {
    const record = injuries[i];
    if (record === undefined) continue;
    if (!franchiseSet.has(record.franchiseId)) continue;
    if (record.missedGamesRemaining > 0) {
      record.missedGamesRemaining -= 1;
      if (record.missedGamesRemaining === 0) {
        record.actualReturnRound = input.round;
        record.recurrenceWindowRoundsRemaining = SEASON_INJURY_RECURRENCE_WINDOW_GAMES;
      }
    } else if (record.recurrenceWindowRoundsRemaining > 0) {
      record.recurrenceWindowRoundsRemaining -= 1;
    }
  }

  // Same-game return resolutions (the game decided whether the return
  // actually applied before the end).
  for (const resolution of input.sameGameReturned) {
    const record = byId.get(resolution.injuryId);
    if (record === undefined) {
      throw new Error(
        `season health: same-game return resolution references unknown injury ${resolution.injuryId}`,
      );
    }
    record.sameGameReturned = resolution.returned;
    if (resolution.returned) {
      record.missedGamesRemaining = 0;
      record.actualReturnRound = input.round;
      record.recurrenceWindowRoundsRemaining = SEASON_INJURY_RECURRENCE_WINDOW_GAMES;
    }
  }

  return { ...health, injuries };
}

/** True when the player has no active (non-returned, remaining > 0) injury. */
export function seasonPlayerAvailable(health: SeasonHealthState, playerVersionId: string): boolean {
  return !health.injuries.some(
    (record) =>
      record.playerVersionId === playerVersionId &&
      record.missedGamesRemaining > 0 &&
      record.sameGameReturned !== true,
  );
}

/**
 * Seeded risky-rehab outcome roll (60% success / 40% failure) under the
 * `rehab` event stream keyed by injury id — the health engine's roll, so
 * retries and AI/human spends reproduce the same outcome.
 */
export function rollSeasonRehabOutcome(rootSeed: string, injuryId: string): 'success' | 'failure' {
  const seed = injurySeed(rootSeed, injuryId, 'rehab');
  return rollBp(seed, SEASON_INJURY_REHAB_SUCCESS_BP) ? 'success' : 'failure';
}

/**
 * Applies a recorded risky-rehab outcome (contract §7): success reduces the
 * remaining absence by one game (minimum one); failure adds one missed game
 * and the recurrence window opens after the actual return through the same
 * actual-return mechanism. The modifier is recorded on the injury record
 * (`rehabModifier`); no unrecorded modifier is ever applied.
 */
export function applyRiskyRehabOutcome(
  health: SeasonHealthState,
  injuryId: string,
  outcome: 'success' | 'failure',
): SeasonHealthState {
  const record = health.injuries.find((entry) => entry.injuryId === injuryId);
  if (record === undefined) {
    throw new Error(`season health: risky rehab references unknown injury ${injuryId}`);
  }
  const updated: SeasonInjuryRecord = { ...record };
  if (outcome === 'success') {
    updated.missedGamesRemaining = Math.max(1, updated.missedGamesRemaining - 1);
    updated.rehabModifier = -1;
  } else {
    updated.missedGamesRemaining += 1;
    updated.rehabModifier = 1;
  }
  return {
    ...health,
    injuries: health.injuries.map((entry) => (entry.injuryId === injuryId ? updated : entry)),
  };
}
