import { describe, expect, it } from 'vitest';
import { RATINGS_VERSION, RATING_MODEL_VERSION } from '@hoop-rush/data-contracts';
import { DEFAULT_RATINGS_MODEL_ARTIFACT } from '@hoop-rush/importer';
import { buildRatingsModelArtifact, calibrationConfidence } from './calibrate-ratings.ts';
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
    it('builds the ratings model artifact with samples, confidence, and version advances', () => {
        const output = buildRatingsModelArtifact({ artifact: loaded, playerAdjustments, samples });
        expect(output.sampleCountPerContext).toBe(samples);
        expect(output.confidenceTargetSamplesPerContext).toBe(loaded.confidenceTargetSamplesPerContext);
        expect(output.confidenceTargetSamplesPerContext).not.toBe(loaded.sampleCountPerContext);
        for (const entry of Object.values(output.playerAdjustments ?? {})) {
            expect(entry.confidence).toBe(calibrationConfidence(output.sampleCountPerContext, output.confidenceTargetSamplesPerContext));
            expect(entry.confidence).toBe(0.5);
        }
        expect(output.schemaVersion).toBe(2);
        expect(output.modelVersion).toBe(RATING_MODEL_VERSION);
        expect(output.ratingsVersion).toBe(RATINGS_VERSION);
    });
});
