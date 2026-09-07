import { dirname, isAbsolute, resolve } from 'node:path';
import {
  franchiseEraPoolSchema,
  hoopRushManifestSchema,
  type PeakPlayerSeason,
} from '@hoop-rush/data-contracts';
import { makeReport, EXIT_USAGE_OR_DATA_ERROR, type CliReport } from '../report.ts';
import { overallsAuditReportSchema } from '../report-schemas.ts';
import { tryReadJson } from '../io.ts';

export const DATA_OVERALLS_AUDIT_OPTIONS: Record<string, boolean> = {
  input: true,
  format: true,
};

interface DataOverallsAuditOptions {
  input: string;
}

export const MINUTES_FLOOR = 1500;
export const MINUTES_FLOOR_OVERALL = 60;
export const YOY_CLIFF_DELTA = 15;
export const CANON_STRETCH_GAP = 20;
export const TOP_BAND_MIN = 97;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function quantile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index] ?? null;
}

function rawOf(row: PeakPlayerSeason): number | null {
  const raw = row.ratingProfile?.rawOverallScore;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

export function dataOverallsAudit(options: DataOverallsAuditOptions): CliReport {
  const rawManifest = tryReadJson(options.input);
  const parsedManifest = hoopRushManifestSchema.safeParse(rawManifest);
  if (!parsedManifest.success) {
    const issue = parsedManifest.error.issues[0];
    return makeReport(
      'data overalls-audit',
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
    return makeReport('data overalls-audit', { input: options.input }, { failures, exitCode: 1 });
  }

  const total = rows.length;
  const rawValues = rows
    .map(rawOf)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  const rowsWithoutRawOverall = total - rawValues.length;
  const rawStats = {
    min: rawValues.length > 0 ? round2(rawValues[0] ?? 0) : null,
    max: rawValues.length > 0 ? round2(rawValues[rawValues.length - 1] ?? 0) : null,
    mean:
      rawValues.length > 0
        ? round2(rawValues.reduce((sum, value) => sum + value, 0) / rawValues.length)
        : null,
    median: quantile(rawValues, 0.5) === null ? null : round2(quantile(rawValues, 0.5) ?? 0),
    p10: quantile(rawValues, 0.1) === null ? null : round2(quantile(rawValues, 0.1) ?? 0),
    p25: quantile(rawValues, 0.25) === null ? null : round2(quantile(rawValues, 0.25) ?? 0),
    p75: quantile(rawValues, 0.75) === null ? null : round2(quantile(rawValues, 0.75) ?? 0),
    p90: quantile(rawValues, 0.9) === null ? null : round2(quantile(rawValues, 0.9) ?? 0),
    p95: quantile(rawValues, 0.95) === null ? null : round2(quantile(rawValues, 0.95) ?? 0),
    p99: quantile(rawValues, 0.99) === null ? null : round2(quantile(rawValues, 0.99) ?? 0),
  };

  const toFlag = (row: PeakPlayerSeason) => ({
    displayName: row.displayName,
    playerExternalId: row.playerExternalId,
    seasonKey: row.seasonKey,
    franchiseId: row.franchiseId,
    eraId: row.eraId,
    overall: row.summaryRatings.overallRating,
    rawOverallScore: rawOf(row) === null ? null : round2(rawOf(row) ?? 0),
    canonicalOverall: row.ratingProfile?.canonicalOverall ?? null,
    minutes: row.stats.minutes,
    games: row.stats.gamesPlayed,
    productionScore:
      typeof row.ratingProfile?.production.score === 'number'
        ? round2(row.ratingProfile.production.score)
        : null,
    productionWeight:
      typeof row.ratingProfile?.production.weight === 'number'
        ? round2(row.ratingProfile.production.weight)
        : null,
    productionConfidence: row.ratingProfile?.production.confidence ?? null,
  });

  const floorViolations = rows
    .filter(
      (row) =>
        row.stats.minutes >= MINUTES_FLOOR &&
        row.summaryRatings.overallRating < MINUTES_FLOOR_OVERALL,
    )
    .map(toFlag)
    .sort((a, b) => b.minutes - a.minutes || a.overall - b.overall);

  const lowConfidenceTop = rows
    .filter(
      (row) =>
        row.summaryRatings.overallRating >= TOP_BAND_MIN &&
        (row.ratingProfile?.production.confidence !== 'high' ||
          row.stats.minutes < MINUTES_FLOOR ||
          row.stats.gamesPlayed < 50),
    )
    .map(toFlag)
    .sort((a, b) => b.overall - a.overall || b.minutes - a.minutes);

  const canonStretch = rows
    .filter(
      (row) =>
        row.ratingProfile !== undefined &&
        Math.abs(row.summaryRatings.overallRating - row.ratingProfile.canonicalOverall) >=
          CANON_STRETCH_GAP,
    )
    .map((row) => ({
      ...toFlag(row),
      stretch: row.summaryRatings.overallRating - (row.ratingProfile?.canonicalOverall ?? 0),
    }))
    .sort((a, b) => Math.abs(b.stretch) - Math.abs(a.stretch))
    .slice(0, 25);

  const byPlayer = new Map<string, PeakPlayerSeason[]>();
  for (const row of rows) {
    const list = byPlayer.get(row.playerExternalId) ?? [];
    list.push(row);
    byPlayer.set(row.playerExternalId, list);
  }
  const yoyCliffs = [];
  for (const list of byPlayer.values()) {
    const sorted = [...list].sort((a, b) => a.seasonKey.localeCompare(b.seasonKey));
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (previous === undefined || current === undefined) continue;
      const delta = current.summaryRatings.overallRating - previous.summaryRatings.overallRating;
      if (Math.abs(delta) >= YOY_CLIFF_DELTA) {
        yoyCliffs.push({
          ...toFlag(current),
          previousSeasonKey: previous.seasonKey,
          previousOverall: previous.summaryRatings.overallRating,
          delta,
        });
      }
    }
  }
  yoyCliffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const yoyTop = yoyCliffs.slice(0, 25);

  const gateFailures: string[] = [];
  if (floorViolations.length > 0) {
    gateFailures.push(
      `minutes floor: ${String(floorViolations.length)} rotation seasons (>=${String(MINUTES_FLOOR)} min) below ${String(MINUTES_FLOOR_OVERALL)} overall`,
    );
  }

  const formatFlag = (flag: {
    displayName: string;
    seasonKey: string;
    overall: number;
    minutes: number;
  }): string =>
    `${flag.displayName} ${flag.seasonKey} ovr=${String(flag.overall)} min=${String(flag.minutes)}`;
  const details = [
    `matched ${String(total)} player-seasons across ${String(manifest.pools.length)} pools (${String(rowsWithoutRawOverall)} without rawOverallScore)`,
    `rawOverallScore | min ${String(rawStats.min)} | p10 ${String(rawStats.p10)} | p25 ${String(rawStats.p25)} | median ${String(rawStats.median)} | p75 ${String(rawStats.p75)} | p90 ${String(rawStats.p90)} | p95 ${String(rawStats.p95)} | p99 ${String(rawStats.p99)} | max ${String(rawStats.max)} | mean ${String(rawStats.mean)}`,
    `floor violations (>=${String(MINUTES_FLOOR)} min & <${String(MINUTES_FLOOR_OVERALL)} ovr): ${String(floorViolations.length)}`,
    ...floorViolations.slice(0, 10).map((flag) => `floor | ${formatFlag(flag)}`),
    `low-confidence top (>=${String(TOP_BAND_MIN)} ovr, confidence!=high or <${String(MINUTES_FLOOR)} min or <50 g): ${String(lowConfidenceTop.length)}`,
    ...lowConfidenceTop.slice(0, 10).map((flag) => `top-risk | ${formatFlag(flag)}`),
    `canon stretch (|overall-canonical|>=${String(CANON_STRETCH_GAP)}): ${String(canonStretch.length)} (showing 10)`,
    ...canonStretch
      .slice(0, 10)
      .map(
        (flag) =>
          `stretch | ${formatFlag(flag)} canon=${String(flag.canonicalOverall)} delta=${String(flag.stretch)}`,
      ),
    `YoY cliffs (|delta|>=${String(YOY_CLIFF_DELTA)}): ${String(yoyCliffs.length)} (showing 10)`,
    ...yoyTop
      .slice(0, 10)
      .map(
        (flag) =>
          `yoy | ${flag.displayName} ${flag.previousSeasonKey} ${String(flag.previousOverall)} -> ${flag.seasonKey} ${String(flag.overall)} (delta ${String(flag.delta)})`,
      ),
  ];

  return makeReport(
    'data overalls-audit',
    { input: options.input, dataVersion: manifest.dataVersion },
    {
      details,
      failures: gateFailures,
      exitCode: gateFailures.length === 0 ? undefined : 1,
      payload: overallsAuditReportSchema.parse({
        schemaVersion: 1,
        command: 'data overalls-audit',
        dataVersion: manifest.dataVersion,
        total,
        rowsWithoutRawOverall,
        raw: rawStats,
        floorViolations,
        lowConfidenceTop,
        canonStretch,
        yoyCliffs: yoyTop,
      }),
    },
  );
}
