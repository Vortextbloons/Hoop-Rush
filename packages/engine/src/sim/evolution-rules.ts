export const COURT_INNOVATION_GAME_RULES = [
  'standard',
  'twenty-second-clock',
  'deep-four',
  'first-to-seven-overtime',
] as const;
export type CourtInnovationGameRule = (typeof COURT_INNOVATION_GAME_RULES)[number];
export const DEEP_FOUR_SPLIT = 0.2;
export const DEEP_FOUR_MAKE_SCALE = 0.75;
export const DEEP_FOUR_FT_MISS = 4;
export const TWENTY_SECOND_CLOCK = 20;
export const TWENTY_SECOND_LATE_WINDOW = 4;
export const TWENTY_SECOND_LATE_PRESSURE = 0.1;
export const FIRST_TO_SEVEN_TARGET = 7 as const;
export const FIRST_TO_SEVEN_SAFETY_POSSESSIONS = 1000;
export function twentySecondClockPressure(shotClockRemaining: number): number {
  if (shotClockRemaining >= TWENTY_SECOND_LATE_WINDOW) return 1;
  const clamped = Math.max(0, shotClockRemaining);
  return 1 - TWENTY_SECOND_LATE_PRESSURE * (1 - clamped / TWENTY_SECOND_LATE_WINDOW);
}
export class FirstToSevenOvertimeExhaustedError extends Error {
  readonly code = 'first-to-seven-exhausted' as const;
  readonly possessions: number;
  readonly homeOT: number;
  readonly awayOT: number;
  constructor(possessions: number, homeOT: number, awayOT: number, context?: string) {
    super(
      `first-to-seven overtime exceeded ${String(possessions)} possessions (${String(homeOT)}-${String(awayOT)}) without a winner${context ? ` (${context})` : ''}`,
    );
    this.name = 'FirstToSevenOvertimeExhaustedError';
    this.possessions = possessions;
    this.homeOT = homeOT;
    this.awayOT = awayOT;
  }
}
