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
