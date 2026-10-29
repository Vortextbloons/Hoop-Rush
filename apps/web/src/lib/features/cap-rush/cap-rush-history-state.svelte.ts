import type { CapRushHistoryEntry } from '@hoop-rush/data-contracts';
import type { CapRushService } from '@hoop-rush/application/cap-rush';

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class CapRushHistoryState {
  entries = $state.raw<CapRushHistoryEntry[]>([]);
  loading = $state(true);
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
    this.loading = true;
    this.error = null;
    try {
      const entries = await this.service.listHistory();
      if (this.isDestroyed()) return;
      this.entries = [...entries];
    } catch (error) {
      if (!this.isDestroyed()) this.error = errorMessageOf(error);
    } finally {
      if (!this.isDestroyed()) this.loading = false;
    }
  }

  destroy(): void {
    this.destroyed = true;
  }
}
