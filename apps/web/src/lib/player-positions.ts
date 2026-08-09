/**
 * Shared player-position presentation (spec/01, spec/2.0): `PG/SG/SF/PF/C`
 * is the only position vocabulary users see — player labels, roster filters,
 * lineup slot labels, accessibility announcements, and explanatory copy.
 *
 * Coarse `G/F/C` remains an internal lineup-legality vocabulary
 * (`LINEUP_STRUCTURE`, slot groups); this module never renders it, and
 * `formatPositions` explicitly refuses to collapse detailed positions into
 * it. Pure functions only — no Svelte, no DOM — unit-testable in node.
 */

export const DETAILED_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;

export const DETAILED_POSITION_NAMES = [
  'Point Guard',
  'Shooting Guard',
  'Small Forward',
  'Power Forward',
  'Center',
] as const;

export const SLOT_LABELS = DETAILED_POSITIONS;

export const SLOT_NAMES = DETAILED_POSITION_NAMES;

export const SLOT_INDEXES = [0, 1, 2, 3, 4] as const;

/**
 * Renders a player's positions as a slash-joined string in canonical detailed
 * order, deduplicated. Never collapses `PF` into `F`, `SG` into `G`, etc. —
 * coarse groups are only a lineup-legality vocabulary and must not leak into
 * user-facing text. Unknown values pass through after the known positions.
 */
export function formatPositions(positions: readonly string[]): string {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const position of DETAILED_POSITIONS) {
    if (positions.includes(position)) {
      seen.add(position);
      ordered.push(position);
    }
  }
  for (const position of positions) {
    if (!seen.has(position)) {
      seen.add(position);
      ordered.push(position);
    }
  }
  return ordered.join('/');
}
