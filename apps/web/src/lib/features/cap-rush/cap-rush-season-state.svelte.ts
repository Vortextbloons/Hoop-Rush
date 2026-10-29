import {
  CAP_RUSH_GAME_COUNT,
  type CapRushReport,
  type CapRushStoredGame,
} from '@hoop-rush/data-contracts';
import {
  CapRushServiceError,
  type CapRushDraftView,
  type CapRushService,
} from '@hoop-rush/application/cap-rush';
import { newRequestId } from '#lib/ids.js';
import type { CapRushRunner } from './cap-rush-runner.ts';

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface CapRushSeasonProgress {
  readonly completed: number;
  readonly total: number;
}

export class CapRushSeasonController {
  draft = $state.raw<CapRushDraftView | null>(null);
  games = $state.raw<CapRushStoredGame[]>([]);
  report = $state.raw<CapRushReport | null>(null);
  progress = $state.raw<CapRushSeasonProgress | null>(null);
  loading = $state(true);
  busy = $state(false);
  cancelling = $state(false);
  error = $state<string | null>(null);
  notice = $state<string | null>(null);
  unsupported = $state(false);

  private readonly service: CapRushService;
  private readonly runner: CapRushRunner;
  private destroyed = false;

  constructor(service: CapRushService, runner: CapRushRunner) {
    this.service = service;
    this.runner = runner;
  }

  private isDestroyed(): boolean {
    return this.destroyed;
  }

  async load(): Promise<void> {
    this.error = null;
    try {
      const snapshot = await this.service.loadActive();
      if (this.isDestroyed()) return;
      this.draft = snapshot.draft;
    } catch (error) {
      if (!this.isDestroyed()) {
        this.error = errorMessageOf(error);
        this.unsupported =
          error instanceof CapRushServiceError && error.code === 'unsupported-version';
      }
    } finally {
      if (!this.isDestroyed()) this.loading = false;
    }
  }

  async playSeason(): Promise<boolean> {
    const view = this.draft;
    if (this.busy || this.isDestroyed()) return false;
    if (view === null || view.draft.locked === null || view.draft.stage !== 'locked') return false;
    if (view.season !== null && view.season.completedAt !== null) {
      this.notice = 'The season is already complete.';
      return true;
    }
    const start = view.season?.nextGameNumber ?? 1;
    this.busy = true;
    this.cancelling = false;
    this.error = null;
    this.notice = null;
    try {
      const complete = await this.runner.simulate({
        requestId: newRequestId('cap-rush-season'),
        locked: view.draft.locked,
        startGame: start,
        count: CAP_RUSH_GAME_COUNT - start + 1,
        handlers: {
          onGame: async (message) => {
            await this.service.acceptGame({
              cursor: message.cursor,
              inputDigest: message.inputDigest,
              resultDigest: message.resultDigest,
              isolations: message.isolations,
              strikes: message.strikes,
              summary: message.summary,
              stored: {
                gameNumber: message.cursor,
                summary: message.summary,
                audit: message.audit,
                result: message.result,
              },
            });
            if (this.isDestroyed()) return;
            this.games = [
              ...this.games,
              {
                gameNumber: message.cursor,
                summary: message.summary,
                audit: message.audit,
                result: message.result,
              },
            ].sort((left, right) => left.gameNumber - right.gameNumber);
            this.draft = this.service.getSnapshot().draft;
          },
          onProgress: (message) => {
            if (!this.isDestroyed()) {
              this.progress = { completed: message.gamesCompleted, total: message.gamesTotal };
            }
          },
          onError: (message) => {
            if (!this.isDestroyed()) this.error = message.message;
          },
        },
      });
      if (this.isDestroyed()) return false;
      await this.load();
      if (this.isDestroyed()) return false;
      if (complete.cancelled) {
        this.notice = `Season paused after game ${String(complete.lastCursor)}. Accepted games are saved.`;
        return false;
      }
      return await this.finalizeSeason();
    } catch (error) {
      if (!this.isDestroyed()) this.error = errorMessageOf(error);
      return false;
    } finally {
      if (!this.isDestroyed()) {
        this.busy = false;
        this.cancelling = false;
        this.progress = null;
      }
    }
  }

  async finalizeSeason(): Promise<boolean> {
    if (this.draft === null || this.isDestroyed()) return false;
    try {
      this.report = await this.service.finalizeSeason();
      if (this.isDestroyed()) return false;
      await this.load();
      return true;
    } catch (error) {
      if (!this.isDestroyed()) this.error = errorMessageOf(error);
      return false;
    }
  }

  cancel(): void {
    if (!this.busy) return;
    this.cancelling = true;
    this.runner.cancel();
  }

  destroy(): void {
    this.destroyed = true;
    this.runner.destroy();
  }
}
