import { readFile } from 'node:fs/promises';
import {
  hoopRushManifestSchema,
  type CoverageSummary,
  type HoopRushManifest,
} from '@hoop-rush/data-contracts';
import { FIELD_AVAILABILITY } from '@hoop-rush/importer';
import { makeReport, EXIT_USAGE_OR_DATA_ERROR, type CliReport } from '../report.ts';
import { DEFAULT_MANIFEST } from './data-loader.ts';

/**
 * `hoop-rush data coverage`: field availability, provenance, confidence,
 * missingness, and playable status by season, era, franchise, and pool
 * (spec/09, spec/12). Reads the packaged manifest and its availability
 * matrix plus the persisted coverage report; never scans raw records.
 */

export const DATA_COVERAGE_OPTIONS: Record<string, boolean> = {
  input: true,
  franchise: true,
  era: true,
  status: true,
  format: true,
  verbose: false,
};

interface CoverageRow {
  franchiseId: string;
  eraId: string;
  status: 'available' | 'unavailable';
  reason?: string;
  firstSupportedSeason?: string;
  playerCount?: number;
  coverageSummary?: CoverageSummary;
}

interface CoverageReportPayload {
  dataVersion: string;
  matrixSize: number;
  available: number;
  unavailable: number;
  byReason: Record<string, number>;
  byBand: Record<string, number>;
  /** Field families and their first published season (source availability). */
  fieldAvailability: Array<{ field: string; firstSeason: string | null }>;
  rows: CoverageRow[];
}

export async function dataCoverage(args: {
  input?: string | null;
  franchise?: string | null;
  era?: string | null;
  status?: string | null;
}): Promise<CliReport> {
  const inputPath = args.input ?? DEFAULT_MANIFEST;
  let raw: string;
  try {
    raw = await readFile(inputPath, 'utf8');
  } catch {
    return makeReport(
      'data coverage',
      { input: inputPath },
      {
        failures: [`manifest not found or unreadable: ${inputPath}`],
        exitCode: EXIT_USAGE_OR_DATA_ERROR,
      },
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return makeReport(
      'data coverage',
      { input: inputPath },
      {
        failures: [`manifest is not valid JSON: ${inputPath}`],
        exitCode: EXIT_USAGE_OR_DATA_ERROR,
      },
    );
  }
  const parsed = hoopRushManifestSchema.safeParse(value);
  if (!parsed.success) {
    return makeReport(
      'data coverage',
      { input: inputPath },
      {
        failures: [`manifest fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`],
        exitCode: EXIT_USAGE_OR_DATA_ERROR,
      },
    );
  }
  const manifest: HoopRushManifest = parsed.data;

  let rows: CoverageRow[] = manifest.availability.map((entry) => {
    if (entry.status === 'available') {
      return {
        franchiseId: entry.franchiseId,
        eraId: entry.eraId,
        status: 'available',
        playerCount: entry.playerCount,
        coverageSummary: entry.coverageSummary,
      };
    }
    return {
      franchiseId: entry.franchiseId,
      eraId: entry.eraId,
      status: 'unavailable',
      reason: entry.reason,
      firstSupportedSeason: entry.firstSupportedSeason,
      detail: entry.detail,
    };
  });

  if (args.franchise) rows = rows.filter((row) => row.franchiseId === args.franchise);
  if (args.era) rows = rows.filter((row) => row.eraId === args.era);
  if (args.status) rows = rows.filter((row) => row.status === args.status);

  const available = rows.filter((row) => row.status === 'available');
  const byReason: Record<string, number> = {};
  const byBand: Record<string, number> = {};
  for (const row of rows) {
    if (row.reason) byReason[row.reason] = (byReason[row.reason] ?? 0) + 1;
    if (row.coverageSummary) {
      const band = row.coverageSummary.coverageBand;
      byBand[band] = (byBand[band] ?? 0) + 1;
    }
  }

  const payload: CoverageReportPayload = {
    dataVersion: manifest.dataVersion,
    matrixSize: rows.length,
    available: available.length,
    unavailable: rows.length - available.length,
    byReason,
    byBand,
    fieldAvailability: Object.entries(FIELD_AVAILABILITY).map(([field, firstSeason]) => ({
      field,
      firstSeason,
    })),
    rows,
  };

  const details = [
    `dataVersion ${manifest.dataVersion}`,
    `${String(available.length)}/${String(rows.length)} pools available (${JSON.stringify(byBand)})`,
    `unavailable by reason: ${JSON.stringify(byReason)}`,
  ];
  for (const row of available.slice(0, 10)) {
    const summary = row.coverageSummary;
    details.push(
      `${row.franchiseId}/${row.eraId}: ${String(row.playerCount)} players · ${summary?.coverageBand ?? 'n/a'} · lowConfidence ${String(summary?.lowConfidenceShare)}`,
    );
  }
  return makeReport(
    'data coverage',
    { input: inputPath, franchise: args.franchise ?? null, era: args.era ?? null },
    { details, payload },
  );
}

export { DEFAULT_MANIFEST };
