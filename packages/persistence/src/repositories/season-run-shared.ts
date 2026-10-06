import {
  emptySeasonPlayerAggregate,
  LIVE_SEASON_RUN_VERSION_MESSAGE,
  SEASON_RUN_SAVE_SCHEMA_VERSION,
  type SeasonPlayerAggregate,
  type SeasonRoster,
} from '@hoop-rush/data-contracts';
import type { Table } from 'dexie';
import type { HoopRushDatabase } from './dexie.ts';
export class SeasonRunLoadError extends Error {
  readonly code: string;
  readonly failures: readonly string[];
  constructor(failures: readonly string[], message?: string, code = 'SEASON_RUN_LOAD_FAILED') {
    super(
      message ??
        `Season Run reload validation failed (${String(failures.length)} failure(s)): ` +
          failures.join('; '),
    );
    this.name = 'SeasonRunLoadError';
    this.code = code;
    this.failures = failures;
  }
}
export function SEASON_RUN_SCOPED_TABLES(db: HoopRushDatabase): Table<unknown>[] {
  return [
    db.seasonRuns,
    db.seasonRunSummaries,
    db.seasonRunDetails,
    db.seasonRunBlocks,
    db.seasonRunIndex,
    db.seasonPendingBlocks,
    db.seasonPostseasonSummaries,
    db.seasonPostseasonDetails,
    db.seasonCommandLog,
    db.seasonAlmanacs,
    db.seasonCompletedRuns,
    db.seasonCompletedIndex,
    db.seasonRunPlayerSlices,
  ] as Table<unknown>[];
}
export function hasUnsupportedSaveSchema(row: unknown): boolean {
  if (typeof row !== 'object' || row === null) return false;
  const version = (
    row as {
      saveSchemaVersion?: unknown;
    }
  ).saveSchemaVersion;
  return typeof version === 'number' && version !== SEASON_RUN_SAVE_SCHEMA_VERSION;
}
export function unsupportedSaveVersionError(row: unknown): SeasonRunLoadError {
  const version =
    typeof row === 'object' && row !== null
      ? (row as { saveSchemaVersion?: unknown }).saveSchemaVersion
      : undefined;
  return new SeasonRunLoadError(
    [
      `stored save schema ${typeof version === 'number' ? String(version) : 'unknown'} does not match current schema ${String(SEASON_RUN_SAVE_SCHEMA_VERSION)}`,
    ],
    `This saved season uses an unsupported version. Restart the season to continue. ${LIVE_SEASON_RUN_VERSION_MESSAGE}`,
    'SEASON_RUN_VERSION_UNSUPPORTED',
  );
}
export function unsupportedRulesVersionError(): SeasonRunLoadError {
  return new SeasonRunLoadError(
    [
      `stored Season Run rule versions do not match the current versions: ${LIVE_SEASON_RUN_VERSION_MESSAGE}`,
    ],
    `This saved season uses an unsupported version. Restart the season to continue. ${LIVE_SEASON_RUN_VERSION_MESSAGE}`,
    'SEASON_RUN_VERSION_UNSUPPORTED',
  );
}
export function byGameId<
  T extends {
    gameId: string;
  },
>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.gameId < b.gameId ? -1 : 1));
}
export function byRevision<
  T extends {
    revision: number;
  },
>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.revision - b.revision);
}
export function topUpPlayerAggregates(
  stored: readonly SeasonPlayerAggregate[],
  rosters: readonly SeasonRoster[],
): SeasonPlayerAggregate[] {
  const byVersionId = new Map(stored.map((row) => [row.playerVersionId, row]));
  for (const roster of rosters) {
    for (const player of roster.players) {
      if (!byVersionId.has(player.playerVersionId)) {
        byVersionId.set(
          player.playerVersionId,
          emptySeasonPlayerAggregate(player.playerVersionId, roster.franchiseId),
        );
      }
    }
  }
  return [...byVersionId.values()].sort((a, b) => (a.playerVersionId < b.playerVersionId ? -1 : 1));
}
export async function deleteRunRows(db: HoopRushDatabase, runId: string): Promise<void> {
  await db.seasonRunSummaries.where('runId').equals(runId).delete();
  await db.seasonRunDetails.where('runId').equals(runId).delete();
  await db.seasonRunBlocks.where('runId').equals(runId).delete();
  await db.seasonPendingBlocks.delete(runId);
  await db.seasonPostseasonSummaries.where('runId').equals(runId).delete();
  await db.seasonPostseasonDetails.where('runId').equals(runId).delete();
  await db.seasonCommandLog.where('runId').equals(runId).delete();
  await db.seasonAlmanacs.delete(runId);
  await db.seasonCompletedRuns.delete(runId);
  await db.seasonCompletedIndex.delete(runId);
  await db.seasonRunPlayerSlices.delete(runId);
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
