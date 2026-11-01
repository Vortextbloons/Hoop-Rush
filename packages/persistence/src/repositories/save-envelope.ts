import type { Table } from 'dexie';
import { commandReceiptMatches, getParsedRecord } from './support.ts';

/**
 * Shared save-commit mechanics.
 *
 * Milestone 4 of `spec/refactors/shared-mode-infrastructure.md`.
 *
 * This module owns the *order* and *preconditions* of a save commit, not the
 * contents. Havoc and Cap Rush solo both do the same four things before writing
 * anything:
 *
 *   1. read the stored command and replay it when it matches exactly;
 *   2. refuse a reused command ID with a different payload;
 *   3. refuse a write based on a stale revision;
 *   4. write the state, artifacts, and command row together.
 *
 * What deliberately stays in each repository:
 *
 *   - the table set (Havoc touches profile tables, Cap Rush does not);
 *   - artifact shape (Havoc: game + tape + comparison + report; Cap Rush:
 *     game/playoff/league/report + playback evidence);
 *   - the replay match test (Havoc also compares an outcome digest);
 *   - Cap Rush's pending-playback gate, which has no Havoc equivalent.
 *
 * The spec is explicit that a common envelope must not make these artifacts
 * interchangeable, and that the transaction must not hide its scope behind an
 * arbitrary callback. Every function here takes an explicit table list.
 */

/** Outcome of looking for an already-committed command. */
export type CommandReplay<Result> =
  /** Nothing was stored under this ID. */
  | { kind: 'new' }
  /** The same command and result are already committed; return the stored result. */
  | { kind: 'replayed'; result: Result }
  /** A different payload or result reused this ID. */
  | { kind: 'conflict' };

/**
 * Decode a stored command row against an incoming one.
 *
 * `matches` is per-mode because Havoc additionally compares an outcome digest,
 * while Cap Rush compares the result status. Passing it in keeps that
 * difference visible at the call site rather than buried here.
 */
export function classifyCommandReplay<Stored, Incoming, Result>(input: {
  stored: Stored | null;
  incoming: Incoming;
  resultOf: (stored: Stored) => Result;
  matches: (stored: Stored, incoming: Incoming) => boolean;
}): CommandReplay<Result> {
  if (input.stored === null) return { kind: 'new' };
  if (input.matches(input.stored, input.incoming)) {
    return { kind: 'replayed', result: input.resultOf(input.stored) };
  }
  return { kind: 'conflict' };
}

/**
 * The default replay match: identical canonical command JSON.
 *
 * Most modes only need this. Havoc layers an outcome-digest comparison on top.
 */
export function commandEnvelopeMatches(storedCommand: unknown, incomingCommand: unknown): boolean {
  return commandReceiptMatches(storedCommand, incomingCommand);
}

/**
 * Read a stored command row by ID.
 *
 * Shared because every mode keys its command table on `commandId` and parses
 * the row the same way; only the row schema differs.
 */
export async function readStoredCommand<Row, Key extends string>(input: {
  table: Pick<Table<Row, Key>, 'get'>;
  commandId: Key;
  parse: (row: unknown) => Row;
}): Promise<Row | null> {
  return getParsedRecord(input.table, input.commandId, input.parse);
}
