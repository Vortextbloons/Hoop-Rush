import {
  emptySeasonPlayerAggregate,
  LIVE_SEASON_RUN_VERSION_MESSAGE,
  SEASON_RUN_SAVE_SCHEMA_VERSION,
  type SeasonPlayerAggregate,
  type SeasonRoster,
} from '@hoop-rush/data-contracts';
import type { Table } from 'dexie';
import type { HoopRushDatabase } from './dexie.ts';
import { SeasonRunLoadError } from '@hoop-rush/data-contracts';
import { deleteWhereEquals, saveSchemaVersionOf } from './support.ts';
export { SeasonRunLoadError };
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
  const version = saveSchemaVersionOf(row);
  return version !== null && version !== SEASON_RUN_SAVE_SCHEMA_VERSION;
}
export function unsupportedSaveVersionError(row: unknown): SeasonRunLoadError {
  const version = saveSchemaVersionOf(row);
  return new SeasonRunLoadError(
    [
      `stored save schema ${version === null ? 'unknown' : String(version)} does not match current schema ${String(SEASON_RUN_SAVE_SCHEMA_VERSION)}`,
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
  await deleteWhereEquals(db.seasonRunSummaries, 'runId', runId);
  await deleteWhereEquals(db.seasonRunDetails, 'runId', runId);
  await deleteWhereEquals(db.seasonRunBlocks, 'runId', runId);
  await db.seasonPendingBlocks.delete(runId);
  await deleteWhereEquals(db.seasonPostseasonSummaries, 'runId', runId);
  await deleteWhereEquals(db.seasonPostseasonDetails, 'runId', runId);
  await deleteWhereEquals(db.seasonCommandLog, 'runId', runId);
  await db.seasonAlmanacs.delete(runId);
  await db.seasonCompletedRuns.delete(runId);
  await db.seasonCompletedIndex.delete(runId);
  await db.seasonRunPlayerSlices.delete(runId);
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
