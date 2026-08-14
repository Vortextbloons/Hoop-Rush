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

const formatPositionsCache = new WeakMap<readonly string[], string>();

export function formatPositions(positions: readonly string[]): string {
  const cached = formatPositionsCache.get(positions);
  if (cached !== undefined) return cached;
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
  const result = ordered.join('/');
  formatPositionsCache.set(positions, result);
  return result;
}
