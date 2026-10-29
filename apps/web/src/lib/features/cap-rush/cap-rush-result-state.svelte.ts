import type { CapRushReport } from '@hoop-rush/data-contracts';
import type { CapRushService } from '@hoop-rush/application/cap-rush';

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class CapRushResultState {
  report = $state.raw<CapRushReport | null>(null);
  loading = $state(true);
  seasonInProgress = $state(false);
  postseasonInProgress = $state(false);
  busy = $state(false);
  error = $state<string | null>(null);

  private readonly service: CapRushService;
  private destroyed = false;

  constructor(service: CapRushService) {
    this.service = service;
  }

  private isDestroyed(): boolean {
    return this.destroyed;
  }

  async load(): Promise<void> {
    this.error = null;
    try {
      const snapshot = await this.service.loadActive();
      if (this.isDestroyed()) return;
      const draft = snapshot.draft;
      if (draft === null) {
        this.report = null;
        return;
      }
      if (draft.draft.stage !== 'completed') {
        this.seasonInProgress = draft.draft.stage === 'locked';
        this.postseasonInProgress = draft.draft.stage === 'postseason';
        this.report = null;
        return;
      }
      const report = await this.service.loadReport(draft.draft.runId);
      if (this.isDestroyed()) return;
      this.report = report;
      if (report === null) this.error = 'The stored report for this run is unavailable.';
    } catch (error) {
      if (!this.isDestroyed()) this.error = errorMessageOf(error);
    } finally {
      if (!this.isDestroyed()) this.loading = false;
    }
  }

  async loadRun(runId: string): Promise<void> {
    this.error = null;
    try {
      const report = await this.service.loadReport(runId);
      if (this.isDestroyed()) return;
      this.report = report;
      if (report === null) this.error = `No completed Cap Rush run with id ${runId} was found.`;
    } catch (error) {
      if (!this.isDestroyed()) this.error = errorMessageOf(error);
    } finally {
      if (!this.isDestroyed()) this.loading = false;
    }
  }

  async startNewRun(): Promise<boolean> {
    if (this.busy || this.isDestroyed()) return false;
    this.busy = true;
    this.error = null;
    try {
      await this.service.abandonDraft();
      return !this.isDestroyed();
    } catch (error) {
      if (!this.isDestroyed()) this.error = errorMessageOf(error);
      return false;
    } finally {
      if (!this.isDestroyed()) this.busy = false;
    }
  }

  destroy(): void {
    this.destroyed = true;
  }
}
