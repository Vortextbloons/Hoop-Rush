import type {
  HavocGameSummary,
  HavocRunView,
  HavocService,
  HavocServiceEvent,
  HavocSimulationProgress,
} from '@hoop-rush/data-contracts';
import {
  foldHavocSeasonStats,
  type HavocSeasonStats,
} from '$lib/components/havoc/havoc-presentation';
import { HavocServiceError } from './havoc-service-contract.ts';
import { HavocGamecastState } from './havoc-gamecast-state.svelte.ts';

function errorMessageOf(error: unknown): string {
  if (error instanceof HavocServiceError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

export class HavocHubState {
  run = $state.raw<HavocRunView | null>(null);
  games = $state.raw<HavocGameSummary[]>([]);
  loading = $state(true);
  busy = $state(false);
  cancelling = $state(false);
  watchBusy = $state(false);
  progress = $state.raw<HavocSimulationProgress | null>(null);
  error = $state<string | null>(null);
  notice = $state<string | null>(null);
  seasonStats = $state.raw<HavocSeasonStats | null>(null);
  statsLoading = $state(false);
  gamecast = $state.raw<HavocGamecastState | null>(null);

  private readonly service: HavocService;
  private unsubscribe: (() => void) | null = null;
  private destroyed = false;
  private statsRequested = false;

  constructor(service: HavocService) {
    this.service = service;
    this.unsubscribe = service.subscribe((event) => this.onEvent(event));
  }

  private onEvent(event: HavocServiceEvent): void {
    if (this.destroyed) return;
    if (event.type === 'progress') {
      this.progress = event.progress;
    } else if (event.type === 'error') {
      this.error = event.message;
    }
  }

  async load(): Promise<void> {
    if (this.run === null) this.loading = true;
    try {
      const snapshot = await this.service.loadActive();
      if (this.destroyed) return;
      this.run = snapshot.run;
      if (snapshot.run === null) {
        this.games = [];
        return;
      }
      const games = await this.service.listGames('havoc');
      if (this.destroyed) return;
      this.games = games;
    } catch (error) {
      if (!this.destroyed) this.error = errorMessageOf(error);
    } finally {
      if (!this.destroyed) this.loading = false;
    }
  }

  private async simulate(count: number | 'remaining'): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.cancelling = false;
    this.error = null;
    this.notice = null;
    this.progress = null;
    try {
      const batch = await this.service.simulateRange({ variant: 'havoc', count });
      if (this.destroyed) return;
      await this.load();
      if (this.destroyed) return;
      if (batch.cancelled) {
        this.notice = `Simulation paused at game ${String(batch.nextCursor)}. Already accepted games are safe.`;
      }
      if (this.statsRequested) void this.loadSeasonStats();
    } catch (error) {
      if (!this.destroyed) this.error = errorMessageOf(error);
    } finally {
      if (!this.destroyed) {
        this.busy = false;
        this.cancelling = false;
      }
    }
  }

  async nextGame(): Promise<void> {
    await this.simulate(1);
  }

  async nextTen(): Promise<void> {
    await this.simulate(10);
  }

  async finishSeason(): Promise<void> {
    await this.simulate('remaining');
  }

  async cancel(): Promise<void> {
    if (!this.busy) return;
    this.cancelling = true;
    try {
      await this.service.cancelSimulation();
    } catch (error) {
      this.error = errorMessageOf(error);
    }
  }

  async watchNext(): Promise<void> {
    const gameNumber = this.run?.nextGameNumber ?? null;
    if (gameNumber === null || this.watchBusy) return;
    this.watchBusy = true;
    this.error = null;
    try {
      const session = await this.service.watchGame({ gameNumber, variant: 'havoc' });
      const result = await this.service.readGame({ gameNumber, variant: 'havoc' });
      if (this.destroyed) return;
      this.gamecast = new HavocGamecastState(this.service, session, result);
    } catch (error) {
      if (!this.destroyed) this.error = errorMessageOf(error);
    } finally {
      if (!this.destroyed) this.watchBusy = false;
    }
  }

  async acceptWatchedGame(): Promise<void> {
    const gamecast = this.gamecast;
    if (gamecast === null || this.busy) return;
    this.busy = true;
    this.error = null;
    try {
      const accepted = await gamecast.accept();
      if (!accepted) {
        this.error = gamecast.error;
        return;
      }
      await this.load();
      if (this.statsRequested) void this.loadSeasonStats();
    } finally {
      if (!this.destroyed) this.busy = false;
    }
  }

  closeGamecast(): void {
    this.gamecast?.destroy();
    this.gamecast = null;
  }

  async loadSeasonStats(): Promise<void> {
    if (this.statsLoading) return;
    this.statsRequested = true;
    this.statsLoading = true;
    this.error = null;
    try {
      const results = [];
      for (const summary of this.games) {
        const result = await this.service.readGame({ gameNumber: summary.gameNumber, variant: 'havoc' });
        if (result !== null) results.push(result);
      }
      if (this.destroyed) return;
      this.seasonStats = foldHavocSeasonStats(results);
    } catch (error) {
      if (!this.destroyed) this.error = errorMessageOf(error);
    } finally {
      if (!this.destroyed) this.statsLoading = false;
    }
  }

  async abandon(): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    this.error = null;
    try {
      const result = await this.service.abandon();
      if (this.destroyed) return false;
      if (result.status === 'rejected') {
        this.error = result.rejection?.message ?? 'The run could not be abandoned.';
        return false;
      }
      this.closeGamecast();
      this.run = null;
      this.games = [];
      this.seasonStats = null;
      return true;
    } catch (error) {
      if (!this.destroyed) this.error = errorMessageOf(error);
      return false;
    } finally {
      if (!this.destroyed) this.busy = false;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.closeGamecast();
  }
}
