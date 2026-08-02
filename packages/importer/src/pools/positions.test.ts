import { describe, expect, it } from 'vitest';
import { normalizePositionLabels, POSITION_LABEL_MAP } from './positions.js';

describe('position label normalization', () => {
  it('maps simple labels to their canonical group', () => {
    expect(normalizePositionLabels(new Set(['SG']))).toEqual({
      canonical: ['G'],
      sourceLabels: ['SG'],
      unknownLabels: [],
    });
    expect(normalizePositionLabels(new Set(['PF']))).toEqual({
      canonical: ['F'],
      sourceLabels: ['PF'],
      unknownLabels: [],
    });
    expect(normalizePositionLabels(new Set(['C']))).toEqual({
      canonical: ['C'],
      sourceLabels: ['C'],
      unknownLabels: [],
    });
  });

  it('maps combo labels to the union of canonical groups', () => {
    expect(normalizePositionLabels(new Set(['G-F']))).toEqual({
      canonical: ['F', 'G'],
      sourceLabels: ['G-F'],
      unknownLabels: [],
    });
    expect(normalizePositionLabels(new Set(['C-F']))).toEqual({
      canonical: ['C', 'F'],
      sourceLabels: ['C-F'],
      unknownLabels: [],
    });
    expect(normalizePositionLabels(new Set(['F-G-C']))).toEqual({
      canonical: ['C', 'F', 'G'],
      sourceLabels: ['F-G-C'],
      unknownLabels: [],
    });
  });

  it('deduplicates and sorts the canonical union across labels', () => {
    expect(normalizePositionLabels(new Set(['SG', 'PG', 'G-F', 'SF']))).toEqual({
      canonical: ['F', 'G'],
      sourceLabels: ['G-F', 'PG', 'SF', 'SG'],
      unknownLabels: [],
    });
  });

  it('keeps the empty-string label as known but contributing no canonical group', () => {
    expect(normalizePositionLabels(new Set(['']))).toEqual({
      canonical: [],
      sourceLabels: [''],
      unknownLabels: [],
    });
  });

  it('collects unknown labels and never feeds the canonical union', () => {
    expect(normalizePositionLabels(new Set(['SG', 'XYZ']))).toEqual({
      canonical: ['G'],
      sourceLabels: ['SG'],
      unknownLabels: ['XYZ'],
    });
  });

  it('reports every label in POSITION_LABEL_MAP as known', () => {
    for (const label of Object.keys(POSITION_LABEL_MAP)) {
      const result = normalizePositionLabels(new Set([label]));
      expect(result.unknownLabels).toEqual([]);
    }
  });
});
