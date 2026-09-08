import {
  COLLECTION_CATALOG_VERSION,
  COLLECTION_ECONOMY_VERSION,
  COLLECTION_PLAY_SAVE_VERSION,
  COLLECTION_SAVE_VERSION,
  COLLECTION_VERSION,
  canonicalJson,
  collectionStateSchema,
  seedSchema,
  type CollectionBalances,
  type CollectionCatalog,
  type CollectionCommand,
  type CollectionCpuRarityWeights,
  type CollectionGameCommand,
  type CollectionGameRecord,
  type CollectionLedgerEntry,
  type CollectionPlayState,
  type CollectionPullRecord,
  type CollectionState,
  type EraSimulationProfile,
} from '@hoop-rush/data-contracts';
import {
  applyCollectionCommand as applyEngineCommand,
  applyCollectionGameCommand as applyEngineGameCommand,
  auditCollectionState,
  collectionStateDigest,
  collectionStateFactsOf,
  initializeCollectionPlayState,
} from '@hoop-rush/engine';
import { HoopRushDatabase } from './dexie.ts';
import {
  storedCollectionCommandSchema,
  storedCollectionGameCommandSchema,
  storedCollectionGameSchema,
  storedCollectionLedgerSchema,
  storedCollectionOwnershipSchema,
  storedCollectionPlayStateSchema,
  storedCollectionPullSchema,
  storedCollectionStateSchema,
  type StoredCollectionCommandRow,
  type StoredCollectionGameCommandRow,
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

export class CollectionGameCommandDuplicateError extends Error {
  readonly receipt: StoredCollectionGameCommandRow;
  constructor(receipt: StoredCollectionGameCommandRow) {
    super(`duplicate collection game command ${receipt.commandId}`);
    this.receipt = receipt;
  }
}

export class CollectionGameCommandConflictError extends Error {
  readonly commandId: string;
  constructor(commandId: string) {
    super(`collection game command ${commandId} reused with different input`);
    this.commandId = commandId;
  }
}

export interface LoadedCollection {
  state: CollectionState;
  pulls: CollectionPullRecord[];
  ledger: CollectionLedgerEntry[];
  commands: CollectionCommand[];
  gameRecords: CollectionGameRecord[];
  catalogHash: string;
}

export interface CollectionCommandOutcome {
  state: CollectionState;
  pull: CollectionPullRecord | null;
  ledgerEntries: CollectionLedgerEntry[];
  duplicate: boolean;
}

export interface LoadedPlayState {
  playState: CollectionPlayState;
  rootSeed: string;
  catalogHash: string;
}

export interface CollectionGameCommandOutcome {
  playState: CollectionPlayState;
  prepared: { gameId: string; gameSequence: number } | null;
  record: CollectionGameRecord | null;
  ledgerEntries: CollectionLedgerEntry[];
  balances: CollectionBalances | null;
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
    const gameRows = await this.db.collectionGames
      .where('[collectionId+gameId]')
      .between([collectionId, ''], [collectionId, '￿'])
      .toArray();
    const gameRecords = checked(
      () =>
        gameRows
          .map((entry) => storedCollectionGameSchema.parse(entry).record)
          .sort((a, b) => a.gameSequence - b.gameSequence),
      'game rows',
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
    const failures = auditCollectionState(state, pullRecords, ledgerEntries, gameRecords);
    for (const failure of failures) diagnostics.push(`${failure.code}: ${failure.message}`);
    if (diagnostics.length > 0) {
      throw new CollectionLoadError('divergent', diagnostics);
    }
    return {
      state,
      pulls: pullRecords,
      ledger: ledgerEntries,
      commands: priorCommands,
      gameRecords,
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
    gameRecords: CollectionGameRecord[];
    gameCommands: CollectionGameCommand[];
    playState: LoadedPlayState | null;
    catalogHash: string;
  }> {
    const snapshot = await this.loadCollection(collectionId);
    if (snapshot === null)
      throw new CollectionLoadError('missing', [`no collection ${collectionId}`]);
    const playState = await this.loadPlayState(collectionId);
    const gameCommandRows = await this.db.collectionGameCommands
      .where('[collectionId+commandId]')
      .between([collectionId, ''], [collectionId, '￿'])
      .toArray();
    const gameCommands = checked(
      () => gameCommandRows.map((entry) => storedCollectionGameCommandSchema.parse(entry).command),
      'game command rows',
    );
    return {
      state: snapshot.state,
      pulls: snapshot.pulls,
      ledger: snapshot.ledger,
      commands: snapshot.commands,
      gameRecords: snapshot.gameRecords,
      gameCommands,
      playState,
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
    await this.db.transaction(
      'rw',
      this.db.collectionPlayState,
      this.db.collectionGames,
      this.db.collectionGameCommands,
      async () => {
        await this.db.collectionPlayState.delete(collectionId);
        await this.db.collectionGames
          .where('[collectionId+gameId]')
          .between([collectionId, ''], [collectionId, '￿'])
          .delete();
        await this.db.collectionGameCommands
          .where('[collectionId+commandId]')
          .between([collectionId, ''], [collectionId, '￿'])
          .delete();
      },
    );
  }

  async loadPlayState(collectionId: string): Promise<LoadedPlayState | null> {
    const row = await this.db.collectionPlayState.get(collectionId);
    if (row === undefined) return null;
    const savedVersion: number = row.saveSchemaVersion;
    if (savedVersion !== COLLECTION_PLAY_SAVE_VERSION) {
      throw new CollectionLoadError('unsupported', [
        `play saveSchemaVersion ${String(savedVersion)} != ${String(COLLECTION_PLAY_SAVE_VERSION)}`,
      ]);
    }
    const parsed = checked(() => storedCollectionPlayStateSchema.parse(row), 'play state row');
    return {
      playState: parsed.playState,
      rootSeed: parsed.rootSeed,
      catalogHash: parsed.catalogHash,
    };
  }

  async getGameRecord(collectionId: string, gameId: string): Promise<CollectionGameRecord | null> {
    const row = await this.db.collectionGames.get([collectionId, gameId]);
    if (row === undefined) return null;
    return checked(() => storedCollectionGameSchema.parse(row).record, 'game row');
  }

  async ensurePlayState(input: {
    collectionId: string;
    catalog: CollectionCatalog;
    catalogHash: string;
    recordedAtIso: string;
  }): Promise<LoadedPlayState> {
    const existing = await this.loadPlayState(input.collectionId);
    if (existing !== null) return existing;
    const snapshot = await this.loadCollection(input.collectionId);
    if (snapshot === null) {
      throw new CollectionLoadError('missing', [`no collection ${input.collectionId}`]);
    }
    if (!snapshot.state.claimedWelcome) {
      throw new CollectionLoadError('incompatible', [
        'claim the starter before team play; no ownership to initialize from',
      ]);
    }
    const ownedCardIds = snapshot.state.owned.map((entry) => entry.cardId);
    const catalogById = new Map(input.catalog.cards.map((card) => [card.cardId, card]));
    const playState = initializeCollectionPlayState({
      collectionId: input.collectionId as CollectionPlayState['collectionId'],
      ownedCardIds,
      resolve: (cardId) => catalogById.get(cardId),
    });
    await this.db.collectionPlayState.put(
      storedCollectionPlayStateSchema.parse({
        collectionId: input.collectionId,
        saveSchemaVersion: COLLECTION_PLAY_SAVE_VERSION,
        playState,
        rootSeed: snapshot.state.rootSeed,
        catalogHash: input.catalogHash,
        updatedAtIso: input.recordedAtIso,
      }),
    );
    return { playState, rootSeed: snapshot.state.rootSeed, catalogHash: input.catalogHash };
  }

  async applyCollectionGameCommand(input: {
    command: CollectionGameCommand;
    catalog: CollectionCatalog;
    catalogHash: string;
    profile: EraSimulationProfile;
    profileHash: string;
    rulesHash: string;
    cpuWeights: CollectionCpuRarityWeights;
    recordedAtIso: string;
  }): Promise<CollectionGameCommandOutcome> {
    const { command, catalog, catalogHash, profile, recordedAtIso } = input;
    const snapshot = await this.loadCollection(command.collectionId);
    if (snapshot === null) {
      throw new CollectionLoadError('missing', [`no collection ${command.collectionId}`]);
    }
    const play = await this.ensurePlayState({
      collectionId: command.collectionId,
      catalog,
      catalogHash,
      recordedAtIso,
    });
    const gameCommandRows = await this.db.collectionGameCommands
      .where('[collectionId+commandId]')
      .between([command.collectionId, ''], [command.collectionId, '￿'])
      .toArray();
    const priorCommands = checked(
      () => gameCommandRows.map((entry) => storedCollectionGameCommandSchema.parse(entry).command),
      'game command rows',
    );
    const stored = await this.db.collectionGameCommands
      .get([command.collectionId, command.commandId])
      .catch(() => undefined);
    if (stored !== undefined) {
      const receipt = storedCollectionGameCommandSchema.parse(stored);
      if (canonicalJson(receipt.command) === canonicalJson(command)) {
        return this.gameDuplicateOutcome(command.collectionId, receipt, play.playState);
      }
      throw new CollectionGameCommandConflictError(command.commandId);
    }
    const ownedCardIds = new Set(snapshot.state.owned.map((entry) => entry.cardId));
    const catalogById = new Map(catalog.cards.map((card) => [card.cardId, card]));
    const outcome = applyEngineGameCommand(play.playState, command, {
      catalog,
      ownedCardIds,
      resolve: (cardId) => catalogById.get(cardId),
      rootSeed: play.rootSeed,
      cpuWeights: input.cpuWeights,
      profile,
      profileHash: input.profileHash,
      catalogHash,
      rulesHash: input.rulesHash,
      balances: snapshot.state.balances,
      priorCommands,
    });
    if (outcome.status === 'rejected') {
      const code = outcome.rejection.code;
      if (code === 'duplicate-command') {
        const receipt = await this.db.collectionGameCommands.get([
          command.collectionId,
          command.commandId,
        ]);
        if (receipt !== undefined) {
          const parsed = storedCollectionGameCommandSchema.parse(receipt);
          return this.gameDuplicateOutcome(command.collectionId, parsed, play.playState);
        }
      }
      if (code === 'conflicting-command-reuse') {
        throw new CollectionGameCommandConflictError(command.commandId);
      }
      if (code === 'stale-state') {
        throw new CollectionCommandStaleError(`stale play state for ${command.commandId}`);
      }
      const error = new Error(`collection game command rejected: ${code}`);
      (error as { code?: string }).code = code;
      throw error;
    }
    const { playState: next, prepared, record, ledgerEntry } = outcome;
    let balances = snapshot.state.balances;
    await this.db.transaction(
      'rw',
      this.db.collectionState,
      this.db.collectionPlayState,
      this.db.collectionGames,
      this.db.collectionLedger,
      this.db.collectionGameCommands,
      async () => {
        const currentPlay = await this.db.collectionPlayState.get(command.collectionId);
        if (currentPlay === undefined) {
          throw new CollectionCommandStaleError('play state deleted during commit');
        }
        const parsedPlay = storedCollectionPlayStateSchema.parse(currentPlay);
        if (
          parsedPlay.playState.revision !== play.playState.revision ||
          parsedPlay.playState.digest !== play.playState.digest
        ) {
          throw new CollectionCommandStaleError('play state revision advanced during commit');
        }
        const rerun = await this.db.collectionGameCommands.get([
          command.collectionId,
          command.commandId,
        ]);
        if (rerun !== undefined) {
          const receipt = storedCollectionGameCommandSchema.parse(rerun);
          if (canonicalJson(receipt.command) !== canonicalJson(command)) {
            throw new CollectionGameCommandConflictError(command.commandId);
          }
          throw new CollectionGameCommandDuplicateError(receipt);
        }
        const receiptGameId =
          record?.gameId ??
          prepared?.gameId ??
          (command.command === 'abandon-basic-game' ? command.gameId : null);
        const receiptGameSequence = record?.gameSequence ?? prepared?.gameSequence ?? null;
        await this.db.collectionGameCommands.put(
          storedCollectionGameCommandSchema.parse({
            collectionId: command.collectionId,
            commandId: command.commandId,
            command,
            accepted: true,
            rejectionCode: null,
            postRevision: next.revision,
            postDigest: next.digest,
            gameId: receiptGameId,
            gameSequence: receiptGameSequence,
            recordedAtIso,
          }),
        );
        await this.db.collectionPlayState.put(
          storedCollectionPlayStateSchema.parse({
            collectionId: command.collectionId,
            saveSchemaVersion: COLLECTION_PLAY_SAVE_VERSION,
            playState: next,
            rootSeed: play.rootSeed,
            catalogHash,
            updatedAtIso: recordedAtIso,
          }),
        );
        if (record !== undefined && ledgerEntry !== undefined) {
          const current = await this.db.collectionState.get(command.collectionId);
          if (current === undefined) {
            throw new CollectionCommandStaleError('collection deleted during commit');
          }
          const parsed = storedCollectionStateSchema.parse(current);
          const nextBalances = {
            Coins: addLedgerChecked(parsed.state.balances.Coins, ledgerEntry.amount),
            Exchange: parsed.state.balances.Exchange,
          };
          const nextCollection = {
            ...parsed.state,
            balances: nextBalances,
            revision: parsed.state.revision + 1,
            digest: '0'.repeat(32),
          };
          const committed = {
            ...nextCollection,
            digest: collectionStateDigest(collectionStateFactsOf(nextCollection)),
          };
          await this.db.collectionGames.put(
            storedCollectionGameSchema.parse({
              collectionId: command.collectionId,
              gameId: record.gameId,
              gameSequence: record.gameSequence,
              record,
            }),
          );
          await this.db.collectionLedger.put(
            storedCollectionLedgerSchema.parse({
              collectionId: command.collectionId,
              transactionId: ledgerEntry.transactionId,
              entry: ledgerEntry,
            }),
          );
          await this.db.collectionState.put(
            storedCollectionStateSchema.parse({
              collectionId: command.collectionId,
              saveSchemaVersion: parsed.saveSchemaVersion,
              state: committed,
              catalogHash,
              updatedAtIso: recordedAtIso,
            }),
          );
          balances = nextBalances;
        }
      },
    );
    return {
      playState: next,
      prepared: prepared ?? null,
      record: record ?? null,
      ledgerEntries: ledgerEntry === undefined ? [] : [ledgerEntry],
      balances,
      duplicate: false,
    };
  }

  private async gameDuplicateOutcome(
    collectionId: string,
    receipt: StoredCollectionGameCommandRow,
    currentPlayState: CollectionPlayState,
  ): Promise<CollectionGameCommandOutcome> {
    if (receipt.command.command === 'accept-basic-game-result') {
      if (receipt.gameId === null) {
        throw new CollectionLoadError('divergent', [`receipt ${receipt.commandId} missing game`]);
      }
      const gameRow = await this.db.collectionGames.get([collectionId, receipt.gameId]);
      if (gameRow === undefined) {
        throw new CollectionLoadError('divergent', [
          `receipt ${receipt.commandId} missing game ${receipt.gameId}`,
        ]);
      }
      const record = storedCollectionGameSchema.parse(gameRow).record;
      return {
        playState: currentPlayState,
        prepared: null,
        record,
        ledgerEntries: [],
        balances: null,
        duplicate: true,
      };
    }
    if (receipt.command.command === 'prepare-basic-game') {
      if (receipt.gameId === null || receipt.gameSequence === null) {
        throw new CollectionLoadError('divergent', [
          `receipt ${receipt.commandId} missing prepared game`,
        ]);
      }
      return {
        playState: currentPlayState,
        prepared: { gameId: receipt.gameId, gameSequence: receipt.gameSequence },
        record: null,
        ledgerEntries: [],
        balances: null,
        duplicate: true,
      };
    }
    return {
      playState: currentPlayState,
      prepared: null,
      record: null,
      ledgerEntries: [],
      balances: null,
      duplicate: true,
    };
  }
}

function addLedgerChecked(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum) || sum < 0) {
    const error = new Error('collection game reward overflows safe integers');
    (error as { code?: string }).code = 'arithmetic-overflow';
    throw error;
  }
  return sum;
}
