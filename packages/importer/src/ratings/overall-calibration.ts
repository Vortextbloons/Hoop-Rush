import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  COHORT_NORMALIZATION_VERSION,
  RATING_MODEL_VERSION,
  RATINGS_VERSION,
  overallBandForPercentile,
  overallScaleSchema,
  ratingsModelArtifactSchema,
  simulationRatingsSchema,
  simulationTendenciesSchema,
  type OverallScale,
  recognitionPriorsSchema,
  individualHonorSchema,
  provenanceMapSchema,
  type IndividualHonor,
  type RecognitionPriors,
} from '@hoop-rush/data-contracts';
import { NBA_ROOT, PUBLIC_DATA, REPO_ROOT } from '../config.ts';
import { fileExists, readJson, writeJsonRetry } from '../json.ts';
import { DEFAULT_RATINGS_MODEL_ARTIFACT } from './artifact.ts';
import { getEra } from './era.ts';
import { deriveRatingProfile, defensiveAbilityFor } from './v3.ts';
import { loadOverallEvidence } from './overall-evidence.ts';

const referenceStatsSchema = z.looseObject({
  playerExternalId: z.string().min(1),
  gamesPlayed: z.number().int().nonnegative(),
  minutes: z.number().nonnegative(),
  ...Object.fromEntries(
    [
      'points',
      'rebounds',
      'assists',
      'steals',
      'blocks',
      'fga',
      'fta',
      'turnovers',
      'tsPct',
      'usageRate',
    ].map((key) => [key, z.number().nullable().optional()]),
  ),
});
const referenceRosterSchema = z.looseObject({
  externalId: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
  heightInches: z.number().nullable().optional(),
  ratings: z.unknown().optional(),
  tendencies: z.unknown().optional(),
  provenance: provenanceMapSchema.optional(),
});
export function fitRecognitionPriors(
  samples: readonly {
    key: string;
    score: number;
    defense: number;
    honors: readonly IndividualHonor[];
  }[],
): RecognitionPriors {
  const byKey = new Map<string, (typeof samples)[number]>();
  for (const sample of samples) {
    const previous = byKey.get(sample.key);
    if (
      previous &&
      (previous.score !== sample.score ||
        previous.defense !== sample.defense ||
        [...previous.honors].sort().join(',') !== [...sample.honors].sort().join(','))
    )
      throw new Error(`conflicting recognition reference season ${sample.key}`);
    byKey.set(sample.key, sample);
  }
  const unique = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  const mean = (values: readonly number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = (values: readonly number[]) => {
    const center = mean(values);
    return (
      values.reduce((sum, value) => sum + (value - center) ** 2, 0) / Math.max(1, values.length - 1)
    );
  };
  const entries: RecognitionPriors['entries'] = {};
  for (const honor of individualHonorSchema.options) {
    const values = unique
      .filter((sample) => sample.honors.includes(honor))
      .map((sample) => (honor.startsWith('DEF') ? sample.defense : sample.score));
    if (values.length >= 2)
      entries[honor] = {
        mean: mean(values),
        variance: Math.max(1, variance(values)),
        sampleCount: values.length,
      };
  }
  return recognitionPriorsSchema.parse({
    version: 'recognition-priors-v1',
    referenceStandardDeviation: Math.sqrt(
      Math.max(1, variance(unique.map((sample) => sample.score))),
    ),
    population: {
      mean: mean(unique.map((sample) => sample.score)),
      variance: Math.max(1, variance(unique.map((sample) => sample.score))),
      sampleCount: unique.length,
    },
    entries,
  });
}

export function buildOverallScale(
  samples: readonly { key: string; score: number }[],
): OverallScale {
  const unique = new Map<string, number>();
  for (const sample of samples) {
    if (!Number.isFinite(sample.score)) throw new Error('reference score must be finite');
    const previous = unique.get(sample.key);
    if (previous !== undefined && previous !== sample.score) {
      throw new Error(`conflicting reference season ${sample.key}`);
    }
    unique.set(sample.key, sample.score);
  }
  const population = [...unique].sort(([a], [b]) => a.localeCompare(b));
  const sorted = population.map(([, score]) => score).sort((a, b) => a - b);
  const knots: OverallScale['knots'] = [];
  for (let i = 0; i < sorted.length;) {
    const score = sorted[i];
    if (score === undefined) break;
    let end = i + 1;
    while (end < sorted.length && sorted[end] === score) end += 1;
    const percentile = 1 - (i + (end - i) / 2) / sorted.length;
    knots.push({ score, overall: overallBandForPercentile(percentile), percentile });
    i = end;
  }
  if (knots.length >= 2) {
    const first = knots[0];
    const last = knots[knots.length - 1];
    if (first !== undefined) knots[0] = { ...first, overall: 40, percentile: 1 };
    if (last !== undefined) {
      knots[knots.length - 1] = { ...last, overall: 99, percentile: 0 };
    }
  }
  return overallScaleSchema.parse({
    schemaVersion: 1,
    version: COHORT_NORMALIZATION_VERSION,
    modelVersion: RATING_MODEL_VERSION,
    reference: {
      firstSeason: '1996-97',
      lastSeason: '2024-25',
      minimumGames: 50,
      minimumMinutes: 1500,
      sampleCount: population.length,
      contentHash: createHash('sha256').update(JSON.stringify(population)).digest('hex'),
    },
    knots,
  });
}

export function calibrateOverallScale(
  output = join(PUBLIC_DATA, 'ratings-model.json'),
): OverallScale {
  output = resolve(REPO_ROOT, output);
  const samples: { key: string; score: number }[] = [];
  const inputs: { key: string; input: Parameters<typeof deriveRatingProfile>[0] }[] = [];
  for (let year = 1996; year <= 2024; year += 1) {
    const season = `${String(year)}-${String((year + 1) % 100).padStart(2, '0')}`;
    const directory = join(NBA_ROOT, season);
    const stats = z
      .array(referenceStatsSchema)
      .parse(readJson(join(directory, 'season-stats.json')));
    const byId = new Map(stats.map((row) => [row.playerExternalId, row]));
    const roster = z.array(referenceRosterSchema).parse(readJson(join(directory, 'roster.json')));
    const era = getEra(season);
    const evidence = loadOverallEvidence(season, true);
    for (const player of roster) {
      const row = byId.get(player.externalId ?? '');
      if (!row || row.gamesPlayed < 50 || row.minutes < 1500) continue;
      const key = `${player.externalId ?? ''}|${season}`;
      const input: Parameters<typeof deriveRatingProfile>[0] = {
        ratings: simulationRatingsSchema.parse(player.ratings),
        tendencies: simulationTendenciesSchema.parse(player.tendencies),
        stats: { ...row, ...evidence.get(player.externalId ?? '') },
        abilityProvenance: player.provenance,
        position: player.position ?? 'SF',
        heightInches: player.heightInches ?? null,
        artifact: DEFAULT_RATINGS_MODEL_ARTIFACT,
        eraPace: era.pace,
        eraThreeRate: era.league3PARate,
      };
      inputs.push({ key, input });
    }
  }
  const recognitionPriors = fitRecognitionPriors(
    inputs.map(({ key, input }) => {
      const profile = deriveRatingProfile(input).profile;
      return {
        key,
        score: profile.rawOverallScore,
        defense: defensiveAbilityFor(input.ratings),
        honors: z.array(individualHonorSchema).parse(input.stats.honors ?? []),
      };
    }),
  );
  for (const { key, input } of inputs)
    samples.push({
      key,
      score: deriveRatingProfile({ ...input, artifact: { ...input.artifact, recognitionPriors } })
        .profile.rawOverallScore,
    });
  const scale = buildOverallScale(samples);
  const existing = fileExists(output) ? ratingsModelArtifactSchema.parse(readJson(output)) : null;
  const artifact = ratingsModelArtifactSchema.parse({
    ...DEFAULT_RATINGS_MODEL_ARTIFACT,
    ...(existing
      ? {
          playerAdjustments: existing.playerAdjustments,
          impactModelVersion: existing.impactModelVersion ?? existing.modelVersion,
        }
      : {}),
    schemaVersion: 4,
    recognitionPriors,
    modelVersion: RATING_MODEL_VERSION,
    ratingsVersion: RATINGS_VERSION,
    overallScale: scale,
    generatedAt: '2026-10-05T00:00:00.000Z',
  });
  writeJsonRetry(output, artifact);
  return scale;
}
