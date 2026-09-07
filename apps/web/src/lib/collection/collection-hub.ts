import {
  collectionCommandSchema,
  collectionPackIdSchema,
  type CollectionCatalog,
  type CollectionLedgerEntry,
  type CollectionPullRecord,
  type CollectionState,
} from '@hoop-rush/data-contracts';
import { DexieCollectionRepository, HoopRushDatabase } from '@hoop-rush/persistence';
import { getManifest } from '$lib/data';
import { loadCollectionCatalog } from './collection-assets.ts';

export const COLLECTION_ID = 'collection-1';

let dbInstance: HoopRushDatabase | null = null;
export function getCollectionDb(): HoopRushDatabase {
  if (!dbInstance) dbInstance = new HoopRushDatabase();
  return dbInstance;
}

export function getCollectionRepo(): DexieCollectionRepository {
  return new DexieCollectionRepository(getCollectionDb());
}

function randomSeedHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function ensureCollection(nowIso: string): Promise<CollectionState> {
  const repo = getCollectionRepo();
  const existing = await repo.loadCollection(COLLECTION_ID);
  if (existing) return existing.state;
  return repo.initializeCollection({
    collectionId: COLLECTION_ID,
    rootSeed: randomSeedHex(),
    catalogHash: await collectionCatalogHash(),
    createdAtIso: nowIso,
  });
}

export async function collectionCatalogHash(): Promise<string> {
  const manifest = await getManifest();
  const entry = manifest.collection?.catalog;
  if (!entry) throw new Error('The collection catalog is unavailable.');
  return entry.contentHash;
}

export interface ClaimOutcome {
  state: CollectionState;
  pull: CollectionPullRecord;
  exchange: number;
}

export async function claimWelcomeStarter(nowIso: string): Promise<ClaimOutcome> {
  const repo = getCollectionRepo();
  const catalog = await loadCollectionCatalog();
  const snapshot = await repo.loadCollection(COLLECTION_ID);
  const state =
    snapshot?.state ??
    (await repo.initializeCollection({
      collectionId: COLLECTION_ID,
      rootSeed: randomSeedHex(),
      catalogHash: await collectionCatalogHash(),
      createdAtIso: nowIso,
    }));
  const command = collectionCommandSchema.parse({
    schemaVersion: 1,
    commandVersion: 'collection-command-v1',
    commandId: crypto.randomUUID(),
    collectionId: COLLECTION_ID,
    expectedRevision: state.revision,
    expectedDigest: state.digest,
    command: 'claim-welcome',
    acquiredAtIso: nowIso,
  });
  const outcome = await repo.applyCollectionCommand({
    command,
    catalog,
    catalogHash: await collectionCatalogHash(),
    recordedAtIso: nowIso,
  });
  if (!outcome.pull) throw new Error('The starter claim did not produce cards.');
  return { state: outcome.state, pull: outcome.pull, exchange: outcome.state.balances.Exchange };
}

export interface PackOutcome {
  state: CollectionState;
  pull: CollectionPullRecord;
  ledgerEntries: CollectionLedgerEntry[];
  catalog: CollectionCatalog;
}

export async function openPack(packId: string, nowIso: string): Promise<PackOutcome> {
  const repo = getCollectionRepo();
  const catalog = await loadCollectionCatalog();
  const parsedPackId = collectionPackIdSchema.parse(packId);
  const snapshot = await repo.loadCollection(COLLECTION_ID);
  if (!snapshot) throw new Error('Claim the starter before opening packs.');
  const command = collectionCommandSchema.parse({
    schemaVersion: 1,
    commandVersion: 'collection-command-v1',
    commandId: crypto.randomUUID(),
    collectionId: COLLECTION_ID,
    expectedRevision: snapshot.state.revision,
    expectedDigest: snapshot.state.digest,
    command: 'open-pack',
    packId: parsedPackId,
    acquiredAtIso: nowIso,
  });
  const outcome = await repo.applyCollectionCommand({
    command,
    catalog,
    catalogHash: await collectionCatalogHash(),
    recordedAtIso: nowIso,
  });
  if (!outcome.pull) throw new Error('The pack did not produce cards.');
  return {
    state: outcome.state,
    pull: outcome.pull,
    ledgerEntries: outcome.ledgerEntries,
    catalog,
  };
}
