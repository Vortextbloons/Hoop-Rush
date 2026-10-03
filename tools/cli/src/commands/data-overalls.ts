import { dirname, isAbsolute, resolve } from 'node:path';
import {
  franchiseEraPoolSchema,
  hoopRushManifestSchema,
  type PeakPlayerSeason,
} from '@hoop-rush/data-contracts';
import { makeReport, EXIT_USAGE_OR_DATA_ERROR, type CliReport } from '../report.ts';
import { tryReadJson } from '../io.ts';

export interface OverallPoolFilter {
  franchise?: string;
  era?: string;
}

export type OverallManifest = ReturnType<typeof hoopRushManifestSchema.parse>;

export function parseOverallManifest(
  input: string,
): { manifest: OverallManifest } | { failure: string } {
  const rawManifest = tryReadJson(input);
  const parsedManifest = hoopRushManifestSchema.safeParse(rawManifest);
  if (!parsedManifest.success) {
    const issue = parsedManifest.error.issues[0];
    return {
      failure: `manifest: ${input} is missing or invalid (${issue?.path.join('.') ?? 'root'} ${issue?.message ?? 'invalid'})`,
    };
  }
  return { manifest: parsedManifest.data };
}

export function poolInvalidLine(
  poolRef: { franchiseId: string; eraId: string; url: string },
  issue: unknown,
): string {
  const record =
    typeof issue === 'object' && issue !== null
      ? (issue as { path?: unknown; message?: unknown })
      : null;
  const path = Array.isArray(record?.path)
    ? record.path.map((part) => String(part)).join('.')
    : 'root';
  const rawMessage = record?.message;
  const message = typeof rawMessage === 'string' ? rawMessage : 'invalid';
  return `pool ${poolRef.franchiseId}/${poolRef.eraId}: ${poolRef.url} is invalid (${path} ${message})`;
}

export function loadOverallRows(
  input: string,
  filter: OverallPoolFilter = {},
):
  | { manifest: OverallManifest; rows: PeakPlayerSeason[]; failures: string[] }
  | { failure: string } {
  const parsed = parseOverallManifest(input);
  if ('failure' in parsed) return parsed;
  const manifestDir = dirname(resolve(input));
  const rows: PeakPlayerSeason[] = [];
  const failures: string[] = [];
  for (const poolRef of parsed.manifest.pools) {
    if (filter.franchise !== undefined && poolRef.franchiseId !== filter.franchise) continue;
    if (filter.era !== undefined && poolRef.eraId !== filter.era) continue;
    const assetPath = isAbsolute(poolRef.url) ? poolRef.url : resolve(manifestDir, poolRef.url);
    const parsedPool = franchiseEraPoolSchema.safeParse(tryReadJson(assetPath));
    if (!parsedPool.success) {
      failures.push(poolInvalidLine(poolRef, parsedPool.error.issues[0]));
      continue;
    }
    rows.push(...parsedPool.data.players);
  }
  return { manifest: parsed.manifest, rows, failures };
}

export function manifestErrorReport(
  command: string,
  input: Record<string, unknown>,
  failure: string,
): CliReport {
  return makeReport(command, input, { failures: [failure], exitCode: EXIT_USAGE_OR_DATA_ERROR });
}
export const DATA_OVERALLS_OPTIONS: Record<string, boolean> = {
  input: true,
  franchise: true,
  era: true,
  player: true,
  limit: true,
  format: true,
};
interface DataOverallsOptions {
  input: string;
  franchise?: string;
  era?: string;
  player?: string;
  limit?: string;
}
interface OverallRow {
  playerId: string;
  displayName: string;
  franchiseId: string;
  eraId: string;
  seasonKey: string;
  positions: string;
  detailedOverall: number | null;
  summaryOverall: number;
  selectionScore: number;
  selectionScoreVersion: string;
}
function rowFromPlayer(player: PeakPlayerSeason): OverallRow {
  return {
    playerId: player.playerId,
    displayName: player.displayName,
    franchiseId: player.franchiseId,
    eraId: player.eraId,
    seasonKey: player.seasonKey,
    positions: player.positions.playable.join('/'),
    detailedOverall: null,
    summaryOverall: player.summaryRatings.overallRating,
    selectionScore: player.selectionScore,
    selectionScoreVersion: player.selectionScoreVersion,
  };
}
function parseLimit(raw: string | undefined): number | null {
  if (raw === undefined) return 50;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return null;
  return limit;
}
export function dataOveralls(options: DataOverallsOptions): CliReport {
  const limit = parseLimit(options.limit);
  const input = {
    manifest: options.input,
    franchise: options.franchise ?? null,
    era: options.era ?? null,
    player: options.player ?? null,
    limit: limit ?? options.limit ?? null,
  };
  if (limit === null) {
    return makeReport('data overalls', input, {
      failures: ['--limit must be an integer from 1 to 1000'],
      exitCode: EXIT_USAGE_OR_DATA_ERROR,
    });
  }
  const loaded = loadOverallRows(options.input, {
    ...(options.franchise === undefined ? {} : { franchise: options.franchise }),
    ...(options.era === undefined ? {} : { era: options.era }),
  });
  if ('failure' in loaded) {
    return manifestErrorReport('data overalls', input, loaded.failure);
  }
  const { manifest, failures } = loaded;
  const nameFilter = options.player?.toLocaleLowerCase();
  const rows: OverallRow[] = [];
  for (const player of loaded.rows) {
    if (nameFilter !== undefined && !player.displayName.toLocaleLowerCase().includes(nameFilter)) {
      continue;
    }
    rows.push(rowFromPlayer(player));
  }
  rows.sort(
    (a, b) =>
      (b.detailedOverall ?? -1) - (a.detailedOverall ?? -1) ||
      b.summaryOverall - a.summaryOverall ||
      b.selectionScore - a.selectionScore ||
      a.displayName.localeCompare(b.displayName),
  );
  const displayed = rows.slice(0, limit);
  const details = [
    `matched ${String(rows.length)} player-seasons; showing ${String(displayed.length)}`,
    'detailed | summary | selection | player | season | franchise/era | positions',
    ...displayed.map(
      (row) =>
        `${String(row.detailedOverall ?? '—').padStart(8)} | ${String(row.summaryOverall).padStart(7)} | ${row.selectionScore.toFixed(3).padStart(9)} | ${row.displayName} | ${row.seasonKey} | ${row.franchiseId}/${row.eraId} | ${row.positions}`,
    ),
  ];
  return makeReport('data overalls', input, {
    details,
    failures,
    exitCode: failures.length === 0 ? undefined : 1,
    payload: {
      dataVersion: manifest.dataVersion,
      count: rows.length,
      displayed: displayed.length,
      players: displayed,
    },
  });
}
