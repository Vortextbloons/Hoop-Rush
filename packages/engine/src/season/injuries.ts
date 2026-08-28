import { SEASON_ENDING_MISSED_GAMES_SENTINEL, SEASON_SEED_NAMESPACES, seasonDigestHex, seasonNamespaceSeed, type SeasonHealthState, type SeasonInjuryRecord, type SeasonInjurySeverity, type SeasonInjuryType, } from '@hoop-rush/data-contracts';
import { HALFTIME_SECOND, REGULATION_PERIOD_SECONDS, REGULATION_TOTAL_SECONDS, } from '../sim/periods.ts';
import { drawHexInt } from './season-seeds.ts';
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
export const SEASON_INJURY_MINOR_BP = 6000;
export const SEASON_INJURY_MODERATE_BP = 8800;
export const SEASON_INJURY_MAJOR_BP = 9800;
export const SEASON_INJURY_SAME_GAME_RETURN_BP = 3500;
export const SEASON_INJURY_REHAB_SUCCESS_BP = 6000;
export const SEASON_INJURY_RECOVERY_RANGES: Record<'minor' | 'moderate' | 'major', readonly [
    number,
    number
]> = {
    minor: [1, 2],
    moderate: [3, 6],
    major: [7, 18],
};
const INJURY_TYPES: readonly SeasonInjuryType[] = [
    'lower-body',
    'soft-tissue',
    'upper-body',
    'illness',
];
function injurySeed(rootSeed: string, ...keys: string[]): string {
    return seasonNamespaceSeed(rootSeed, SEASON_SEED_NAMESPACES.injuries, ...keys);
}
function u32Of(seed: string): number {
    return drawHexInt(seed) >>> 0;
}
function rollBp(seed: string, thresholdBp: number): boolean {
    return u32Of(seed) % 10000 < thresholdBp;
}
function uniformInt(seed: string, min: number, max: number): number {
    return min + (u32Of(seed) % (max - min + 1));
}
export function clockFromTipoffSeconds(secondsFromTipoff: number): {
    period: number;
    seconds: number;
} {
    const clamped = Math.max(0, Math.min(REGULATION_TOTAL_SECONDS, secondsFromTipoff));
    if (clamped >= REGULATION_TOTAL_SECONDS) {
        return { period: 4, seconds: 0 };
    }
    const period = Math.floor(clamped / REGULATION_PERIOD_SECONDS) + 1;
    const seconds = REGULATION_PERIOD_SECONDS - (clamped % REGULATION_PERIOD_SECONDS);
    return { period, seconds };
}
export interface SeasonInjuryRollInput {
    rootSeed: string;
    gameId: string;
    playerVersionId: string;
    franchiseId: string;
    durabilityRating: number;
    fatigueBasisPoints: number;
    recentLoadBasisPoints: number;
    targetMinutes: number;
    recurrenceWindowRoundsRemaining: number;
    rehabPremiumBasisPoints?: number;
}
export interface SeasonInjuryRollResult {
    riskBasisPoints: number;
    occurred: boolean;
    removalClock: {
        period: number;
        seconds: number;
    } | null;
    returnClock: {
        period: number;
        seconds: number;
    } | null;
    injury: SeasonInjuryRecord | null;
}
export function seasonInjuryRiskBasisPoints(input: {
    durabilityRating: number;
    fatigueBasisPoints: number;
    recentLoadBasisPoints: number;
    targetMinutes: number;
    recurrenceWindowRoundsRemaining: number;
    rehabPremiumBasisPoints?: number;
}): number {
    const raw = SEASON_INJURY_BASE_RISK_BP +
        (SEASON_INJURY_DURABILITY_REFERENCE_RATING - input.durabilityRating) *
            SEASON_INJURY_DURABILITY_PENALTY_PER_RATING +
        input.fatigueBasisPoints / SEASON_INJURY_FATIGUE_DIVISOR +
        input.recentLoadBasisPoints / SEASON_INJURY_RECENT_LOAD_DIVISOR +
        Math.max(0, input.targetMinutes - SEASON_INJURY_MINUTES_EXPOSURE_BASE) *
            SEASON_INJURY_MINUTES_EXPOSURE_FACTOR +
        (input.recurrenceWindowRoundsRemaining > 0 ? SEASON_INJURY_RECURRENCE_BONUS_BP : 0) +
        (input.rehabPremiumBasisPoints ?? 0);
    const clamped = Math.min(SEASON_INJURY_RISK_MAX_BP, Math.max(SEASON_INJURY_RISK_MIN_BP, raw));
    return Math.floor(clamped + 0.5);
}
export function seasonInjuryIdOf(seedPath: readonly string[]): string {
    return `inj-${seasonDigestHex(seedPath.join('\u0000'))}`;
}
export function rollSeasonInjuryForPlayer(input: SeasonInjuryRollInput): SeasonInjuryRollResult {
    const riskBasisPoints = seasonInjuryRiskBasisPoints({
        durabilityRating: input.durabilityRating,
        fatigueBasisPoints: input.fatigueBasisPoints,
        recentLoadBasisPoints: input.recentLoadBasisPoints,
        targetMinutes: input.targetMinutes,
        recurrenceWindowRoundsRemaining: input.recurrenceWindowRoundsRemaining,
        rehabPremiumBasisPoints: input.rehabPremiumBasisPoints,
    });
    const occurrenceSeed = injurySeed(input.rootSeed, input.gameId, input.playerVersionId, 'occurrence');
    if (!rollBp(occurrenceSeed, riskBasisPoints)) {
        return {
            riskBasisPoints,
            occurred: false,
            removalClock: null,
            returnClock: null,
            injury: null,
        };
    }
    const severitySeed = injurySeed(input.rootSeed, input.gameId, input.playerVersionId, 'severity');
    const severityRoll = u32Of(severitySeed) % 10000;
    const severity: SeasonInjurySeverity = severityRoll < SEASON_INJURY_MINOR_BP
        ? 'minor'
        : severityRoll < SEASON_INJURY_MODERATE_BP
            ? 'moderate'
            : severityRoll < SEASON_INJURY_MAJOR_BP
                ? 'major'
                : 'season-ending';
    const typeSeed = injurySeed(input.rootSeed, input.gameId, input.playerVersionId, 'type');
    const type = INJURY_TYPES[uniformInt(typeSeed, 0, INJURY_TYPES.length - 1)] ?? 'lower-body';
    const clockSeed = injurySeed(input.rootSeed, input.gameId, input.playerVersionId, 'clock');
    const exposureSeconds = uniformInt(clockSeed, 0, Math.min(Math.max(0, input.targetMinutes) * 60, REGULATION_TOTAL_SECONDS));
    const removalClock = clockFromTipoffSeconds(exposureSeconds);
    const occurredBeforeHalftime = exposureSeconds < HALFTIME_SECOND;
    const sameGameReturnSeed = injurySeed(input.rootSeed, input.gameId, input.playerVersionId, 'same-game-return');
    const sameGameReturn = severity === 'minor' &&
        occurredBeforeHalftime &&
        rollBp(sameGameReturnSeed, SEASON_INJURY_SAME_GAME_RETURN_BP);
    const returnSeed = injurySeed(input.rootSeed, input.gameId, input.playerVersionId, 'return');
    let returnClock: {
        period: number;
        seconds: number;
    } | null = null;
    let missedGamesTotal = 0;
    if (sameGameReturn) {
        returnClock = clockFromTipoffSeconds(uniformInt(returnSeed, HALFTIME_SECOND, REGULATION_TOTAL_SECONDS));
    }
    else if (severity === 'season-ending') {
        missedGamesTotal = SEASON_ENDING_MISSED_GAMES_SENTINEL;
    }
    else {
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
    franchises: readonly string[];
    newInjuries: readonly SeasonInjuryRecord[];
    sameGameReturned: readonly {
        injuryId: string;
        returned: boolean;
    }[];
}
export function applySeasonGameHealthTransition(health: SeasonHealthState, input: SeasonGameHealthTransitionInput): SeasonHealthState {
    const injuries = health.injuries.map((record) => ({ ...record }));
    const byId = new Map(injuries.map((record) => [record.injuryId, record]));
    const franchiseSet = new Set(input.franchises);
    for (const record of input.newInjuries) {
        const existing = byId.get(record.injuryId);
        if (existing !== undefined)
            continue;
        const copy = { ...record };
        byId.set(copy.injuryId, copy);
        injuries.push(copy);
    }
    for (let i = 0; i < health.injuries.length; i += 1) {
        const record = injuries[i];
        if (record === undefined)
            continue;
        if (!franchiseSet.has(record.franchiseId))
            continue;
        if (record.seasonEnding)
            continue;
        if (record.missedGamesRemaining > 0) {
            record.missedGamesRemaining -= 1;
            if (record.missedGamesRemaining === 0) {
                record.actualReturnRound = input.round;
                record.recurrenceWindowRoundsRemaining = SEASON_INJURY_RECURRENCE_WINDOW_GAMES;
            }
        }
        else if (record.recurrenceWindowRoundsRemaining > 0) {
            record.recurrenceWindowRoundsRemaining -= 1;
        }
    }
    for (const resolution of input.sameGameReturned) {
        const record = byId.get(resolution.injuryId);
        if (record === undefined) {
            throw new Error(`season health: same-game return resolution references unknown injury ${resolution.injuryId}`);
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
export function seasonPlayerAvailable(health: SeasonHealthState, playerVersionId: string): boolean {
    return !health.injuries.some((record) => record.playerVersionId === playerVersionId &&
        record.missedGamesRemaining > 0 &&
        record.sameGameReturned !== true);
}
export function rollSeasonRehabOutcome(rootSeed: string, injuryId: string): 'success' | 'failure' {
    const seed = injurySeed(rootSeed, injuryId, 'rehab');
    return rollBp(seed, SEASON_INJURY_REHAB_SUCCESS_BP) ? 'success' : 'failure';
}
export function applyRiskyRehabOutcome(health: SeasonHealthState, injuryId: string, outcome: 'success' | 'failure'): SeasonHealthState {
    const record = health.injuries.find((entry) => entry.injuryId === injuryId);
    if (record === undefined) {
        throw new Error(`season health: risky rehab references unknown injury ${injuryId}`);
    }
    const updated: SeasonInjuryRecord = { ...record };
    if (record.seasonEnding) {
        updated.missedGamesTotal = SEASON_ENDING_MISSED_GAMES_SENTINEL;
        updated.missedGamesRemaining = SEASON_ENDING_MISSED_GAMES_SENTINEL;
        updated.rehabModifier = outcome === 'success' ? -1 : 1;
        updated.rehabAttempted = true;
        updated.rehabOutcome = outcome;
        updated.rehabRecurrencePremiumApplied = outcome === 'success';
        updated.rehabRecurrencePremiumBasisPoints = outcome === 'success' ? 60 : 0;
    }
    else if (outcome === 'success') {
        updated.missedGamesRemaining = Math.max(1, updated.missedGamesRemaining - 1);
        updated.rehabModifier = -1;
        updated.rehabAttempted = true;
        updated.rehabOutcome = 'success';
        updated.rehabRecurrencePremiumApplied = true;
        updated.rehabRecurrencePremiumBasisPoints = 60;
    }
    else {
        updated.missedGamesRemaining = Math.min(
            SEASON_ENDING_MISSED_GAMES_SENTINEL - 1,
            updated.missedGamesRemaining + 1,
        );
        updated.rehabModifier = 1;
        updated.rehabAttempted = true;
        updated.rehabOutcome = 'failure';
        updated.rehabRecurrencePremiumApplied = false;
        updated.rehabRecurrencePremiumBasisPoints = 0;
    }
    return {
        ...health,
        injuries: health.injuries.map((entry) => (entry.injuryId === injuryId ? updated : entry)),
    };
}
