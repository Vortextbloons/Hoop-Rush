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
  type OverallScale,
  recognitionPriorsSchema,
  individualHonorSchema,
  type IndividualHonor,
  type RecognitionPriors,
} from '@hoop-rush/data-contracts';
import { NBA_ROOT, PUBLIC_DATA, REPO_ROOT, DEFAULT_SEASONS } from '../config.ts';
import { readJson, writeJsonRetry } from '../json.ts';
import { DEFAULT_RATINGS_MODEL_ARTIFACT } from './artifact.ts';
import { getEra } from './era.ts';
import { derivePlayerRecord } from './v2.ts';
import { eraAdjustmentFor } from './v3.ts';
import { loadThreePointReconstructionArtifact } from '../reconstruction/artifact.ts';
import { loadEvidenceMap } from './compute.ts';
import {
  loadOverallEvidence,
  loadOverallTracking,
  loadPostseasonEvidence,
  loadTeamRecords,
  observedTeamRecord,
} from './overall-evidence.ts';
import { primaryPositionForSource } from '../positions/normalize.ts';
import { positionOverrideFor } from '../positions/overrides.ts';

const referenceStatsSchema = z.looseObject({
  playerExternalId: z.string().min(1),
  gamesPlayed: z.number().int().nonnegative(),
  minutes: z.number().nonnegative().nullable(),
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
  weightLbs: z.number().nullable().optional(),
  age: z.number().nullable().optional(),
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
  reference: Partial<OverallScale['reference']> = {},
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
      ...reference,
    },
    knots,
  });
}

export function calibrateOverallScale(
  output = join(PUBLIC_DATA, 'ratings-model.json'),
): OverallScale {
  output = resolve(REPO_ROOT, output);
  const peaks = new Map<string, { key: string; score: number }>();
  const samples = new Map<
    string,
    { id: string; season: string; base: number; postseason: number; replacement: boolean }
  >();
  const eraSamples = new Map<string, number[]>();
  const threePointReconstruction = loadThreePointReconstructionArtifact();
  const seasons = [...DEFAULT_SEASONS].sort();
  for (const season of seasons) {
    const directory = join(NBA_ROOT, season);
    const stats = z
      .array(referenceStatsSchema)
      .parse(readJson(join(directory, 'season-stats.json')));
    const byId = new Map(stats.map((row) => [row.playerExternalId, row]));
    const roster = z.array(referenceRosterSchema).parse(readJson(join(directory, 'roster.json')));
    const era = getEra(season);
    const evidence = loadOverallEvidence(season, true);
    const tracking = loadOverallTracking(season);
    const overlays = loadEvidenceMap(directory);
    const postseason = loadPostseasonEvidence(season);
    const teamRecords = loadTeamRecords(season);
    for (const player of roster) {
      const id = player.externalId ?? '';
      const row = byId.get(id);
      if (!row || row.minutes === null || row.minutes < 400) continue;
      const derived = derivePlayerRecord({
        season,
        playerId: `p-${id}`,
        stats: { ...row, ...overlays.get(id), ...tracking.get(id), ...evidence.get(id) },
        teamWinPct: observedTeamRecord(row, player.teamExternalId, teamRecords),
        position:
          positionOverrideFor(id)?.primary ?? primaryPositionForSource(player.position ?? 'SF'),
        heightInches: player.heightInches ?? null,
        weightLbs: player.weightLbs ?? null,
        age: player.age ?? null,
        artifact: DEFAULT_RATINGS_MODEL_ARTIFACT,
        era,
        threePointReconstruction,
        postseason: postseason.players.get(id),
        postseasonEvidenceAvailable: postseason.available && !postseason.missingPlayers.has(id),
      });
      const diagnostics = derived.ratingProfile.overallDiagnostics;
      if (diagnostics?.schemaVersion !== 2) throw new Error('Missing value diagnostics');
      const minutesPerGame = row.gamesPlayed > 0 ? row.minutes / row.gamesPlayed : 0;
      samples.set(`${id}|${season}`, {
        id,
        season,
        base:
          diagnostics.rawBeforeRecognition +
          (diagnostics.synergyContribution ?? 0) +
          (diagnostics.weaknessContribution ?? 0) +
          (diagnostics.impactContribution ?? 0) +
          diagnostics.recognitionContribution +
          (diagnostics.teamRecordContribution ?? 0),
        postseason: diagnostics.postseasonContribution ?? 0,
        replacement: minutesPerGame >= 6 && minutesPerGame <= 15,
      });
    }
  }
  for (const sample of samples.values()) {
    const decade = `${String(Math.floor(Number(sample.season.slice(0, 4)) / 10) * 10)}s`;
    const group = eraSamples.get(decade) ?? [];
    group.push(sample.base);
    eraSamples.set(decade, group);
  }
  const referenceFor = (scores: readonly number[]) => {
    const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const variance =
      scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / Math.max(1, scores.length - 1);
    return {
      mean,
      standardDeviation: Math.sqrt(Math.max(1, variance)),
      sampleCount: scores.length,
    };
  };
  const eraReference = referenceFor([...samples.values()].map((sample) => sample.base));
  const eraReferences = Object.fromEntries(
    [...eraSamples].map(([decade, scores]) => [decade, referenceFor(scores)]),
  );
  const referenceArtifact = { ...DEFAULT_RATINGS_MODEL_ARTIFACT, eraReference, eraReferences };
  const replacementSamples: number[] = [];
  for (const [key, sample] of samples) {
    const score =
      Math.round(
        (sample.base +
          eraAdjustmentFor(sample.base, sample.season, referenceArtifact) +
          sample.postseason) *
          10000,
      ) / 10000;
    const previous = peaks.get(sample.id);
    if (!previous || score > previous.score) peaks.set(sample.id, { key, score });
    if (sample.replacement) replacementSamples.push(score);
  }
  const scale = buildOverallScale([...peaks.values()], {
    firstSeason: seasons[0],
    lastSeason: seasons.at(-1),
    minimumGames: 0,
    minimumMinutes: 400,
    population: 'unique-player-peaks',
  });
  if (replacementSamples.length === 0) throw new Error('No replacement-reference evidence');
  const artifact = ratingsModelArtifactSchema.parse({
    ...DEFAULT_RATINGS_MODEL_ARTIFACT,
    schemaVersion: 3,
    eraReference,
    eraReferences,
    replacementReferenceScore:
      replacementSamples.reduce((sum, score) => sum + score, 0) / replacementSamples.length,
    modelVersion: RATING_MODEL_VERSION,
    ratingsVersion: RATINGS_VERSION,
    overallScale: scale,
    generatedAt: '2026-10-23T00:00:00.000Z',
  });
  writeJsonRetry(output, artifact);
  return scale;
}
