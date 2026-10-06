import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CollectionCatalog,
  CollectionLedgerEntry,
  CollectionPullRecord,
  CollectionState,
  HoopRushManifest,
} from '@hoop-rush/data-contracts';
import type { LoadedCollection } from '@hoop-rush/persistence';

const mocks = vi.hoisted(() => {
  const repo = { loadCollection: vi.fn() };
  return {
    repo,
    ensureCollection: vi.fn(),
    getCollectionRepo: vi.fn(() => repo),
    loadCollectionCatalog: vi.fn(),
    getManifest: vi.fn(),
  };
});

let UltimateRunShell: (typeof import('./ultimate-shell.svelte'))['UltimateRunShell'];

beforeEach(async () => {
  vi.resetModules();
  vi.doMock('./collection-hub.ts', () => ({
    ensureCollection: mocks.ensureCollection,
    getCollectionRepo: mocks.getCollectionRepo,
  }));
  vi.doMock('./collection-assets.ts', () => ({
    loadCollectionCatalog: mocks.loadCollectionCatalog,
  }));
  vi.doMock('$lib/data', () => ({
    getManifest: mocks.getManifest,
  }));
  ({ UltimateRunShell } = await import('./ultimate-shell.svelte'));
  vi.clearAllMocks();
});

const MANIFEST = { collection: null } as unknown as HoopRushManifest;

function collectionState(): CollectionState {
  return {
    collectionId: 'collection-1',
    revision: 3,
    digest: 'digest-3',
    balances: { Coins: 420, Exchange: 7 },
    owned: [{ cardId: 'card-1' }, { cardId: 'card-2' }],
    claimedWelcome: true,
    claimedSetIds: [],
    activeTargetPlayerId: null,
  } as unknown as CollectionState;
}

function catalog(cardCount: number): CollectionCatalog {
  return {
    cards: Array.from({ length: cardCount }, (_, index) => ({ cardId: `card-${String(index)}` })),
  } as unknown as CollectionCatalog;
}

function loaded(
  collection: CollectionState,
  pulls: CollectionPullRecord[] = [],
  ledger: CollectionLedgerEntry[] = [],
): LoadedCollection {
  return {
    state: collection,
    pulls,
    ledger,
    commands: [],
    gameRecords: [],
    catalogHash: 'catalog-hash',
  };
}

