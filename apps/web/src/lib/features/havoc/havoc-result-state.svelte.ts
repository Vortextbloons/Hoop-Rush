import type { HavocComparison, HavocReport } from '@hoop-rush/data-contracts';
import type {
  HavocRunView,
  HavocService,
  HavocServiceEvent,
  HavocSimulationProgress,
} from '@hoop-rush/application/havoc';
import { HAVOC_GAME_COUNT } from '@hoop-rush/data-contracts';
import { errorMessageOf } from './havoc-state-util.ts';

export class HavocResultState {
  run = $state.raw<HavocRunView | null>(null);
  report = $state.raw<HavocReport | null>(null);
  comparison = $state.raw<HavocComparison | null>(null);
  loading = $state(true);
  busy = $state(false);
  cancelling = $state(false);
  progress = $state.raw<HavocSimulationProgress | null>(null);
  error = $state<string | null>(null);
  notice = $state<string | null>(null);

  private readonly service: HavocService;
  private unsubscribe: (() => void) | null = null;
  private destroyed = false;

  private isDestroyed(): boolean {
    return this.destroyed;
  }

  constructor(service: HavocService) {
    this.service = service;
    this.unsubscribe = service.subscribe((event) => {
      this.onEvent(event);
    });
  }

  private onEvent(event: HavocServiceEvent): void {
    if (this.isDestroyed()) return;
    if (event.type === 'progress') {
      this.progress = event.progress;
    } else if (event.type === 'comparison-updated') {
      this.comparison = event.comparison;
    } else if (event.type === 'error') {
      this.error = event.message;
    }
  }

  get comparisonComplete(): boolean {
    return this.run?.comparisonStatus === 'complete' && this.comparison !== null;
  }

  get baselineVisible(): boolean {
    return this.comparisonComplete;
  }

  get havocSeasonComplete(): boolean {
    return (this.run?.havocCursor ?? 0) >= HAVOC_GAME_COUNT;
  }

  get normalGamesCompleted(): number {
    return this.run?.normalCursor ?? 0;
  }

  async load(): Promise<void> {
    if (this.isDestroyed()) return;
    if (this.run === null) this.loading = true;
    this.error = null;
    try {
      const snapshot = await this.service.loadActive();
      if (this.isDestroyed()) return;
      if (snapshot.run === null) {
        this.run = null;
        this.report = null;
        this.comparison = null;
        const history = await this.service.listHistory();
        if (this.isDestroyed()) return;
        const latest = history.find((entry) => entry.completionState === 'complete');
        if (latest !== undefined) {
          const saved = await this.service.readCompletedRun(latest.runId);
          if (this.isDestroyed()) return;
          if (saved !== null) {
            this.run = saved.run;
            this.report = saved.report;
            this.comparison = saved.comparison;
          }
        }
        return;
      }
      const report = await this.service.readReport();
      if (this.isDestroyed()) return;
      const comparison =
        snapshot.run.comparisonStatus === 'complete' ? await this.service.readComparison() : null;
      if (this.isDestroyed()) return;
      this.run = snapshot.run;
      this.report = report;
      this.comparison = comparison;
    } catch (error) {
      if (!this.isDestroyed()) this.error = errorMessageOf(error);
    } finally {
      if (!this.isDestroyed()) this.loading = false;
    }
  }

  async runNormalSeason(): Promise<void> {
    if (this.busy || this.isDestroyed()) return;
    this.busy = true;
    this.error = null;
    this.notice = null;
    this.progress = null;
    try {
      const batch = await this.service.startNormalSeason();
      if (this.isDestroyed()) return;
      await this.load();
      if (this.isDestroyed()) return;
      const run = this.run;
      if (
        !batch.cancelled &&
        run !== null &&
        run.normalCursor >= HAVOC_GAME_COUNT &&
        run.comparisonStatus === 'running'
      ) {
        await this.service.finalizeComparison();
        await this.load();
      } else if (batch.cancelled) {
        this.notice = `Normal season paused at game ${String(batch.nextCursor)}. Its results stay hidden until all 82 games finish.`;
      }
    } catch (error) {
      if (!this.isDestroyed()) this.error = errorMessageOf(error);
    } finally {
      if (!this.isDestroyed()) this.busy = false;
    }
  }

  async cancelComparison(): Promise<void> {
    if (this.cancelling || this.isDestroyed()) return;
    this.cancelling = true;
    try {
      await this.service.cancelSimulation();
    } catch (error) {
      if (!this.isDestroyed()) this.error = errorMessageOf(error);
    } finally {
      if (!this.isDestroyed()) this.cancelling = false;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
