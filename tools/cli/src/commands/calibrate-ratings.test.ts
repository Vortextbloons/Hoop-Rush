import { describe, expect, it } from 'vitest';
import { RATINGS_VERSION, RATING_MODEL_VERSION } from '@hoop-rush/data-contracts';
import { DEFAULT_RATINGS_MODEL_ARTIFACT } from '@hoop-rush/importer';
import { buildRatingsModelArtifact, calibrationConfidence } from './calibrate-ratings.js';

describe('calibrationConfidence', () => {
  it('is the fraction of the confidence target reached by the samples', () => {
    expect(calibrationConfidence(256, 256)).toBe(1);
    expect(calibrationConfidence(128, 256)).toBe(0.5);
    expect(calibrationConfidence(300, 256)).toBe(1);
    expect(calibrationConfidence(0, 256)).toBe(0);
    expect(calibrationConfidence(64, 256)).toBe(0.25);
  });
});

describe('buildRatingsModelArtifact', () => {
  const loaded = {
    ...DEFAULT_RATINGS_MODEL_ARTIFACT,
    // The previous run's actual sample count is 512; the declared
    // confidence target is 256. Confidence must track the target, not the
    // previous artifact's sample count.
    sampleCountPerContext: 512,
  };
  const samples = 128;
  const playerAdjustments = {
    'player-a': {
      adjustment: 1.25,
      confidence: calibrationConfidence(samples, loaded.confidenceTargetSamplesPerContext),
      sampleCount: samples * loaded.contexts.length,
    },
    'player-b': {
      adjustment: -0.5,
      confidence: calibrationConfidence(samples, loaded.confidenceTargetSamplesPerContext),
      sampleCount: samples * loaded.contexts.length,
    },
  };

  it('records the actual samples under sampleCountPerContext', () => {
    const output = buildRatingsModelArtifact({ artifact: loaded, playerAdjustments, samples });
    expect(output.sampleCountPerContext).toBe(samples);
  });

  it('carries the confidence target through from the loaded artifact', () => {
    const output = buildRatingsModelArtifact({ artifact: loaded, playerAdjustments, samples });
    expect(output.confidenceTargetSamplesPerContext).toBe(loaded.confidenceTargetSamplesPerContext);
    expect(output.confidenceTargetSamplesPerContext).not.toBe(loaded.sampleCountPerContext);
  });

  it('records per-player confidence against the target, not the previous sample count', () => {
    const output = buildRatingsModelArtifact({ artifact: loaded, playerAdjustments, samples });
    for (const entry of Object.values(output.playerAdjustments ?? {})) {
      expect(entry.confidence).toBe(
        calibrationConfidence(
          output.sampleCountPerContext,
          output.confidenceTargetSamplesPerContext,
        ),
      );
      // Regression guard for the old bug shape: the previous artifact's
      // sample count (512) must not shrink confidence to 128/512 = 0.25.
      expect(entry.confidence).toBe(0.5);
    }
  });

  it('advances model and ratings versions while keeping the schema version', () => {
    const output = buildRatingsModelArtifact({ artifact: loaded, playerAdjustments, samples });
    expect(output.schemaVersion).toBe(2);
    expect(output.modelVersion).toBe(RATING_MODEL_VERSION);
    expect(output.ratingsVersion).toBe(RATINGS_VERSION);
  });
});
