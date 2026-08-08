import {
  fatigueBandOf,
  pairChemistryBasisPoints,
  unitChemistryBasisPoints,
} from '@hoop-rush/engine';
import type {
  SeasonEffectsState,
  SeasonMechanismEvidence,
  SeasonRetainedGameDetail,
} from '@hoop-rush/data-contracts';

/**
 * M2.4 effects presentation (season-stamina-v2 + season-chemistry-v1).
 * Fatigue bands and chemistry facts derived from the recorded effects state
 * frozen in the accepted checkpoint. The UI presents projections as
 * projections and shared possessions as evidence, never as a precise future
 * outcome. The fatigue-band thresholds live in the engine
 * (`fatigueBandOf`); the web keeps only the presentation labels.
 */

export type FatigueBand = 'fresh' | 'ready' | 'tired' | 'heavy';

/** Fatigue band of a basis-point fatigue value (engine-authoritative). */
export const fatigueBand = fatigueBandOf;

export const FATIGUE_BAND_LABEL: Record<FatigueBand, string> = {
  fresh: 'Fresh',
  ready: 'Ready',
  tired: 'Tired',
  heavy: 'Heavy',
};

export const FATIGUE_BAND_BADGE: Record<FatigueBand, string> = {
  fresh: 'bg-positive/15 text-positive',
  ready: 'bg-primary/15 text-primary',
  tired: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  heavy: 'bg-destructive/15 text-destructive',
};

/** Fatigue as a percentage (0..100) for band display. */
export function fatiguePercent(fatigueBasisPoints: number): number {
  return Math.round((fatigueBasisPoints / 10_000) * 100);
}

/** The recorded load state of one version (null when absent). */
export function loadStateOf(state: SeasonEffectsState, playerVersionId: string) {
  return state.playerStates.find((player) => player.playerVersionId === playerVersionId) ?? null;
}

/** Shared possessions of one canonical pair (0 when absent). */
export function pairSharedOf(state: SeasonEffectsState, a: string, b: string): number {
  const [x, y] = a < b ? [a, b] : [b, a];
  const pair = state.pairStates.find((p) => p.a === x && p.b === y);
  return pair?.sharedPossessions ?? 0;
}

/** Active-lineup chemistry (basis points) for a five-man unit. */
export function activeLineupChemistryBp(
  state: SeasonEffectsState,
  unit: readonly string[],
): number {
  if (unit.length !== 5) return 0;
  try {
    return unitChemistryBasisPoints(state.pairStates, unit);
  } catch {
    return 0;
  }
}

/** The strongest and weakest recorded pairs of a ten-player roster. */
export function strongestAndWeakestPairs(
  state: SeasonEffectsState,
  rosterVersions: readonly string[],
): {
  strongest: Array<{ a: string; b: string; shared: number; chemistryBp: number }>;
  weakest: Array<{ a: string; b: string; shared: number; chemistryBp: number }>;
} {
  const rosterSet = new Set(rosterVersions);
  const pairs = state.pairStates
    .filter((pair) => rosterSet.has(pair.a) && rosterSet.has(pair.b))
    .map((pair) => ({
      a: pair.a,
      b: pair.b,
      shared: pair.sharedPossessions,
      chemistryBp: pairChemistryBasisPoints(pair.sharedPossessions),
    }))
    .sort((x, y) => y.shared - x.shared);
  return {
    strongest: pairs.slice(0, 3),
    weakest: pairs.slice(-3).reverse(),
  };
}

/** Projected band of a player after `games` upcoming games at `minutesPerGame`. */
export function projectedFatigueBand(
  currentFatigueBp: number,
  minutesPerGame: number,
  staminaRating: number,
  games = 10,
): FatigueBand {
  // Deterministic projection: per-game accumulation at the player's
  // workload, one recovery tick between games, no role bonuses.
  let fatigue = currentFatigueBp;
  for (let i = 0; i < games; i += 1) {
    const seconds = minutesPerGame * 60;
    const base = (seconds * 40 * (110 - staminaRating)) / 10_000;
    fatigue += base;
    const factor = (4500 - 20 * staminaRating) / 10_000;
    fatigue = Math.max(0, Math.round(fatigue * factor));
  }
  return fatigueBand(Math.min(10_000, fatigue));
}

/**
 * One block-level mechanism row: aggregated evidence from the block's
 * retained details (human-team games). `avgInputFraction` is the recorded
 * average mechanism input (fatigue or chemistry as a 0..1 fraction) over the
 * opportunities, and the deltas are integer millionths.
 */
export interface BlockMechanismEvidenceRow {
  mechanism: SeasonMechanismEvidence['mechanism'];
  side: SeasonMechanismEvidence['side'];
  opportunities: number;
  deltaTotals: number;
  deltaMin: number;
  deltaMax: number;
  avgInputFraction: number;
}

/** Aggregates the retained details' mechanism evidence for one block. */
export function aggregateMechanismEvidence(
  details: readonly SeasonRetainedGameDetail[],
): BlockMechanismEvidenceRow[] {
  const rows = new Map<
    string,
    {
      mechanism: SeasonMechanismEvidence['mechanism'];
      side: SeasonMechanismEvidence['side'];
      opportunities: number;
      deltaTotals: number;
      deltaMin: number;
      deltaMax: number;
      inputTotal: number;
    }
  >();
  for (const detail of details) {
    for (const row of detail.mechanismEvidence ?? []) {
      const key = `${row.mechanism}\u0000${row.side}`;
      const existing = rows.get(key);
      const inputTotal =
        row.inputTotals.shooter +
        row.inputTotals.handler +
        row.inputTotals.defenseMean +
        row.inputTotals.unitChemistry;
      if (existing === undefined) {
        rows.set(key, {
          mechanism: row.mechanism,
          side: row.side,
          opportunities: row.opportunities,
          deltaTotals: row.deltaTotals,
          deltaMin: row.deltaMin,
          deltaMax: row.deltaMax,
          inputTotal,
        });
      } else {
        existing.opportunities += row.opportunities;
        existing.deltaTotals += row.deltaTotals;
        existing.deltaMin = Math.min(existing.deltaMin, row.deltaMin);
        existing.deltaMax = Math.max(existing.deltaMax, row.deltaMax);
        existing.inputTotal += inputTotal;
      }
    }
  }
  return [...rows.values()]
    .map((row) => ({
      mechanism: row.mechanism,
      side: row.side,
      opportunities: row.opportunities,
      deltaTotals: row.deltaTotals,
      deltaMin: row.deltaMin,
      deltaMax: row.deltaMax,
      avgInputFraction: row.opportunities > 0 ? row.inputTotal / row.opportunities / 1_000_000 : 0,
    }))
    .sort((a, b) => (a.mechanism < b.mechanism ? -1 : a.mechanism > b.mechanism ? 1 : 0));
}

export const MECHANISM_LABEL: Record<BlockMechanismEvidenceRow['mechanism'], string> = {
  'shooter-fatigue': 'Fatigued shooters converted at a lower rate',
  'handler-fatigue': 'Fatigued handlers turned the ball over more',
  'defensive-unit-fatigue': 'Tired defenses conceded a bit more',
  'turnover-security': 'Chemistry protected the ball',
  'assist-conversion': 'Chemistry converted passes into assists',
  'help-defense': 'Chemistry helped defense contest shots',
};

/** Delta in percentage points (signed) from integer millionths. */
export function deltaToPp(millionths: number): number {
  return millionths / 10_000;
}
