import Dexie from 'dexie';
import { IDBFactory } from 'fake-indexeddb';
import { HoopRushDatabase } from '../repositories/dexie.ts';
export class TestDatabase extends HoopRushDatabase {}
let previousFactory: IDBFactory | null = null;
export function resetIndexedDb(): void {
  if (previousFactory === null) {
    previousFactory = globalThis.indexedDB;
  }
  const factory = new IDBFactory();
  globalThis.indexedDB = factory;
  Dexie.dependencies.indexedDB = factory;
}
export function restoreIndexedDb(): void {
  if (previousFactory !== null) {
    globalThis.indexedDB = previousFactory;
    Dexie.dependencies.indexedDB = previousFactory;
    previousFactory = null;
  }
}
let databaseNameCounter = 0;
export function testDatabaseName(filePrefix: string): string {
  databaseNameCounter += 1;
  return `test-${filePrefix}-${String(databaseNameCounter)}`;
}
