import type { Table } from 'dexie';
import { canonicalJson } from '@hoop-rush/data-contracts';

export interface ParseableSchema<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: { message: string } };
}

export function parseRecord<T>(
  schema: ParseableSchema<T>,
  value: unknown,
  label: string,
  onInvalid: (diagnostic: string) => Error,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw onInvalid(`${label}: ${parsed.error.message}`);
  return parsed.data;
}

export function saveSchemaVersionOf(row: unknown): number | null {
  if (typeof row !== 'object' || row === null || !Object.hasOwn(row, 'saveSchemaVersion')) {
    return null;
  }
  const version = (row as { saveSchemaVersion?: unknown }).saveSchemaVersion;
  return typeof version === 'number' ? version : null;
}

export function hasSaveSchemaVersion(row: unknown, expected: number): boolean {
  return saveSchemaVersionOf(row) === expected;
}

export function assertSaveSchemaVersion(
  row: unknown,
  expected: number,
  onMismatch: (message: string) => Error,
): void {
  const version = saveSchemaVersionOf(row);
  if (version !== expected) {
    throw onMismatch(
      `stored save schema ${version === null ? 'unknown' : String(version)} does not match current ${String(expected)}`,
    );
  }
}

export async function scopedRows<T, TKey, TInsertType>(
  table: Pick<Table<T, TKey, TInsertType>, 'where'>,
  index: string,
  scopeId: string,
): Promise<T[]> {
  const rows = await table.where(index).between([scopeId, ''], [scopeId, '\uffff']).toArray();
  return rows;
}

export async function scopedNumericRows<T, TKey, TInsertType>(
  table: Pick<Table<T, TKey, TInsertType>, 'where'>,
  index: string,
  scopeId: string,
): Promise<T[]> {
  const rows = await table
    .where(index)
    .between([scopeId, -1], [scopeId, Number.MAX_SAFE_INTEGER])
    .toArray();
  return rows;
}

export async function deleteScopedRows<T, TKey, TInsertType>(
  table: Pick<Table<T, TKey, TInsertType>, 'where'>,
  index: string,
  scopeId: string,
): Promise<number> {
  return table.where(index).between([scopeId, ''], [scopeId, '\uffff']).delete();
}

export async function deleteScopedNumericRows<T, TKey, TInsertType>(
  table: Pick<Table<T, TKey, TInsertType>, 'where'>,
  index: string,
  scopeId: string,
): Promise<number> {
  return table.where(index).between([scopeId, -1], [scopeId, Number.MAX_SAFE_INTEGER]).delete();
}

export async function rowsWhereEquals<T, TKey, TInsertType>(
  table: Pick<Table<T, TKey, TInsertType>, 'where'>,
  index: string,
  value: string,
): Promise<T[]> {
  const rows = await table.where(index).equals(value).toArray();
  return rows;
}

export async function deleteWhereEquals<T, TKey, TInsertType>(
  table: Pick<Table<T, TKey, TInsertType>, 'where'>,
  index: string,
  value: string,
): Promise<number> {
  return table.where(index).equals(value).delete();
}

export function commandReceiptMatches(storedCommand: unknown, incomingCommand: unknown): boolean {
  return canonicalJson(storedCommand) === canonicalJson(incomingCommand);
}

export interface RevisionedState {
  revision: number;
  digest: string;
}

export function stateMatches(current: RevisionedState | null, expected: RevisionedState): boolean {
  return (
    current !== null && current.revision === expected.revision && current.digest === expected.digest
  );
}

export function revisionMatches(current: { revision: number } | null, expected: number): boolean {
  return current !== null && current.revision === expected;
}

export async function listCompletedHistory<T, TKey, TInsertType>(
  table: Pick<Table<T, TKey, TInsertType>, 'orderBy'>,
  index = 'completedAtIso',
): Promise<T[]> {
  const rows = await table.orderBy(index).reverse().toArray();
  return rows;
}

export interface CommandRowDedupe<TRow> {
  ordinalOf(row: TRow): number;
  identityOf?(row: TRow): string;
  matches(stored: TRow, incoming: TRow): boolean;
  conflict(kind: 'ordinal' | 'identity', row: TRow): Error;
}

/** Returns the incoming rows that are not already stored, preserving each mode's dedupe rules. */
export function commandRowsToAppend<TRow>(
  input: CommandRowDedupe<TRow> & {
    existing: readonly TRow[];
    incoming: readonly TRow[];
  },
): TRow[] {
  const byOrdinal = new Map<number, TRow>();
  const byIdentity = new Map<string, TRow>();
  for (const row of input.existing) {
    byOrdinal.set(input.ordinalOf(row), row);
    const identity = input.identityOf?.(row);
    if (identity !== undefined) byIdentity.set(identity, row);
  }
  return input.incoming.filter((row) => {
    const identity = input.identityOf?.(row);
    const sameIdentity = identity === undefined ? undefined : byIdentity.get(identity);
    if (sameIdentity !== undefined) {
      if (input.matches(sameIdentity, row)) return false;
      throw input.conflict('identity', row);
    }
    const ordinal = input.ordinalOf(row);
    const sameOrdinal = byOrdinal.get(ordinal);
    if (sameOrdinal !== undefined) {
      if (input.matches(sameOrdinal, row)) return false;
      throw input.conflict('ordinal', row);
    }
    byOrdinal.set(ordinal, row);
    if (identity !== undefined) byIdentity.set(identity, row);
    return true;
  });
}

/** Upserts a result row while retaining the verification flag of the stored row. */
export async function putResultPreservingVerified<TRow extends { verified: boolean }, TKey>(input: {
  table: Pick<Table<TRow, TKey>, 'get' | 'put'>;
  key: TKey;
  parse: (row: unknown) => TRow;
  build: (verified: boolean) => TRow;
}): Promise<void> {
  const existing = await input.table.get(input.key);
  await input.table.put(
    input.build(existing === undefined ? false : input.parse(existing).verified),
  );
}
