import type { Position } from '@hoop-rush/data-contracts';

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
  detailed: Position[];
  sourceLabels: string[];
  unknownLabels: string[];
}

function keyFor(label: string): string {
  return label.trim().toUpperCase();
}

export function positionsForSourceLabel(label: string): readonly Position[] | undefined {
  return POSITION_LABEL_MAP[keyFor(label)];
}

export function normalizePositionLabels(
  labels: ReadonlySet<string> | readonly string[],
): NormalizedPositionLabels {
  const detailed = new Set<Position>();
  const unknownLabels: string[] = [];
  const sourceLabels = [...new Set([...labels].map(String))].sort();
  for (const label of sourceLabels) {
    const mapped = positionsForSourceLabel(label);
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

export function primaryPositionForSource(label: string): Position {
  return positionsForSourceLabel(label)?.[0] ?? 'SF';
}

export function positionGroupForSource(label: string): 'G' | 'F' | 'C' {
  const primary = primaryPositionForSource(label);
  return primary === 'PG' || primary === 'SG' ? 'G' : primary === 'C' ? 'C' : 'F';
}
