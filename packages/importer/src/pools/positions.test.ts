import { describe, expect, it } from 'vitest';
import type { Position } from '@hoop-rush/data-contracts';
import type { PositionOverride } from '../positions/overrides.ts';
import { buildPlayerPositions, normalizePositionLabels, POSITION_LABEL_MAP } from './positions.ts';

describe('position label normalization', () => {
  it('maps simple detailed labels to themselves', () => {
    expect(normalizePositionLabels(new Set(['SG']))).toEqual({
      detailed: ['SG'],
      sourceLabels: ['SG'],
      unknownLabels: [],
    });
    expect(normalizePositionLabels(new Set(['PF']))).toEqual({
      detailed: ['PF'],
      sourceLabels: ['PF'],
      unknownLabels: [],
    });
    expect(normalizePositionLabels(new Set(['C']))).toEqual({
      detailed: ['C'],
      sourceLabels: ['C'],
      unknownLabels: [],
    });
    expect(normalizePositionLabels(new Set(['PG']))).toEqual({
      detailed: ['PG'],
      sourceLabels: ['PG'],
      unknownLabels: [],
    });
    expect(normalizePositionLabels(new Set(['SF']))).toEqual({
      detailed: ['SF'],
      sourceLabels: ['SF'],
      unknownLabels: [],
    });
  });

  it('maps coarse G/F labels to their detailed guards and forwards', () => {
    expect(normalizePositionLabels(new Set(['G']))).toEqual({
      detailed: ['PG', 'SG'],
      sourceLabels: ['G'],
      unknownLabels: [],
    });
    expect(normalizePositionLabels(new Set(['F']))).toEqual({
      detailed: ['PF', 'SF'],
      sourceLabels: ['F'],
      unknownLabels: [],
    });
  });

  it('maps guard/forward combos to every detailed guard or forward', () => {
    expect(normalizePositionLabels(new Set(['G-F']))).toEqual({
      detailed: ['PF', 'PG', 'SF', 'SG'],
      sourceLabels: ['G-F'],
      unknownLabels: [],
    });
    expect(normalizePositionLabels(new Set(['F-G']))).toEqual({
      detailed: ['PF', 'PG', 'SF', 'SG'],
      sourceLabels: ['F-G'],
      unknownLabels: [],
    });
  });

  it('maps forward/center combos to forwards plus center', () => {
    expect(normalizePositionLabels(new Set(['F-C']))).toEqual({
      detailed: ['C', 'PF', 'SF'],
      sourceLabels: ['F-C'],
      unknownLabels: [],
    });
    expect(normalizePositionLabels(new Set(['C-F']))).toEqual({
      detailed: ['C', 'PF', 'SF'],
      sourceLabels: ['C-F'],
      unknownLabels: [],
    });
  });

  it('maps guard/center combos to guards plus center', () => {
    expect(normalizePositionLabels(new Set(['G-C']))).toEqual({
      detailed: ['C', 'PG', 'SG'],
      sourceLabels: ['G-C'],
      unknownLabels: [],
    });
    expect(normalizePositionLabels(new Set(['C-G']))).toEqual({
      detailed: ['C', 'PG', 'SG'],
      sourceLabels: ['C-G'],
      unknownLabels: [],
    });
  });

  it('maps three-letter combos to the full detailed union', () => {
    expect(normalizePositionLabels(new Set(['G-F-C']))).toEqual({
      detailed: ['C', 'PF', 'PG', 'SF', 'SG'],
      sourceLabels: ['G-F-C'],
      unknownLabels: [],
    });
    expect(normalizePositionLabels(new Set(['F-G-C']))).toEqual({
      detailed: ['C', 'PF', 'PG', 'SF', 'SG'],
      sourceLabels: ['F-G-C'],
      unknownLabels: [],
    });
  });

  it('deduplicates and sorts the detailed union across labels', () => {
    expect(normalizePositionLabels(new Set(['SG', 'PG', 'G-F', 'SF']))).toEqual({
      detailed: ['PF', 'PG', 'SF', 'SG'],
      sourceLabels: ['G-F', 'PG', 'SF', 'SG'],
      unknownLabels: [],
    });
  });

  it('keeps the empty-string label as known but contributing no detailed position', () => {
    expect(normalizePositionLabels(new Set(['']))).toEqual({
      detailed: [],
      sourceLabels: [''],
      unknownLabels: [],
    });
  });

  it('preserves unknown labels in sourceLabels and never feeds the detailed union', () => {
    expect(normalizePositionLabels(new Set(['SG', 'XYZ']))).toEqual({
      detailed: ['SG'],
      sourceLabels: ['SG', 'XYZ'],
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

describe('buildPlayerPositions', () => {
  it('applies an override as the authoritative primary and secondary', () => {
    const { record, unknownLabels } = buildPlayerPositions({
      careerLabels: new Set(['SF']),
      peakPrimary: 'SF',
      peakSecondary: [],
      override: { primary: 'C', secondary: ['PF'] },
    });
    expect(record.primary).toBe('C');
    expect(record.secondary).toEqual(['PF']);
    expect(record.playable).toEqual(['C', 'PF']);
    expect(record.sourceLabels).toEqual(['SF']);
    expect(unknownLabels).toEqual([]);
    expect(record.normalizationVersion).toBe('position-v3');
  });

  it('keeps auditing unknown labels even when an override replaces positions', () => {
    const { record, unknownLabels } = buildPlayerPositions({
      careerLabels: new Set(['SF', 'XYZ']),
      peakPrimary: 'SF',
      peakSecondary: [],
      override: { primary: 'C', secondary: ['SF'] },
    });
    expect(record.primary).toBe('C');
    expect(record.playable).toEqual(['C', 'SF']);
    expect(record.sourceLabels).toEqual(['SF', 'XYZ']);
    expect(unknownLabels).toEqual(['XYZ']);
  });

  it('builds primary/secondary/playable from peak labels without an override', () => {
    const { record, unknownLabels } = buildPlayerPositions({
      careerLabels: new Set(['SG', 'G-F']),
      peakPrimary: 'G-F',
      peakSecondary: [],
    });
    expect(record.primary).toBe('PG');
    expect(record.secondary).toEqual([]);
    expect(record.playable).toEqual(['PF', 'PG', 'SF', 'SG']);
    expect(record.sourceLabels).toEqual(['G-F', 'SG']);
    expect(unknownLabels).toEqual([]);
  });

  it('merges career labels, primary, and validated secondary into playable', () => {
    const { record, unknownLabels } = buildPlayerPositions({
      careerLabels: new Set(['SG', 'C']),
      peakPrimary: 'SG',
      peakSecondary: ['SF', 'PF'],
    });
    expect(record.primary).toBe('SG');
    expect(record.secondary).toEqual(['PF', 'SF']);
    expect(record.playable).toEqual(['C', 'PF', 'SF', 'SG']);
    expect(record.sourceLabels).toEqual(['C', 'PF', 'SF', 'SG']);
    expect(unknownLabels).toEqual([]);
  });

  it('falls back to SF for an unknown primary label with an unknownLabels entry', () => {
    const { record, unknownLabels } = buildPlayerPositions({
      careerLabels: new Set(['']),
      peakPrimary: 'XYZ',
      peakSecondary: [],
    });
    expect(record.primary).toBe('SF');
    expect(record.playable).toEqual(['SF']);
    expect(unknownLabels).toEqual(['XYZ']);
  });

  it('falls back to SF for an empty primary label, reporting it in unknownLabels', () => {
    const { record, unknownLabels } = buildPlayerPositions({
      careerLabels: [],
      peakPrimary: '',
      peakSecondary: [],
    });
    expect(record.primary).toBe('SF');
    expect(record.playable).toEqual(['SF']);
    expect(record.sourceLabels).toEqual(['']);
    expect(unknownLabels).toEqual(['']);
  });

  it('records unknown secondary labels in unknownLabels without adding them', () => {
    const { record, unknownLabels } = buildPlayerPositions({
      careerLabels: new Set(['SG']),
      peakPrimary: 'SG',
      peakSecondary: ['NOPE', 'C'],
    });
    expect(record.secondary).toEqual(['C']);
    expect(record.playable).toEqual(['C', 'SG']);
    expect(record.sourceLabels).toEqual(['C', 'NOPE', 'SG']);
    expect(unknownLabels).toEqual(['NOPE']);
  });

  it('throws when the final playable union is empty (schema rejects empty unions)', () => {
    expect(() =>
      buildPlayerPositions({
        careerLabels: [],
        peakPrimary: 'C',
        peakSecondary: [],
        override: {} as PositionOverride,
      }),
    ).toThrow(/empty playable positions/);
  });

  it('derives the same slot-group semantics as the old canonical union', () => {
    const { record } = buildPlayerPositions({
      careerLabels: new Set(['G-F']),
      peakPrimary: 'G-F',
      peakSecondary: [],
    });
    const groups = new Set(
      record.playable.map((p: Position) =>
        p === 'C' ? 'C' : p === 'SF' || p === 'PF' ? 'F' : 'G',
      ),
    );
    expect(groups).toEqual(new Set(['G', 'F']));
  });
});