describe('UltimateRunShell', () => {
  it('dedupes concurrent refreshes and publishes the shared state', async () => {
    const collection = collectionState();
    const loadedCatalog = catalog(5);
    mocks.ensureCollection.mockResolvedValue(collection);
    mocks.loadCollectionCatalog.mockResolvedValue(loadedCatalog);
    mocks.getManifest.mockResolvedValue(MANIFEST);
    mocks.repo.loadCollection.mockResolvedValue(loaded(collection));

    const shell = new UltimateRunShell();
    const first = shell.refresh();
    const second = shell.refresh();

    expect(second).toBe(first);
    await first;

    expect(mocks.ensureCollection).toHaveBeenCalledTimes(1);
    expect(shell.phase).toBe('ready');
    expect(shell.loading).toBe(false);
    expect(shell.error).toBeNull();
    expect(shell.state).toBe(collection);
    expect(shell.catalog).toBe(loadedCatalog);
    expect(shell.manifest).toBe(MANIFEST);
    expect(shell.snapshot?.ownedCount).toBe(2);
    expect(shell.snapshot?.totalCount).toBe(5);
  });

  it('records the latest pull and duplicate exchange in the snapshot', async () => {
    const collection = collectionState();
    const pull = {
      pullSequence: 4,
      packId: 'tip-off',
      slots: [{ kept: true }, { kept: false }],
    } as unknown as CollectionPullRecord;
    const ledgerEntry = {
      pullSequence: 4,
      reason: 'duplicate-conversion',
      amount: 12,
    } as unknown as CollectionLedgerEntry;
    mocks.ensureCollection.mockResolvedValue(collection);
    mocks.loadCollectionCatalog.mockResolvedValue(catalog(2));
    mocks.getManifest.mockResolvedValue(MANIFEST);
    mocks.repo.loadCollection.mockResolvedValue(loaded(collection, [pull], [ledgerEntry]));

    const shell = new UltimateRunShell();
    await shell.refresh();

    expect(shell.snapshot?.latestPull).toEqual({
      pullSequence: 4,
      packId: 'tip-off',
      newCount: 1,
      exchangeGained: 12,
    });
  });

  it('reports refresh failures through phase and error', async () => {
    mocks.ensureCollection.mockRejectedValue(new Error('offline'));
    mocks.loadCollectionCatalog.mockResolvedValue(catalog(0));
    mocks.getManifest.mockResolvedValue(MANIFEST);

    const shell = new UltimateRunShell();
    await shell.refresh();

    expect(shell.phase).toBe('error');
    expect(shell.error).toBe('offline');
    expect(shell.loading).toBe(false);
    expect(shell.state).toBeNull();
  });

  it('tolerates a catalog failure while keeping the shell ready', async () => {
    const collection = collectionState();
    mocks.ensureCollection.mockResolvedValue(collection);
    mocks.loadCollectionCatalog.mockRejectedValue(new Error('catalog offline'));
    mocks.getManifest.mockResolvedValue(MANIFEST);
    mocks.repo.loadCollection.mockResolvedValue(loaded(collection));

    const shell = new UltimateRunShell();
    shell.sync(collection, 7);
    await shell.refresh();

    expect(shell.phase).toBe('ready');
    expect(shell.error).toBeNull();
    expect(shell.catalog).toBeNull();
    expect(shell.catalogError).toBe('catalog offline');
    expect(shell.state).toBe(collection);
    expect(shell.snapshot?.totalCount).toBe(7);
  });

  it('clears the catalog error after a later successful refresh', async () => {
    const collection = collectionState();
    mocks.ensureCollection.mockResolvedValue(collection);
    mocks.loadCollectionCatalog
      .mockRejectedValueOnce(new Error('catalog offline'))
      .mockResolvedValueOnce(catalog(3));
    mocks.getManifest.mockResolvedValue(MANIFEST);
    mocks.repo.loadCollection.mockResolvedValue(loaded(collection));

    const shell = new UltimateRunShell();
    await shell.refresh();
    expect(shell.catalogError).toBe('catalog offline');

    await shell.refresh();

    expect(shell.phase).toBe('ready');
    expect(shell.catalogError).toBeNull();
    expect(shell.catalog?.cards).toHaveLength(3);
    expect(shell.snapshot?.totalCount).toBe(3);
  });

  it('keeps state and snapshot aligned when sync is called', () => {
    const shell = new UltimateRunShell();
    const collection = collectionState();

    shell.sync(collection, 9);

    expect(shell.state).toBe(collection);
    expect(shell.snapshot?.totalCount).toBe(9);
    expect(shell.snapshot?.balances).toEqual({ Coins: 420, Exchange: 7 });
  });

  it('reloads the collection and refreshes latestPull after a command', async () => {
    const shell = new UltimateRunShell();
    shell.sync(collectionState(), 5);
    const updated = { ...collectionState(), balances: { Coins: 500, Exchange: 9 } };
    const pull = {
      pullSequence: 7,
      packId: 'main-event',
      slots: [{ kept: true }],
    } as unknown as CollectionPullRecord;
    mocks.ensureCollection.mockResolvedValue(updated);
    mocks.repo.loadCollection.mockResolvedValue(loaded(updated, [pull]));

    const result = await shell.reloadCollection();

    expect(result).toBe(updated);
    expect(shell.state).toBe(updated);
    expect(shell.snapshot?.balances).toEqual({ Coins: 500, Exchange: 9 });
    expect(shell.snapshot?.totalCount).toBe(5);
    expect(shell.snapshot?.latestPull?.pullSequence).toBe(7);
  });

  it('syncs the repository read instead of the ensured state on reloadCollection', async () => {
    const shell = new UltimateRunShell();
    const ensured = collectionState();
    const savedState = { ...collectionState(), balances: { Coins: 777, Exchange: 11 } };
    const pull = {
      pullSequence: 9,
      packId: 'main-event',
      slots: [{ kept: true }, { kept: false }],
    } as unknown as CollectionPullRecord;
    mocks.ensureCollection.mockResolvedValue(ensured);
    mocks.repo.loadCollection.mockResolvedValue(loaded(savedState, [pull]));

    const result = await shell.reloadCollection();

    expect(result).toBe(savedState);
    expect(shell.state).toBe(savedState);
    expect(shell.snapshot?.balances).toEqual({ Coins: 777, Exchange: 11 });
    expect(shell.snapshot?.latestPull?.pullSequence).toBe(9);
  });

  it('falls back to the ensured state when the repository read is empty', async () => {
    const shell = new UltimateRunShell();
    const ensured = collectionState();
    mocks.ensureCollection.mockResolvedValue(ensured);
    mocks.repo.loadCollection.mockResolvedValue(null);

    const result = await shell.reloadCollection();

    expect(result).toBe(ensured);
    expect(shell.state).toBe(ensured);
  });

  it('drops in-flight refresh writes after disposal', async () => {
    let resolveState: (value: CollectionState) => void = () => {};
    const pendingState = new Promise<CollectionState>((resolve) => {
      resolveState = resolve;
    });
    mocks.ensureCollection.mockReturnValue(pendingState);
    mocks.loadCollectionCatalog.mockResolvedValue(catalog(1));
    mocks.getManifest.mockResolvedValue(MANIFEST);
    mocks.repo.loadCollection.mockResolvedValue(loaded(collectionState()));

    const shell = new UltimateRunShell();
    const pending = shell.refresh();
    shell.dispose();
    resolveState(collectionState());
    await pending;

    expect(shell.phase).toBe('loading');
    expect(shell.state).toBeNull();
    expect(shell.catalog).toBeNull();
  });

  it('does not start reloads after disposal', async () => {
    const shell = new UltimateRunShell();
    shell.dispose();

    await expect(shell.reloadCollection()).resolves.toBeNull();
    expect(mocks.ensureCollection).not.toHaveBeenCalled();
  });
});
