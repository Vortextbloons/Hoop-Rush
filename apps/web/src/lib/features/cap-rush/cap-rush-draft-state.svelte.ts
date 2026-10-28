import {
  CapRushServiceError,
  type CapRushDraftView,
  type CapRushService,
} from '@hoop-rush/application/cap-rush';
import type { CapRushVariant, Position } from '@hoop-rush/data-contracts';

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class CapRushDraftController {
  draft = $state.raw<CapRushDraftView | null>(null);
  loading = $state(true);
  busy = $state(false);
  error = $state<string | null>(null);
  unsupported = $state(false);

  private readonly service: CapRushService;
  private destroyed = false;

  constructor(service: CapRushService) {
    this.service = service;
  }

  async load(): Promise<void> {
    try {
      const snapshot = await this.service.loadActive();
      if (this.destroyed) return;
      this.draft = snapshot.draft;
    } catch (error) {
      if (!this.destroyed) {
        this.error = errorMessageOf(error);
        this.unsupported =
          error instanceof CapRushServiceError && error.code === 'unsupported-version';
      }
    } finally {
      if (!this.destroyed) this.loading = false;
    }
  }

  private async runCommand(command: () => Promise<void>): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    this.error = null;
    try {
      await command();
      if (!this.destroyed) {
        this.draft = this.service.getSnapshot().draft;
      }
      return true;
    } catch (error) {
      if (!this.destroyed) this.error = errorMessageOf(error);
      return false;
    } finally {
      if (!this.destroyed) this.busy = false;
    }
  }

  createDraft(variant: CapRushVariant): Promise<boolean> {
    return this.runCommand(() => this.service.createDraft(variant));
  }

  choosePosition(slot: Position): Promise<boolean> {
    return this.runCommand(() => this.service.choosePosition(slot));
  }

  reroll(protectedCardId: string): Promise<boolean> {
    return this.runCommand(() => this.service.rerollOffer(protectedCardId));
  }

  sign(cardId: string): Promise<boolean> {
    return this.runCommand(() => this.service.signCard(cardId));
  }

  async discard(): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    this.error = null;
    this.unsupported = false;
    try {
      await this.service.abandonDraft();
      if (!this.destroyed) this.draft = null;
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
  }
}
