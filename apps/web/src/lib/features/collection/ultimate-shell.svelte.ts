import type {
  CollectionCatalog,
  CollectionState,
  HoopRushManifest,
} from '@hoop-rush/data-contracts';
import type { LoadedCollection } from '@hoop-rush/persistence';
import { getManifest } from '$lib/data';
import { getCollectionRepo, ensureCollection } from './collection-hub.ts';
import { loadCollectionCatalog } from './collection-assets.ts';

export const ULTIMATE_RUN_SHELL_CONTEXT = 'hoop-rush:ultimate-run-shell';

export interface UltimateRunSnapshot {
  balances: { Coins: number; Exchange: number };
  ownedCount: number;
  totalCount: number;
  claimedWelcome: boolean;
  activeTargetPlayerId: string | null;
  latestPull: {
    pullSequence: number;
    packId: string | null;
    newCount: number;
    exchangeGained: number;
  } | null;
}

function snapshotOf(state: CollectionState, totalCount: number): UltimateRunSnapshot {
  return {
    balances: { ...state.balances },
    ownedCount: state.owned.length,
    totalCount,
    claimedWelcome: state.claimedWelcome,
    activeTargetPlayerId: state.activeTargetPlayerId,
    latestPull: null,
  };
}

function latestPullOf(saved: LoadedCollection | null): UltimateRunSnapshot['latestPull'] {
  const pull = saved?.pulls.at(-1) ?? null;
  if (pull === null) return null;
  const exchangeGained = (saved?.ledger ?? [])
    .filter(
      (entry) =>
        entry.pullSequence === pull.pullSequence && entry.reason === 'duplicate-conversion',
    )
    .reduce((total, entry) => total + entry.amount, 0);
  return {
    pullSequence: pull.pullSequence,
    packId: pull.packId ?? null,
    newCount: pull.slots.filter((slot) => slot.kept).length,
    exchangeGained,
  };
}

export class UltimateRunShell {
  snapshot = $state<UltimateRunSnapshot | null>(null);
  loading = $state(true);
  error = $state<string | null>(null);
  catalogError = $state<string | null>(null);
  announcement = $state('');
  manifest = $state<HoopRushManifest | null>(null);
  catalog = $state<CollectionCatalog | null>(null);
  state = $state<CollectionState | null>(null);
  phase = $state<'loading' | 'error' | 'ready'>('loading');
  private latestPull: UltimateRunSnapshot['latestPull'] = null;
  private totalCount = 0;
  private epoch = 0;
  private inFlight: Promise<void> | null = null;
  private disposed = false;

  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.inFlight !== null) return this.inFlight;
    const started = this.load();
    this.inFlight = started.finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  dispose(): void {
    this.disposed = true;
    this.epoch += 1;
    this.inFlight = null;
  }

  sync(state: CollectionState, totalCount = this.totalCount): void {
    if (this.disposed) return;
    this.totalCount = totalCount;
    this.state = state;
    this.snapshot = { ...snapshotOf(state, totalCount), latestPull: this.latestPull };
  }

  async reloadCollection(): Promise<CollectionState | null> {
    if (this.disposed) return null;
    const epoch = this.epoch;
    try {
      const ensured = await ensureCollection(new Date().toISOString());
      const repository = getCollectionRepo();
      const saved = await repository.loadCollection(ensured.collectionId);
      if (epoch !== this.epoch) return null;
      const state = saved?.state ?? ensured;
      this.latestPull = latestPullOf(saved);
      this.sync(state, this.totalCount);
      return state;
    } catch {
      return null;
    }
  }

  private async load(): Promise<void> {
    const epoch = ++this.epoch;
    this.loading = true;
    this.error = null;
    this.catalogError = null;
    this.phase = 'loading';
    try {
      const [state, catalogResult, manifest] = await Promise.all([
        ensureCollection(new Date().toISOString()),
        loadCollectionCatalog().then(
          (value) => ({ ok: true as const, value }),
          (failure: unknown) => ({ ok: false as const, failure }),
        ),
        getManifest(),
      ]);
      const repository = getCollectionRepo();
      const saved = await repository.loadCollection(state.collectionId);
      if (epoch !== this.epoch) return;
      this.manifest = manifest;
      if (catalogResult.ok) {
        this.catalog = catalogResult.value;
        this.catalogError = null;
      } else {
        this.catalog = null;
        this.catalogError =
          catalogResult.failure instanceof Error
            ? catalogResult.failure.message
            : 'The collection catalog is unavailable.';
      }
      this.latestPull = latestPullOf(saved);
      this.sync(state, catalogResult.ok ? catalogResult.value.cards.length : this.totalCount);
      this.phase = 'ready';
    } catch (failure) {
      if (epoch !== this.epoch) return;
      this.error = failure instanceof Error ? failure.message : 'Ultimate Run could not load.';
      this.phase = 'error';
    } finally {
      if (epoch === this.epoch) this.loading = false;
    }
  }
}
