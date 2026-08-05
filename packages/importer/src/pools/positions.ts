/**
 * Position normalization (spec/02) — port of the POSITION_LABEL_MAP and
 * normalize_position_labels helpers from scripts/import-nba/compute_pools.py,
 * rewritten for the detailed position vocabulary (wave 2b).
 *
 * Every published NBA label maps to the detailed positions it covers. The
 * old G/F/C grouping semantics are preserved exactly: through the
 * slot-group mapping in @hoop-rush/data-contracts (PG/SG -> G, SF/PF -> F,
 * C -> C), a label's detailed expansion lands in the same slot groups as the
 * canonical G/F/C value it replaced.
 */
import { POSITION_NORMALIZATION_VERSION, type Position } from '@hoop-rush/data-contracts';
import type { PositionOverride } from '../positions/overrides.ts';

/**
 * Maps every published NBA position label to the detailed positions it
 * covers. Empty-string labels are published by the source for some players;
 * they contribute no detailed position but remain in the known-label set
 * (the "" entry maps to an empty list).
 */
export const POSITION_LABEL_MAP: Readonly<Record<string, readonly Position[]>> = {
  PG: ['PG'],
  SG: ['SG'],
  SF: ['SF'],
  PF: ['PF'],
  C: ['C'],
  G: ['PG', 'SG'],
  F: ['SF', 'PF'],
  'G-F': ['PG', 'SG', 'SF', 'PF'],
  'F-G': ['PG', 'SG', 'SF', 'PF'],
  'F-C': ['SF', 'PF', 'C'],
  'C-F': ['SF', 'PF', 'C'],
  'G-C': ['PG', 'SG', 'C'],
  'C-G': ['PG', 'SG', 'C'],
  'G-F-C': ['PG', 'SG', 'SF', 'PF', 'C'],
  'F-G-C': ['PG', 'SG', 'SF', 'PF', 'C'],
  '': [],
};

export interface NormalizedPositionLabels {
  /** Sorted, deduplicated detailed positions from the known labels. */
  detailed: string[];
  /** SORTED original labels INCLUDING unknown ones (preserved for auditing). */
  sourceLabels: string[];
  /** Sorted original labels that matched no rule. */
  unknownLabels: string[];
}

/**
 * Return { detailed, sourceLabels, unknownLabels } for a set of labels.
 * Iterates labels in sorted order; unknown labels are preserved in
 * sourceLabels for auditing and collected into unknownLabels (the caller
 * warns), they never feed the detailed union.
 */
export function normalizePositionLabels(
  labels: ReadonlySet<string> | readonly string[],
): NormalizedPositionLabels {
  const detailed = new Set<string>();
  const unknownLabels: string[] = [];
  const sourceLabels = [...new Set([...labels].map(String))].sort();
  for (const label of sourceLabels) {
    const mapped = POSITION_LABEL_MAP[label];
    if (mapped === undefined) {
      unknownLabels.push(label);
      continue;
    }
    for (const position of mapped) {
      detailed.add(position);
    }
  }
  return { detailed: [...detailed].sort(), sourceLabels, unknownLabels };
}

/** The packaged positions record for one player (schema v3, wave 2b). */
export interface PlayerPositionRecord {
  primary: Position;
  secondary: Position[];
  playable: Position[];
  sourceLabels: string[];
  normalizationVersion: string;
}

/**
 * Assembles the packaged positions record for a player from the career-wide
 * source labels, the peak season's roster label, and the reviewed override.
 *
 * - Every label is validated through POSITION_LABEL_MAP. Unknown labels are
 *   collected into `unknownLabels` (the caller warns), kept in
 *   `sourceLabels` for auditing, and never feed positions.
 * - With an override: primary/secondary come from the override (values are
 *   already enum-validated by PositionOverride); playable is the sorted,
 *   deduplicated [primary, ...secondary] union. sourceLabels still carries
 *   every raw label (career ∪ peak), sorted and deduplicated.
 * - Without an override: primary comes from the peak roster label; when that
 *   label is unknown or empty it is reported in `unknownLabels` and falls
 *   back to 'SF' (preserving the historical mapPosition default). Known
 *   coarse labels expand to their first detailed position. secondary holds
 *   the validated non-empty peak secondary labels (unknown secondary labels
 *   are audited but not added). playable is the sorted, deduplicated union of
 *   the career detailed positions, the primary, and the secondary.
 * - If the final playable set is empty the record cannot be packaged (the
 *   runtime schema rejects empty unions), so building throws.
 */
