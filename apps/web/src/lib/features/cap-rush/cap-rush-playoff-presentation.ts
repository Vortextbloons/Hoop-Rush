import {
  CAP_RUSH_PLAYOFF_CAPS,
  CAP_RUSH_PLAYOFF_FORMULA_VERSION,
  CAP_RUSH_PLAYOFF_SAMPLE_MINUTES,
  type CapRushDraftState,
  type CapRushLockedInputs,
  type CapRushPlayoffApplied,
  type CapRushPlayoffPlayer,
} from '@hoop-rush/data-contracts';

export type CapRushPlayoffStatus = 'active' | 'pending' | 'legacy' | 'no-sample';
export type CapRushPlayoffDirection = 'up' | 'down' | 'neutral';

export interface CapRushPlayoffRow {
  readonly row: CapRushPlayoffPlayer;
  readonly seasonKey: string;
  readonly direction: CapRushPlayoffDirection;
}

/**
 * Display-only summary of which way the capped adjustment moves a player's playoffs. It reads the
 * effective deltas rather than the raw history, so the roster mark always agrees with what the
 * simulation will do. Each channel is normalised by its own cap so one large rebound shift cannot
 * outvote a shooting change, and positive turnovers count against the player because the engine
 * reads a higher turnover tendency as a worse outcome.
 */
export function capRushPlayoffDirection(applied: CapRushPlayoffApplied): CapRushPlayoffDirection {
  const c = CAP_RUSH_PLAYOFF_CAPS;
  const share = (value: number, cap: number): number => (cap > 0 ? value / cap : 0);
  const score =
    share(applied.fieldGoalPct, c.fieldGoalPct) +
    share(applied.fieldGoalAttemptsPerGame, c.fieldGoalAttemptsPerGame) +
    share(applied.assistsPerGame, c.assistsPerGame) +
    share(
      applied.offensiveReboundsPerGame + applied.defensiveReboundsPerGame,
      c.offensiveReboundsPerGame + c.defensiveReboundsPerGame,
    ) -
    share(applied.turnoverRate, c.turnoverRate);
  if (score > 0.08) return 'up';
  if (score < -0.08) return 'down';
  return 'neutral';
}

function isPostseason(draft: CapRushDraftState): boolean {
  return draft.stage === 'postseason' || draft.postseason !== undefined;
}

export function capRushPlayoffStatusOf(draft: CapRushDraftState): CapRushPlayoffStatus {
  if (draft.playoffFormulaVersion !== CAP_RUSH_PLAYOFF_FORMULA_VERSION) return 'legacy';
  if (draft.locked?.playoffPerformance === undefined) return 'no-sample';
  return isPostseason(draft) ? 'active' : 'pending';
}

export function capRushPlayoffRowFor(
  locked: CapRushLockedInputs | null,
  playerVersionId: string | null | undefined,
): CapRushPlayoffRow | null {
  if (playerVersionId === null || playerVersionId === undefined) return null;
  const row = locked?.playoffPerformance?.players.find(
    (candidate) => candidate.playerVersionId === playerVersionId,
  );
  if (row === undefined) return null;
  return { row, seasonKey: row.seasonKey, direction: capRushPlayoffDirection(row.applied) };
}

export function signedFixed(value: number, digits: number): string {
  const rounded = Math.abs(value).toFixed(digits);
  if (Number(rounded) === 0) return (0).toFixed(digits);
  return `${value < 0 ? '−' : '+'}${rounded}`;
}

/** True shooting is stored as a fraction; the panel always shows percentage points. */
export function signedPoints(value: number | null, digits = 1): string {
  return value === null ? '—' : `${signedFixed(value * 100, digits)} pp`;
}

export function signedPer36(value: number | null, digits = 1): string {
  return value === null ? '—' : signedFixed(value, digits);
}

export function sampleLabel(row: CapRushPlayoffPlayer): string {
  const games = row.playoffs.gamesPlayed;
  const minutes = Math.round(row.playoffs.minutes);
  return `${String(games)} G · ${String(minutes)} min`;
}

export function weightLabel(row: CapRushPlayoffPlayer): string {
  return `${String(Math.round(row.weight * 100))}% of the measured difference`;
}

/** Minutes at which exactly half of a measured difference is applied. */
export const capRushPlayoffSampleMinutes = CAP_RUSH_PLAYOFF_SAMPLE_MINUTES;

export function capRushPlayoffCoverage(
  locked: CapRushLockedInputs | null,
  playerVersionIds: readonly (string | null | undefined)[],
): { readonly withEvidence: number; readonly total: number } {
  return {
    withEvidence: playerVersionIds.filter(
      (versionId) => capRushPlayoffRowFor(locked, versionId) !== null,
    ).length,
    total: playerVersionIds.length,
  };
}
