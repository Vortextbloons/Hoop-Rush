import {
  COLLECTION_CATALOG_VERSION,
  COLLECTION_ECONOMY_VERSION,
  COLLECTION_SAVE_VERSION,
  COLLECTION_VERSION,
  canonicalJson,
  collectionStateSchema,
  seedSchema,
  type CollectionCatalog,
  type CollectionCommand,
  type CollectionLedgerEntry,
  type CollectionPullRecord,
  type CollectionState,
} from '@hoop-rush/data-contracts';
import {
  applyCollectionCommand as applyEngineCommand,
  auditCollectionState,
  collectionStateDigest,
  collectionStateFactsOf,
} from '@hoop-rush/engine';
import { HoopRushDatabase } from './dexie.ts';
import {
  storedCollectionCommandSchema,
  storedCollectionLedgerSchema,
  storedCollectionOwnershipSchema,
  storedCollectionPullSchema,
  storedCollectionStateSchema,
  type StoredCollectionCommandRow,
} from '../schemas/collection-record.ts';

export class CollectionLoadError extends Error {
  readonly code: 'missing' | 'corrupt' | 'unsupported' | 'incompatible' | 'divergent';
  readonly diagnostics: string[];
  constructor(code: CollectionLoadError['code'], diagnostics: string[]) {
    super(`collection load ${code}: ${diagnostics.join('; ')}`);
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

export class CollectionCommandDuplicateError extends Error {
  readonly receipt: StoredCollectionCommandRow;
  constructor(receipt: StoredCollectionCommandRow) {
    super(`duplicate collection command ${receipt.commandId}`);
    this.receipt = receipt;
  }
}

export class CollectionCommandConflictError extends Error {
  readonly commandId: string;
  constructor(commandId: string) {
    super(`collection command ${commandId} reused with different input`);
    this.commandId = commandId;
  }
}

export class CollectionCommandStaleError extends Error {
  readonly code = 'stale-state';
}

export interface LoadedCollection {
  state: CollectionState;
  pulls: CollectionPullRecord[];
  ledger: CollectionLedgerEntry[];
  commands: CollectionCommand[];
  catalogHash: string;
}

export interface CollectionCommandOutcome {
  state: CollectionState;
  pull: CollectionPullRecord | null;
  ledgerEntries: CollectionLedgerEntry[];
  duplicate: boolean;
}

function checked<T>(parse: () => T, label: string): T {
  try {
    return parse();
  } catch (error) {
    throw new CollectionLoadError('corrupt', [`${label}: ${(error as Error).message}`]);
  }
}

export class DexieCollectionRepository {
  private readonly db: HoopRushDatabase;
  constructor(db: HoopRushDatabase = new HoopRushDatabase()) {
    this.db = db;
  }

  async loadCollection(collectionId: string): Promise<LoadedCollection | null> {
    const row = await this.db.collectionState.get(collectionId);
    if (row === undefined) return null;
    const savedVersion: number = row.saveSchemaVersion;
    if (savedVersion !== COLLECTION_SAVE_VERSION) {
      throw new CollectionLoadError('unsupported', [
        `saveSchemaVersion ${String(savedVersion)} != ${String(COLLECTION_SAVE_VERSION)}`,
      ]);
    }
    const parsedRow = checked(() => storedCollectionStateSchema.parse(row), 'state row');
    const state = parsedRow.state;
    const ownership = await this.db.collectionOwnership
      .where('[collectionId+cardId]')
      .between([collectionId, ''], [collectionId, '￿'])
      .toArray();
    const pulls = await this.db.collectionPulls
      .where('[collectionId+pullSequence]')
      .between([collectionId, -1], [collectionId, Number.MAX_SAFE_INTEGER])
      .toArray();
    const ledger = await this.db.collectionLedger
      .where('[collectionId+transactionId]')
      .between([collectionId, ''], [collectionId, '￿'])
      .toArray();
    const commands = await this.db.collectionCommands
      .where('[collectionId+commandId]')
      .between([collectionId, ''], [collectionId, '￿'])
      .toArray();
    const owned = checked(
      () => ownership.map((entry) => storedCollectionOwnershipSchema.parse(entry).owned),
      'ownership rows',
    );
    const pullRecords = checked(
      () =>
        pulls
          .map((entry) => storedCollectionPullSchema.parse(entry).pull)
          .sort((a, b) => a.pullSequence - b.pullSequence),
      'pull rows',
    );
    const ledgerEntries = checked(
      () => ledger.map((entry) => storedCollectionLedgerSchema.parse(entry).entry),
      'ledger rows',
    );
    const priorCommands = checked(
      () => commands.map((entry) => storedCollectionCommandSchema.parse(entry).command),
      'command rows',
    );
    const ownedIds = new Set(owned.map((entry) => entry.cardId));
    const stateIds = new Set(state.owned.map((entry) => entry.cardId));
    const diagnostics: string[] = [];
    if (ownedIds.size !== owned.length) diagnostics.push('duplicate ownership rows');
    for (const id of ownedIds) {
      if (!stateIds.has(id)) diagnostics.push(`ownership row ${id} missing from state`);
    }
    for (const id of stateIds) {
      if (!ownedIds.has(id)) diagnostics.push(`state ownership ${id} missing a row`);
    }
    const failures = auditCollectionState(state, pullRecords, ledgerEntries);
    for (const failure of failures) diagnostics.push(`${failure.code}: ${failure.message}`);
    if (diagnostics.length > 0) {
      throw new CollectionLoadError('divergent', diagnostics);
    }
    return {
      state,
      pulls: pullRecords,
      ledger: ledgerEntries,
      commands: priorCommands,
      catalogHash: parsedRow.catalogHash,
    };
  }

  async initializeCollection(input: {
    collectionId: string;
    rootSeed: string;
    catalogHash: string;
    createdAtIso: string;
  }): Promise<CollectionState> {
    const existing = await this.db.collectionState.get(input.collectionId);
    if (existing !== undefined) {
      throw new CollectionLoadError('incompatible', [
        'collection already initialized; reset explicitly',
      ]);
    }
    const rootSeed = seedSchema.parse(input.rootSeed);
    const state = collectionStateSchema.parse({
      schemaVersion: 1,
      collectionVersion: COLLECTION_VERSION,
      catalogVersion: COLLECTION_CATALOG_VERSION,
      economyVersion: COLLECTION_ECONOMY_VERSION,
      collectionId: input.collectionId,
      rootSeed,
      revision: 0,
      digest: '0'.repeat(32),
      claimedWelcome: false,
      owned: [],
      balances: { Coins: 0, Exchange: 0 },
      nextPullSequence: 0,
    });
    const digest = collectionStateDigest(collectionStateFactsOf(state));
    const committed = { ...state, digest };
    await this.db.collectionState.put(
      storedCollectionStateSchema.parse({
        collectionId: input.collectionId,
        saveSchemaVersion: COLLECTION_SAVE_VERSION,
        state: committed,
        catalogHash: input.catalogHash,
        updatedAtIso: input.createdAtIso,
      }),
    );
    return committed;
  }

  async applyCollectionCommand(input: {
    command: CollectionCommand;
    catalog: CollectionCatalog;
    catalogHash: string;
    recordedAtIso: string;
  }): Promise<CollectionCommandOutcome> {
    const { command, catalog, catalogHash, recordedAtIso } = input;
    const snapshot = await this.loadCollection(command.collectionId);
    if (snapshot === null) {
      throw new CollectionLoadError('missing', [`no collection ${command.collectionId}`]);
    }
    const stored = await this.db.collectionCommands
      .get([command.collectionId, command.commandId])
      .catch(() => undefined);
    if (stored !== undefined) {
      const receipt = storedCollectionCommandSchema.parse(stored);
      if (canonicalJson(receipt.command) === canonicalJson(command)) {
        if (!receipt.accepted || receipt.pullSequence === null) {
          throw new CollectionCommandDuplicateError(receipt);
        }
        const pull = snapshot.pulls.find((entry) => entry.pullSequence === receipt.pullSequence);
        if (pull === undefined) {
          throw new CollectionLoadError('divergent', [
            `receipt ${receipt.commandId} missing pull ${String(receipt.pullSequence)}`,
          ]);
        }
        return { state: snapshot.state, pull, ledgerEntries: [], duplicate: true };
      }
      throw new CollectionCommandConflictError(command.commandId);
    }
    const outcome = applyEngineCommand(
      snapshot.state,
      command,
      catalog,
      snapshot.pulls,
      snapshot.ledger,
      snapshot.commands,
      catalogHash,
    );
    if (outcome.status === 'rejected') {
      const code = outcome.rejection.code;
      if (code === 'duplicate-command') {
        const receipt = await this.db.collectionCommands.get([
          command.collectionId,
          command.commandId,
        ]);
        if (receipt !== undefined) {
          throw new CollectionCommandDuplicateError(storedCollectionCommandSchema.parse(receipt));
        }
      }
      if (code === 'conflicting-command-reuse') {
        throw new CollectionCommandConflictError(command.commandId);
      }
      if (code === 'stale-state') {
        throw new CollectionCommandStaleError(`stale collection state for ${command.commandId}`);
      }
      const error = new Error(`collection command rejected: ${code}`);
      (error as { code?: string }).code = code;
      throw error;
    }
    const { state: next, pull, ledgerEntries } = outcome;
    await this.db.transaction(
      'rw',
      this.db.collectionState,
      this.db.collectionOwnership,
      this.db.collectionPulls,
      this.db.collectionLedger,
      this.db.collectionCommands,
      async () => {
        const current = await this.db.collectionState.get(command.collectionId);
        if (current === undefined) {
          throw new CollectionCommandStaleError('collection deleted during commit');
        }
        const parsed = storedCollectionStateSchema.parse(current);
        if (
          parsed.state.revision !== snapshot.state.revision ||
          parsed.state.digest !== snapshot.state.digest
        ) {
          throw new CollectionCommandStaleError('collection revision advanced during commit');
        }
        const rerun = await this.db.collectionCommands.get([
          command.collectionId,
          command.commandId,
        ]);
        if (rerun !== undefined) {
          const receipt = storedCollectionCommandSchema.parse(rerun);
          if (canonicalJson(receipt.command) !== canonicalJson(command)) {
            throw new CollectionCommandConflictError(command.commandId);
          }
          throw new CollectionCommandDuplicateError(receipt);
        }
        const ownedRows = next.owned
          .filter((entry) => entry.acquiredPullSequence === pull.pullSequence)
          .map((entry) => ({
            collectionId: command.collectionId,
            cardId: entry.cardId,
            owned: entry,
          }));
        await this.db.collectionOwnership.bulkPut(
          ownedRows.map((entry) => storedCollectionOwnershipSchema.parse(entry)),
        );
        await this.db.collectionPulls.put(
          storedCollectionPullSchema.parse({
            collectionId: command.collectionId,
            pullSequence: pull.pullSequence,
            pull,
          }),
        );
        await this.db.collectionLedger.bulkPut(
          ledgerEntries.map((entry) => ({
            collectionId: command.collectionId,
            transactionId: entry.transactionId,
            entry,
          })),
        );
        await this.db.collectionCommands.put(
          storedCollectionCommandSchema.parse({
            collectionId: command.collectionId,
            commandId: command.commandId,
            command,
            accepted: true,
            rejectionCode: null,
            postRevision: next.revision,
            postDigest: next.digest,
            pullSequence: pull.pullSequence,
            recordedAtIso,
          }),
        );
        await this.db.collectionState.put(
          storedCollectionStateSchema.parse({
            collectionId: command.collectionId,
            saveSchemaVersion: COLLECTION_SAVE_VERSION,
            state: next,
            catalogHash,
            updatedAtIso: recordedAtIso,
          }),
        );
      },
    );
    return { state: next, pull, ledgerEntries, duplicate: false };
  }

  async exportBundle(collectionId: string): Promise<{
    state: CollectionState;
    pulls: CollectionPullRecord[];
    ledger: CollectionLedgerEntry[];
    commands: CollectionCommand[];
    catalogHash: string;
  }> {
    const snapshot = await this.loadCollection(collectionId);
    if (snapshot === null)
      throw new CollectionLoadError('missing', [`no collection ${collectionId}`]);
    return {
      state: snapshot.state,
      pulls: snapshot.pulls,
      ledger: snapshot.ledger,
      commands: snapshot.commands,
      catalogHash: snapshot.catalogHash,
    };
  }

  async clearCollection(collectionId: string): Promise<void> {
    await this.db.transaction(
      'rw',
      this.db.collectionState,
      this.db.collectionOwnership,
      this.db.collectionPulls,
      this.db.collectionLedger,
      this.db.collectionCommands,
      async () => {
        await this.db.collectionState.delete(collectionId);
        await this.db.collectionOwnership
          .where('[collectionId+cardId]')
          .between([collectionId, ''], [collectionId, '￿'])
          .delete();
        await this.db.collectionPulls
          .where('[collectionId+pullSequence]')
          .between([collectionId, -1], [collectionId, Number.MAX_SAFE_INTEGER])
          .delete();
        await this.db.collectionLedger
          .where('[collectionId+transactionId]')
          .between([collectionId, ''], [collectionId, '￿'])
          .delete();
        await this.db.collectionCommands
          .where('[collectionId+commandId]')
          .between([collectionId, ''], [collectionId, '￿'])
          .delete();
      },
    );
  }
}
