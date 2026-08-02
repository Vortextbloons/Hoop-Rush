/**
 * Position normalization (spec/02) — port of the POSITION_LABEL_MAP and
 * normalize_position_labels helpers from scripts/import-nba/compute_pools.py.
 */

/**
 * Maps every published NBA position label to the canonical G/F/C groups the
 * game consumes. Empty-string labels are published by the source for some
 * players; they contribute no canonical group but remain in the known-label
 * set (the "" entry maps to an empty list).
 */
export const POSITION_LABEL_MAP: Readonly<Record<string, readonly string[]>> = {
  G: ['G'],
  F: ['F'],
  C: ['C'],
  'G-F': ['G', 'F'],
  'F-G': ['G', 'F'],
  'F-C': ['F', 'C'],
  'C-F': ['F', 'C'],
  'G-C': ['G', 'C'],
  'C-G': ['G', 'C'],
  'G-F-C': ['G', 'F', 'C'],
  'F-G-C': ['F', 'G', 'C'],
  PG: ['G'],
  SG: ['G'],
  SF: ['F'],
  PF: ['F'],
  '': [],
};

export interface NormalizedPositionLabels {
  /** Sorted, deduplicated canonical G/F/C groups. */
  canonical: string[];
  /** Sorted original labels that mapped to a known rule (may include ""). */
  sourceLabels: string[];
  /** Sorted original labels that matched no rule. */
  unknownLabels: string[];
}

/**
 * Return { canonical, sourceLabels, unknownLabels } for a set of labels.
 * Iterates labels in sorted order; unknown labels are collected and reported
 * (the caller warns), they never feed the canonical union.
 */
export function normalizePositionLabels(
  labels: ReadonlySet<string> | readonly string[],
): NormalizedPositionLabels {
  const canonical = new Set<string>();
  const known: string[] = [];
  const unknown: string[] = [];
  for (const label of [...labels].sort()) {
    const mapped = POSITION_LABEL_MAP[label];
    if (mapped === undefined) {
      unknown.push(label);
      continue;
    }
    known.push(label);
    for (const position of mapped) {
      canonical.add(position);
    }
  }
  return { canonical: [...canonical].sort(), sourceLabels: known, unknownLabels: unknown };
}
