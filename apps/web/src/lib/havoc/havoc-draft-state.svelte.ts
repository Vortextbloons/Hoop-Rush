import type { HavocDraftState } from '@hoop-rush/data-contracts';
import type { HavocRunView, HavocService } from './havoc-service-contract.ts';
import { errorMessageOf } from './havoc-state-util.ts';

export class HavocDraftController {
  run = $state.raw<HavocRunView | null>(null);
  draft = $state.raw<HavocDraftState | null>(null);
  loading = $state(true);
  busy = $state(false);
  error = $state<string | null>(null);
  locked = $state(false);

  private readonly service: HavocService;
  private destroyed = false;

  constructor(service: HavocService) {
    this.service = service;
  }

  async load(): Promise<void> {
    try {
      const snapshot = await this.service.loadActive();
      if (this.destroyed) return;
      this.run = snapshot.run;
      this.draft = snapshot.draft;
    } catch (error) {
      if (!this.destroyed) this.error = errorMessageOf(error);
    } finally {
      if (!this.destroyed) this.loading = false;
    }
  }

  private async runCommand(
    command: () => Promise<{
      status: 'accepted' | 'rejected';
      rejection: { message: string } | null;
    }>,
  ): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    this.error = null;
    try {
      const result = await command();
      if (result.status === 'rejected') {
        this.error = result.rejection?.message ?? 'The draft rejected that action.';
        return false;
      }
      await this.load();
      return true;
    } catch (error) {
      this.error = errorMessageOf(error);
      return false;
    } finally {
      this.busy = false;
    }
  }

  async createDraft(): Promise<boolean> {
    return this.runCommand(() => this.service.createDraft());
  }

  async reroll(): Promise<boolean> {
    if (this.draft === null || this.draft.rerollUsed) return false;
    return this.runCommand(() => this.service.rerollOffer());
  }

  async pick(cardId: string): Promise<boolean> {
    return this.runCommand(() => this.service.pickCard(cardId));
  }

  async lockLineup(): Promise<boolean> {
    const accepted = await this.runCommand(() => this.service.lockLineup());
    if (accepted) this.locked = true;
    return accepted;
  }

  isUnsupportedVersionError(): boolean {
    return this.error !== null && this.error.includes('havoc-rules-v');
  }

  async discardStaleRun(): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    this.error = null;
    try {
      await this.service.discardStaleActiveRun();
      await this.load();
      return true;
    } catch (error) {
      this.error = errorMessageOf(error);
      return false;
    } finally {
      this.busy = false;
    }
  }

  destroy(): void {
    this.destroyed = true;
  }
}
