import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  franchiseEraPoolSchema,
  hoopRushManifestSchema,
  type PeakPlayerSeason,
} from '@hoop-rush/data-contracts';
import { makeReport, EXIT_USAGE_OR_DATA_ERROR, type CliReport } from '../report.ts';
import { defenseBpmCorrelationReportSchema } from '../report-schemas.ts';
import { tryReadJson } from '../io.ts';

export const DATA_DEFENSE_BPM_CORRELATION_OPTIONS: Record<string, boolean> = {
  input: true,
  format: true,
};

interface DefenseBpmCorrelationOptions {
  input: string;
}

export function pearsonCorrelation(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n !== ys.length || n < 2) return null;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = (xs[i] ?? 0) - meanX;
    const dy = (ys[i] ?? 0) - meanY;
    sumXX += dx * dx;
    sumYY += dy * dy;
    sumXY += dx * dy;
  }
  const denominator = Math.sqrt(sumXX * sumYY);
  if (denominator === 0 || !Number.isFinite(denominator)) return null;
  const r = sumXY / denominator;
  return Number.isFinite(r) ? r : null;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function defenseBpmCorrelation(options: DefenseBpmCorrelationOptions): CliReport {
  const rawManifest = tryReadJson(options.input);
  const parsedManifest = hoopRushManifestSchema.safeParse(rawManifest);
  if (!parsedManifest.success) {
    const issue = parsedManifest.error.issues[0];
    return makeReport(
      'data defense-bpm-correlation',
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
  const rawNbaRoot = resolve(manifestDir, '../../../../raw-data/nba');
  const failures: string[] = [];

  const rows: PeakPlayerSeason[] = [];
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

  const seasonStatsCache = new Map<string, Map<string, number | null>>();
  const loadSeasonStats = (seasonKey: string): Map<string, number | null> => {
    const cached = seasonStatsCache.get(seasonKey);
    if (cached !== undefined) return cached;
    const byPlayer = new Map<string, number | null>();
    const raw = tryReadJson(join(rawNbaRoot, seasonKey, 'season-stats.json'));
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        const record = entry as Record<string, unknown>;
        const pid = typeof record.playerExternalId === 'string' ? record.playerExternalId : '';
        const bpm = record.boxPlusMinus;
        if (pid === '') continue;
        if (typeof bpm === 'number' && Number.isFinite(bpm)) {
          byPlayer.set(pid, bpm);
        } else {
          byPlayer.set(pid, null);
        }
      }
    }
    seasonStatsCache.set(seasonKey, byPlayer);
    return byPlayer;
  };

  const xs: number[] = [];
  const ys: number[] = [];
  const perEra: Record<string, { sample: number; xs: number[]; ys: number[] }> = {};
  let excluded = 0;
  for (const row of rows) {
    const bpm = loadSeasonStats(row.seasonKey).get(row.playerExternalId);
    if (bpm === undefined || bpm === null) {
      excluded += 1;
      continue;
    }
    xs.push(row.summaryRatings.defenseRating);
    ys.push(bpm);
    const era = perEra[row.eraId] ?? { sample: 0, xs: [], ys: [] };
    era.xs.push(row.summaryRatings.defenseRating);
    era.ys.push(bpm);
    perEra[row.eraId] = era;
  }

  const r = pearsonCorrelation(xs, ys);
  const pass = xs.length >= 1000 && r !== null && r <= 0.92;
  if (xs.length < 1000) {
    failures.push(`defense-bpm: sample ${String(xs.length)} below the 1000-row gate`);
  }
  if (r !== null && r > 0.92) {
    failures.push(`defense-bpm: correlation ${String(round4(r))} exceeds the 0.92 gate`);
  }

  const eraCorrelations = Object.entries(perEra)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([eraId, era]) => {
      const correlation = pearsonCorrelation(era.xs, era.ys);
      return {
        eraId,
        sample: era.xs.length,
        correlation: correlation === null ? null : round4(correlation),
      };
    });

  const details = [
    `raw data root: ${rawNbaRoot}`,
    `matched ${String(xs.length)} of ${String(rows.length)} player-seasons (${String(excluded)} without box plus/minus)`,
    r === null
      ? 'correlation: undefined (insufficient or constant sample)'
      : `correlation r = ${String(round4(r))} (n=${String(xs.length)})`,
    ...eraCorrelations.map(
      (era) =>
        `${era.eraId}: r=${era.correlation === null ? '—' : String(era.correlation)} (n=${String(era.sample)})`,
    ),
  ];

  return makeReport(
    'data defense-bpm-correlation',
    { input: options.input, dataVersion: manifest.dataVersion },
    {
      details,
      failures,
      payload: defenseBpmCorrelationReportSchema.parse({
        schemaVersion: 1,
        command: 'data defense-bpm-correlation',
        dataVersion: manifest.dataVersion,
        totalRows: rows.length,
        sample: xs.length,
        excluded,
        correlation: r === null ? null : round4(r),
        pass,
        perEra: eraCorrelations,
      }),
    },
  );
}
