import { describe, expect, it } from 'vitest';
import type { ProjectionModelArtifact } from '@hoop-rush/data-contracts';
import { normalizeComponent } from './ranking.ts';
import { buildProjectionModel } from './projection.test-helpers.ts';

describe('normalizeComponent', () => {
  it('keeps higher-is-better components unchanged', () => {
    const model = buildProjectionModel();
    expect(normalizeComponent(model, 'offensiveRating', 105)).toBeCloseTo(50, 9);
    expect(normalizeComponent(model, 'offensiveRating', 115)).toBeCloseTo(60, 9);
    expect(normalizeComponent(model, 'offensiveRating', 95)).toBeCloseTo(40, 9);
  });
  it('inverts lower-is-better components around their baseline', () => {
    const model = buildProjectionModel();
    expect(normalizeComponent(model, 'defensiveRatingAllowed', 105)).toBeCloseTo(50, 9);
    expect(normalizeComponent(model, 'defensiveRatingAllowed', 95)).toBeCloseTo(60, 9);
    expect(normalizeComponent(model, 'defensiveRatingAllowed', 115)).toBeCloseTo(40, 9);
    expect(normalizeComponent(model, 'turnoverRate', 0.14)).toBeCloseTo(50, 9);
    expect(normalizeComponent(model, 'turnoverRate', 0.1)).toBeCloseTo(54, 9);
    expect(normalizeComponent(model, 'turnoverRate', 0.2)).toBeCloseTo(44, 9);
  });
  it('honors an explicit scale direction over the default', () => {
    const model = buildProjectionModel();
    const flipped: ProjectionModelArtifact = {
      ...model,
      scales: {
        ...model.scales,
        defensiveRatingAllowed: {
          baseline: 105,
          perPoint: 1,
          min: 0,
          max: 100,
          higherIsBetter: true,
        },
      },
    };
    expect(normalizeComponent(flipped, 'defensiveRatingAllowed', 115)).toBeCloseTo(60, 9);
  });
});
