import { POSITION_NORMALIZATION_VERSION, type Position } from '@hoop-rush/data-contracts';
import type { PositionOverride } from '../positions/overrides.ts';
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
export function normalizePositionLabels(
  labels: ReadonlySet<string> | readonly string[],
): NormalizedPositionLabels {
  const detailed = new Set<Position>();
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
export interface PlayerPositionRecord {
  primary: Position;
  secondary: Position[];
  playable: Position[];
  sourceLabels: string[];
  normalizationVersion: string;
}
export function buildPlayerPositions(input: {
  careerLabels: ReadonlySet<string> | readonly string[];
  peakPrimary: string;
  peakSecondary: readonly string[];
  override?: PositionOverride | null;
}): {
  record: PlayerPositionRecord;
  unknownLabels: string[];
} {
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
  const careerUnion = normalizePositionLabels(careerLabels).detailed;
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
