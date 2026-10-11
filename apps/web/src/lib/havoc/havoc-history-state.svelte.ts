import type { HavocComparison, HavocHistoryView, HavocReport, HavocRunView, HavocService } from '@hoop-rush/data-contracts';
import { HavocServiceError } from './havoc-service-contract.ts';

export interface HavocHistoryDetail {
  run: HavocRunView;
  report: HavocReport | null;
  comparison: HavocComparison | null;
}

function errorMessageOf(error: unknown): string {
  if (error instanceof HavocServiceError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

export class HavocHistoryState {
  entries = $state.raw<HavocHistoryView[]>([]);
  detail = $state.raw<HavocHistoryDetail | null>(null);
  loading = $state(true);
  detailLoading = $state(false);
  error = $state<string | null>(null);

  private readonly service: HavocService;
  private destroyed = false;

  constructor(service: HavocService) {
    this.service = service;
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const entries = await this.service.listHistory();
      if (this.destroyed) return;
      this.entries = entries;
    } catch (error) {
      if (!this.destroyed) this.error = errorMessageOf(error);
    } finally {
      if (!this.destroyed) this.loading = false;
    }
  }

  async loadRun(runId: string): Promise<void> {
    this.detailLoading = true;
    this.error = null;
    try {
      const detail = await this.service.readCompletedRun(runId);
      if (this.destroyed) return;
      this.detail = detail;
      if (detail === null) this.error = `No completed Havoc run with id ${runId} was found.`;
    } catch (error) {
      if (!this.destroyed) this.error = errorMessageOf(error);
    } finally {
      if (!this.destroyed) this.detailLoading = false;
    }
  }

  destroy(): void {
    this.destroyed = true;
  }
}
