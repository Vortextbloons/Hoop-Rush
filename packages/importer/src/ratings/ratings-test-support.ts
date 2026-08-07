/**
 * Shared ratings-suite fixtures (ratings.test.ts + v3.test.ts): the modern
 * era context and the full modern-style season totals for a solid starter.
 * One copy avoids drift between the field-method registry suite and the v3
 * profile suite.
 */

export const MODERN_ERA = { leaguePpg: 110, league3PARate: 0.36, pace: 99 };

/** Full modern-style season totals for a solid starter. */
export function starterStats(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    gamesPlayed: 78,
    minutes: 2850,
    points: 1680,
    rebounds: 420,
    offensiveRebounds: 80,
    defensiveRebounds: 340,
    assists: 310,
    steals: 95,
    blocks: 30,
    turnovers: 210,
    fouls: 180,
    fgm: 630,
    fga: 1350,
    tpm: 160,
    tpa: 410,
    ftm: 260,
    fta: 310,
    per: 19.5,
    boxPlusMinus: 3.1,
    usageRate: 25,
    tsPct: 0.57,
    efgPct: 0.526,
    ...over,
  };
}