export function buildPlayerPositions(input: {
  /** Career-wide source labels (from the v5 cache or the player's own rows). */
  careerLabels: ReadonlySet<string> | readonly string[];
  /** Peak season's roster position label (primary source signal). */
  peakPrimary: string;
  /** Peak season's secondaryPositions array (usually empty). */
  peakSecondary: readonly string[];
  /** Reviewed override, when present. */
  override?: PositionOverride | null;
}): { record: PlayerPositionRecord; unknownLabels: string[] } {
  const { careerLabels, peakPrimary, peakSecondary, override } = input;

  const allLabels = new Set<string>();
  for (const label of careerLabels) {
    allLabels.add(label);
  }
  allLabels.add(peakPrimary);
  for (const label of peakSecondary) {
    if (label !== '') {
      allLabels.add(label);
    }
  }
  const sourceLabels = [...allLabels].sort();

  const unknownLabels: string[] = [];
  for (const label of sourceLabels) {
    if (POSITION_LABEL_MAP[label] === undefined) {
      unknownLabels.push(label);
    }
  }

  if (override !== null && override !== undefined) {
    // PositionOverride values are enum-validated, so an empty union can only
    // arrive from a malformed payload (e.g. a hand-edited artifact). Read the
    // payload through unknown and guard loudly instead of packaging a record
    // the runtime schema would reject.
    const overridePrimary: unknown = override.primary;
    const overrideSecondary: unknown = override.secondary;
    const overrideSecondaryList: unknown[] = Array.isArray(overrideSecondary)
      ? (overrideSecondary as unknown[])
      : [];
    const overridePositions: unknown[] = [overridePrimary, ...overrideSecondaryList];
    const playable = [...new Set(overridePositions)]
      .filter((p): p is Position => typeof p === 'string')
      .sort();
    if (playable.length === 0) {
      throw new Error('empty playable positions for overridden player');
    }
    return {
      record: {
        primary: override.primary,
        secondary: [...override.secondary],
        playable,
        sourceLabels,
        normalizationVersion: POSITION_NORMALIZATION_VERSION,
      },
      unknownLabels: [...unknownLabels].sort(),
    };
  }

  const peakMapped = POSITION_LABEL_MAP[peakPrimary];
  let primary: Position;
  if (peakPrimary === '' || peakMapped === undefined) {
    if (!unknownLabels.includes(peakPrimary)) {
      unknownLabels.push(peakPrimary);
    }
    primary = 'SF';
  } else {
    primary = peakMapped[0] ?? 'SF';
  }

  const secondary: Position[] = [];
  for (const label of peakSecondary) {
    if (label === '') {
      continue;
    }
    const mapped = POSITION_LABEL_MAP[label];
    if (mapped === undefined) {
      if (!unknownLabels.includes(label)) {
        unknownLabels.push(label);
      }
      continue;
    }
    for (const position of mapped) {
      secondary.push(position);
    }
  }

  const careerUnion = normalizePositionLabels(careerLabels).detailed as Position[];
  const playable = [...new Set([...careerUnion, primary, ...secondary])].sort();
  if (playable.length === 0) {
    throw new Error('empty playable positions for packaged player');
  }

  return {
    record: {
      primary,
      secondary: [...new Set(secondary)].sort(),
      playable,
      sourceLabels,
      normalizationVersion: POSITION_NORMALIZATION_VERSION,
    },
    unknownLabels: [...unknownLabels].sort(),
  };
}
