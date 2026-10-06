import {
  seasonCheckpointDigestSchema,
  seasonCommandLogDigest,
  seasonCommandLogEntrySchema,
  type SeasonCommandActor,
  type SeasonCommandLogEntry,
  type SeasonRunCommand,
} from '@hoop-rush/data-contracts';
import type { Table } from 'dexie';
import {
  storedSeasonCommandLogRowSchema,
  type SeasonRunCursor,
  type StoredSeasonCommandLogRow,
} from '../schemas/season-run-record.ts';
import { SeasonRunCommandDuplicateError, SeasonRunCommandStaleStateError } from './season-run.ts';
export function assertCommandStateCurrent(
  cursor: SeasonRunCursor,
  command: SeasonRunCommand,
): void {
  if (cursor.stateRevision !== command.expectedStateRevision) {
    throw new SeasonRunCommandStaleStateError(
      command.commandId,
      command.expectedStateRevision,
      cursor.stateRevision,
    );
  }
  if (cursor.stateDigest !== command.expectedStateDigest) {
    throw new SeasonRunCommandStaleStateError(
      command.commandId,
      command.expectedStateRevision,
      cursor.stateRevision,
    );
  }
}
export function recordedCommandIdsFromCursor(
  cursor: SeasonRunCursor,
  options: { includeEvolution?: boolean } = {},
): string[] {
  const recorded: string[] = [];
  if (cursor.lastCommandId !== null) recorded.push(cursor.lastCommandId);
  if (cursor.checkpointState !== null) recorded.push(cursor.checkpointState.commandId);
  for (const entry of cursor.transactions) {
    if (entry.commandId !== null) recorded.push(entry.commandId);
  }
  for (const entry of cursor.influence.ledger) {
    if (entry.commandId !== null) recorded.push(entry.commandId);
  }
  for (const selection of Object.values(cursor.objectives.selections)) {
    recorded.push(selection.selectedByCommandId);
  }
  if (options.includeEvolution !== false) {
    const evolution = cursor.evolution;
    if (typeof evolution?.frontOffice?.selectedByCommandId === 'string') {
      recorded.push(evolution.frontOffice.selectedByCommandId);
    }
    for (const selection of Object.values(evolution?.selections ?? {})) {
      if (typeof selection.selectedByCommandId === 'string') {
        recorded.push(selection.selectedByCommandId);
      }
    }
  }
  return recorded;
}
export function parseCommandLogEntries(
  rows: readonly StoredSeasonCommandLogRow[],
): SeasonCommandLogEntry[] {
  return rows
    .map((row) => storedSeasonCommandLogRowSchema.parse(row).entry)
    .sort((a, b) => a.ordinal - b.ordinal);
}
export async function loadCommandLogEntries(
  commandLog: Table<StoredSeasonCommandLogRow, [string, number]>,
  runId: string,
): Promise<SeasonCommandLogEntry[]> {
  const rows = await commandLog.where('runId').equals(runId).toArray();
  return parseCommandLogEntries(rows);
}
export function assertCommandNotDuplicated(
  recorded: readonly string[],
  entries: readonly SeasonCommandLogEntry[],
  commandId: string,
): void {
  const recordedIds = [...recorded];
  for (const entry of entries) recordedIds.push(entry.command.commandId);
  assertCommandIdNotRecorded(recordedIds, commandId);
}
export function assertCommandNotDuplicatedAgainstStoredRows(
  recorded: readonly string[],
  rows: readonly StoredSeasonCommandLogRow[],
  commandId: string,
): void {
  const recordedIds = [...recorded];
  for (const row of rows) {
    const parsed = storedSeasonCommandLogRowSchema.safeParse(row);
    if (parsed.success) recordedIds.push(parsed.data.entry.command.commandId);
  }
  assertCommandIdNotRecorded(recordedIds, commandId);
}
function assertCommandIdNotRecorded(recordedIds: readonly string[], commandId: string): void {
  if (recordedIds.includes(commandId)) {
    throw new SeasonRunCommandDuplicateError(commandId);
  }
}
export function assertDenseCommandLogOrdinals(
  entries: readonly SeasonCommandLogEntry[],
  createError: (index: number) => Error,
): void {
  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index]?.ordinal !== index) throw createError(index);
  }
}
export interface CommandLogEntryFacts {
  runId: string;
  ordinal: number;
  command: SeasonRunCommand;
  preStateRevision: number;
  preStateDigest: string;
  postStateRevision: number;
  postStateDigest: string;
  resultDigest: string;
  previousEntries: readonly SeasonCommandLogEntry[];
  relatedGameIds: readonly string[];
  transactionIds: readonly string[];
  actor?: SeasonCommandActor;
}
export function buildCommandLogEntry(facts: CommandLogEntryFacts): SeasonCommandLogEntry {
  return seasonCommandLogEntrySchema.parse({
    runId: facts.runId,
    ordinal: facts.ordinal,
    command: facts.command,
    preStateRevision: facts.preStateRevision,
    preStateDigest: facts.preStateDigest,
    postStateRevision: facts.postStateRevision,
    postStateDigest: facts.postStateDigest,
    resultDigest: seasonCheckpointDigestSchema.parse(facts.resultDigest),
    previousLogDigest: seasonCommandLogDigest(facts.previousEntries),
    relatedGameIds: [...facts.relatedGameIds].sort(),
    transactionIds: [...facts.transactionIds].sort(),
    ...(facts.actor ? { actor: facts.actor } : {}),
  });
}
export async function putCommandLogEntry(
  commandLog: Table<StoredSeasonCommandLogRow, [string, number]>,
  entry: SeasonCommandLogEntry,
): Promise<void> {
  await commandLog.put({
    runId: entry.runId,
    ordinal: entry.ordinal,
    entry,
    updatedAtIso: new Date().toISOString(),
  });
}
