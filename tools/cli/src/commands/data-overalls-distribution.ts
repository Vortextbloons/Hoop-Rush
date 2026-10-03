import {
  COHORT_NORMALIZATION_VERSION,
  OVERALL_BANDS,
  type PeakPlayerSeason,
} from '@hoop-rush/data-contracts';
import { makeReport, type CliReport } from '../report.ts';
import { overallsDistributionReportSchema } from '../report-schemas.ts';
import { loadOverallRows, manifestErrorReport } from './data-overalls.ts';
export const DATA_OVERALLS_DISTRIBUTION_OPTIONS: Record<string, boolean> = {
  input: true,
  format: true,
};
interface DataOverallsDistributionOptions {
  input: string;
}
const BANDS: ReadonlyArray<{
  label: string;
  min: number;
  max: number;
  targetPercent: number;
}> = OVERALL_BANDS.map((band) => ({
  label: band.label,
  min: band.min,
  max: band.max,
  targetPercent: Math.round(band.share * 1000) / 10,
}));
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}
function bandStats(
  values: readonly number[],
  total: number,
  band: (typeof BANDS)[number],
): (typeof BANDS)[number] & {
  count: number;
  percentage: number;
  median: number | null;
} {
  return {
    ...band,
    count: values.length,
    percentage: total > 0 ? Math.round((values.length / total) * 1000) / 10 : 0,
    median: median(values),
  };
}
function bandsFor(rows: readonly PeakPlayerSeason[], total: number) {
  return BANDS.map((band) =>
    bandStats(
      rows
        .filter(
          (row) =>
            row.summaryRatings.overallRating >= band.min &&
            row.summaryRatings.overallRating <= band.max,
        )
        .map((row) => row.summaryRatings.overallRating),
      total,
      band,
    ),
  );
}
export function dataOverallsDistribution(options: DataOverallsDistributionOptions): CliReport {
  const loaded = loadOverallRows(options.input);
  if ('failure' in loaded) {
    return manifestErrorReport(
      'data overalls-distribution',
      { input: options.input },
      loaded.failure,
    );
  }
  const { manifest, rows, failures } = loaded;
  const total = rows.length;
  const bands = bandsFor(rows, total);
  const allValues = rows.map((row) => row.summaryRatings.overallRating);
  const overallMedian = median(allValues);
  const overallMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  const overallMax = allValues.length > 0 ? Math.max(...allValues) : 0;
  const eraIds = [...new Set(rows.map((row) => row.eraId))].sort();
  const perEra = Object.fromEntries(
    eraIds.map((eraId) => {
      const eraRows = rows.filter((row) => row.eraId === eraId);
      return [eraId, { count: eraRows.length, bands: bandsFor(eraRows, eraRows.length) }];
    }),
  );
  const details = [
    `matched ${String(total)} player-seasons across ${String(manifest.pools.length)} pools`,
    'band | count | pct | target | median | min | max',
    ...bands.map(
      (band) =>
        `${band.label} | ${String(band.count)} | ${String(band.percentage)}% | ${String(band.targetPercent)}% | ${band.median === null ? 'ΓÇö' : String(band.median)} | ${band.count === 0 ? 'ΓÇö' : String(band.min)} | ${band.count === 0 ? 'ΓÇö' : String(band.max)}`,
    ),
    `overall | median ${String(overallMedian)} | min ${String(overallMin)} | max ${String(overallMax)}`,
    ...eraIds.map(
      (eraId) =>
        `${eraId}: n=${String(perEra[eraId]?.count ?? 0)} ${(perEra[eraId]?.bands ?? [])
          .map((band) => `${band.label} ${String(band.count)} (${String(band.percentage)}%)`)
          .join(' ┬╖ ')}`,
    ),
  ];
  return makeReport(
    'data overalls-distribution',
    { input: options.input, dataVersion: manifest.dataVersion },
    {
      details,
      failures,
      exitCode: failures.length === 0 ? undefined : 1,
      payload: overallsDistributionReportSchema.parse({
        schemaVersion: 1,
        command: 'data overalls-distribution',
        dataVersion: manifest.dataVersion,
        cohortVersion: COHORT_NORMALIZATION_VERSION,
        total,
        overall: {
          median: overallMedian,
          range: [overallMin, overallMax],
          min: overallMin,
          max: overallMax,
          sample: total,
        },
        bands,
        perEra,
      }),
    },
  );
}
