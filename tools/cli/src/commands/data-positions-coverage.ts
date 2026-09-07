import { dirname, isAbsolute, resolve } from 'node:path';
import {
  franchiseEraPoolSchema,
  hoopRushManifestSchema,
  type PeakPlayerSeason,
} from '@hoop-rush/data-contracts';
import { makeReport, EXIT_USAGE_OR_DATA_ERROR, type CliReport } from '../report.ts';
import { positionsCoverageReportSchema } from '../report-schemas.ts';
import { tryReadJson } from '../io.ts';

export const DATA_POSITIONS_COVERAGE_OPTIONS: Record<string, boolean> = {
  input: true,
  format: true,
};

interface DataPositionsCoverageOptions {
  input: string;
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

export function dataPositionsCoverage(options: DataPositionsCoverageOptions): CliReport {
  const rawManifest = tryReadJson(options.input);
  const parsedManifest = hoopRushManifestSchema.safeParse(rawManifest);
  if (!parsedManifest.success) {
    const issue = parsedManifest.error.issues[0];
    return makeReport(
      'data positions-coverage',
      { input: options.input },
      {
        failures: [
          `manifest: ${options.input} is missing or invalid (${issue?.path.join('.') ?? 'root'} ${issue?.message ?? 'invalid'})`,
        ],
        exitCode: EXIT_USAGE_OR_DATA_ERROR,
      },
    );
  }
  const manifest = parsedManifest.data;
  const manifestDir = dirname(resolve(options.input));
  const rows: PeakPlayerSeason[] = [];
  const failures: string[] = [];
  for (const poolRef of manifest.pools) {
    const assetPath = isAbsolute(poolRef.url) ? poolRef.url : resolve(manifestDir, poolRef.url);
    const parsedPool = franchiseEraPoolSchema.safeParse(tryReadJson(assetPath));
    if (!parsedPool.success) {
      const issue = parsedPool.error.issues[0];
      failures.push(
        `pool ${poolRef.franchiseId}/${poolRef.eraId}: ${poolRef.url} is invalid (${issue?.path.join('.') ?? 'root'} ${issue?.message ?? 'invalid'})`,
      );
      continue;
    }
    rows.push(...parsedPool.data.players);
  }
  if (failures.length > 0) {
    return makeReport(
      'data positions-coverage',
      { input: options.input },
      { failures, exitCode: 1 },
    );
  }

  const total = rows.length;
  const primary: Record<string, number> = {};
  const playable: Record<string, number> = {};
  const sourceLabels: Record<string, number> = {};
  const perEra: Record<string, { count: number; primary: Record<string, number> }> = {};
  for (const row of rows) {
    increment(primary, row.positions.primary);
    for (const position of row.positions.playable) increment(playable, position);
    for (const label of row.positions.sourceLabels) increment(sourceLabels, label);
    const era = perEra[row.eraId] ?? { count: 0, primary: {} };
    era.count += 1;
    increment(era.primary, row.positions.primary);
    perEra[row.eraId] = era;
  }

  const gateFailures: string[] = [];
  if ((primary['PG'] ?? 0) === 0) {
    gateFailures.push(
      'positions: zero PG primaries packaged (source roster labels only emit SG/SF/C; PG/PF cannot survive position-v3 normalization)',
    );
  }
  const pfShare = total > 0 ? (primary['PF'] ?? 0) / total : 0;
  if (pfShare < 0.01) {
    gateFailures.push(
      `positions: PF primaries below 1% (${String(primary['PF'] ?? 0)}/${String(total)}); true power forwards collapse to SF`,
    );
  }

  const formatCounts = (record: Record<string, number>): string =>
    Object.entries(record)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, count]) => `${key} ${String(count)}`)
      .join(' | ');
  const details = [
    `matched ${String(total)} player-seasons across ${String(manifest.pools.length)} pools`,
    `primary | ${formatCounts(primary)}`,
    `playable | ${formatCounts(playable)}`,
    `sourceLabels | ${formatCounts(sourceLabels)}`,
    ...Object.entries(perEra)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([eraId, era]) => `${eraId}: n=${String(era.count)} primary ${formatCounts(era.primary)}`,
      ),
  ];

  return makeReport(
    'data positions-coverage',
    { input: options.input, dataVersion: manifest.dataVersion },
    {
      details,
      failures: gateFailures,
      exitCode: gateFailures.length === 0 ? undefined : 1,
      payload: positionsCoverageReportSchema.parse({
        schemaVersion: 1,
        command: 'data positions-coverage',
        dataVersion: manifest.dataVersion,
        total,
        primary,
        playable,
        sourceLabels,
        perEra,
      }),
    },
  );
}
