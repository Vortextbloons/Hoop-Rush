import { join } from 'node:path';
import {
  RATINGS_VERSION,
  RATING_MODEL_VERSION,
  ratingsModelArtifactSchema,
  type RatingsModelArtifact,
} from '@hoop-rush/data-contracts';
import { fileExists, readJson } from '../json.js';
import { PUBLIC_DATA } from '../config.js';

/** The checked-in fallback is itself a frozen artifact, never an implicit sim. */
export const DEFAULT_RATINGS_MODEL_ARTIFACT: RatingsModelArtifact = {
  schemaVersion: 2,
  modelVersion: RATING_MODEL_VERSION,
  ratingsVersion: RATINGS_VERSION,
  benchmarkVersion: 'ratings-benchmarks-v1',
  seedVersion: 'ratings-seeds-v1',
  confidenceTargetSamplesPerContext: 256,
  sampleCountPerContext: 256,
  contexts: ['weak', 'average', 'strong', 'interior-heavy', 'perimeter-heavy'],
  mapping: {
    impactPerNetRating: 0.22,
    impactPerWinProbability: 8,
    impactPerEfficiency: 0.12,
    impactPerDefensiveEfficiency: 0.08,
    impactPerTurnovers: 0.15,
    impactPerRebound: 0.1,
    impactPerShotQuality: 4,
    shrinkageGames: 120,
  },
  distributionTargets: { exceptionalMin: 95, mvpMin: 90, rotationMax: 89 },
  regressionGates: [],
  generatedAt: '2026-08-03T00:00:00.000Z',
};

/** Load the generated calibration artifact used by rating builds. */
export function loadRatingsModelArtifact(
  path = join(PUBLIC_DATA, 'ratings-model.json'),
): RatingsModelArtifact {
  if (!fileExists(path)) return DEFAULT_RATINGS_MODEL_ARTIFACT;
  const parsed = ratingsModelArtifactSchema.safeParse(readJson(path));
  if (!parsed.success) {
    throw new Error(
      `ratings model artifact ${path} fails validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  if (parsed.data.ratingsVersion !== RATINGS_VERSION) {
    throw new Error(
      `ratings model artifact ${path} is ${parsed.data.ratingsVersion}; expected ${RATINGS_VERSION}`,
    );
  }
  if (parsed.data.modelVersion !== RATING_MODEL_VERSION) {
    throw new Error(
      `ratings model artifact ${path} is ${parsed.data.modelVersion}; expected ${RATING_MODEL_VERSION}`,
    );
  }
  return parsed.data;
}
