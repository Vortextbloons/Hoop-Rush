import type { SeasonGameRule } from '@hoop-rush/data-contracts';
import { SEASON_COURT_INNOVATION_VERSION } from '@hoop-rush/data-contracts';

export const DEEP_FOUR_SPLIT = 0.2;
export const DEEP_FOUR_MAKE_SCALE = 0.75;
export const DEEP_FOUR_FT_MISS = 4;
export const TWENTY_SECOND_CLOCK = 20;
export const TWENTY_SECOND_RESET_OFFENSIVE_REBOUND = 14;
export const TWENTY_SECOND_RETAIN_MIN = 14;
export const TWENTY_SECOND_LATE_WINDOW = 4;
export const TWENTY_SECOND_LATE_PRESSURE = 0.1;
export const FIRST_TO_SEVEN_TARGET = 7;
export const FIRST_TO_SEVEN_SAFETY_POSSESSIONS = 1000;
export const RULE_VERSION = SEASON_COURT_INNOVATION_VERSION;

export function isDeepFourRule(rule: SeasonGameRule | null | undefined): boolean {
  return rule === 'deep-four';
}

export function isTwentySecondRule(rule: SeasonGameRule | null | undefined): boolean {
  return rule === 'twenty-second-clock';
}

export function isFirstToSevenRule(rule: SeasonGameRule | null | undefined): boolean {
  return rule === 'first-to-seven-overtime';
}

export function deepFourPoints(): number {
  return 4;
}

export function twentySecondScaledSample(rawSample: number): number {
  return (rawSample * TWENTY_SECOND_CLOCK) / 24;
}

export function twentySecondClockPressure(shotClockRemaining: number): number {
  if (shotClockRemaining >= TWENTY_SECOND_LATE_WINDOW) return 1;
  const clamped = Math.max(0, shotClockRemaining);
  return 1 - TWENTY_SECOND_LATE_PRESSURE * (1 - clamped / TWENTY_SECOND_LATE_WINDOW);
}

export function firstToSevenWinner(homeOT: number, awayOT: number): 'home' | 'away' | null {
  const homeWins = homeOT >= FIRST_TO_SEVEN_TARGET;
  const awayWins = awayOT >= FIRST_TO_SEVEN_TARGET;
  if (homeWins && !awayWins) return 'home';
  if (awayWins && !homeWins) return 'away';
  if (homeWins && awayWins) return homeOT > awayOT ? 'home' : awayOT > homeOT ? 'away' : null;
  return null;
}

export class FirstToSevenOvertimeExhaustedError extends Error {
  readonly code = 'first-to-seven-exhausted' as const;
  readonly possessions: number;
  readonly homeOT: number;
  readonly awayOT: number;
  constructor(possessions: number, homeOT: number, awayOT: number) {
    super(
      `first-to-seven overtime exceeded ${String(possessions)} possessions (${String(homeOT)}-${String(awayOT)}) without a winner`,
    );
    this.name = 'FirstToSevenOvertimeExhaustedError';
    this.possessions = possessions;
    this.homeOT = homeOT;
    this.awayOT = awayOT;
  }
}
