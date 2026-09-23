import type { CollectionState } from '@hoop-rush/data-contracts';
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

export class UltimateRunShell {
  snapshot = $state<UltimateRunSnapshot | null>(null);
  loading = $state(true);
  error = $state<string | null>(null);
  announcement = $state('');
  private latestPull: UltimateRunSnapshot['latestPull'] = null;
  private totalCount = 0;

  async refresh(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const [state, catalog] = await Promise.all([
        ensureCollection(new Date().toISOString()),
        loadCollectionCatalog(),
      ]);
      const repository = getCollectionRepo();
      const saved = await repository.loadCollection(state.collectionId);
      const latestPull = saved?.pulls.at(-1);
      if (latestPull) {
        const exchangeGained = (saved?.ledger ?? [])
          .filter(
            (entry) =>
              entry.pullSequence === latestPull.pullSequence &&
              entry.reason === 'duplicate-conversion',
          )
          .reduce((total, entry) => total + entry.amount, 0);
        this.latestPull = {
          pullSequence: latestPull.pullSequence,
          packId: latestPull.packId ?? null,
          newCount: latestPull.slots.filter((slot) => slot.kept).length,
          exchangeGained,
        };
      } else {
        this.latestPull = null;
      }
      this.sync(state, catalog.cards.length);
    } catch (failure) {
      this.error = failure instanceof Error ? failure.message : 'Ultimate Run could not load.';
    } finally {
      this.loading = false;
    }
  }

  sync(state: CollectionState, totalCount = this.totalCount): void {
    this.totalCount = totalCount;
    this.snapshot = { ...snapshotOf(state, totalCount), latestPull: this.latestPull };
  }
}
