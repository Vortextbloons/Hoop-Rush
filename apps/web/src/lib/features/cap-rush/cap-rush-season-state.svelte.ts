import {
  CAP_RUSH_GAME_COUNT,
  type CapRushPlayoffGamePlan,
  type CapRushReport,
  type CapRushStoredGame,
  type CapRushStoredPlayoffGame,
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
  playoffGames = $state.raw<CapRushStoredPlayoffGame[]>([]);
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
      const runId = snapshot.draft?.draft.runId;
      if (runId !== undefined && (snapshot.draft?.season?.games.length ?? 0) > 0) {
        const stored = await this.service.listRunGames(runId);
        if (this.isDestroyed()) return;
        this.games = [...stored].sort((left, right) => left.gameNumber - right.gameNumber);
      } else {
        this.games = [];
      }
      if (runId !== undefined && (snapshot.draft?.postseason?.series.length ?? 0) > 0) {
        const stored = await this.service.listPlayoffGames(runId);
        if (this.isDestroyed()) return;
        this.playoffGames = [...stored];
      } else {
        this.playoffGames = [];
      }
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
    if (start > CAP_RUSH_GAME_COUNT) {
      const report = await this.service.finalizeSeason();
      if (this.isDestroyed()) return false;
      await this.load();
      if (report === null) return false;
      this.report = report;
      return true;
    }
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
      const report = await this.service.finalizeSeason();
      if (this.isDestroyed()) return false;
      await this.load();
      if (this.isDestroyed()) return false;
      if (report === null) return false;
      this.report = report;
      return true;
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

  async advancePostseason(): Promise<boolean> {
    if (this.busy || this.isDestroyed() || this.draft === null) return false;
    this.busy = true;
    this.cancelling = false;
    this.error = null;
    this.notice = null;
    try {
      if (this.draft.draft.stage === 'locked') {
        if (this.draft.season === null || this.draft.season.games.length !== CAP_RUSH_GAME_COUNT) {
          return false;
        }
        const report = await this.service.finalizeSeason();
        if (this.isDestroyed()) return false;
        if (report !== null) {
          this.report = report;
          return true;
        }
        await this.load();
        if (this.isDestroyed()) return false;
      }
      for (let iteration = 0; iteration < 200; iteration += 1) {
        if (this.isDestroyed()) return false;
        const step = this.service.postseasonStep();
        if (step.kind === 'standings') {
          await this.completeStandings();
          return false;
        }
        if (step.kind === 'finalize') {
          this.report = await this.service.finalizePostseason();
          if (this.isDestroyed()) return false;
          await this.load();
          return !this.isDestroyed();
        }
        if (step.kind === 'complete') {
          if (this.report !== null) return true;
          await this.load();
          return false;
        }
        if (step.games.length === 0) {
          this.notice = 'The bracket is waiting on an accepted result. Reopen the run to resume.';
          return false;
        }
        const userGames = await this.simulatePlayoffBatch(step.games);
        if (this.isDestroyed() || userGames === null) return false;
        const next = this.service.postseasonStep();
        if (next.kind === 'complete' && this.report !== null) return true;
        const outcome = this.draft.postseason?.userOutcome.status ?? 'pending';
        if (userGames > 0 && outcome !== 'eliminated' && outcome !== 'not-qualified') {
          return false;
        }
        if (next.kind === 'games' && next.games.some((game) => game.userSide !== null)) {
          return false;
        }
      }
      this.notice = 'The postseason paused before completion. Reopen the run to resume.';
      return false;
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

  private async completeStandings(): Promise<boolean> {
    const view = this.draft;
    if (view === null || view.draft.locked === null) {
      throw new Error('there is no locked cap rush run');
    }
    const bracket = await this.service.loadBracket();
    const complete = await this.runner.simulateStandings({
      requestId: newRequestId('cap-rush-standings'),
      locked: view.draft.locked,
      bracket,
      handlers: {
        onProgress: (message) => {
          if (!this.isDestroyed()) {
            this.progress = { completed: message.gamesCompleted, total: message.gamesTotal };
          }
        },
      },
    });
    if (this.isDestroyed()) return false;
    if (complete.cancelled || complete.result === null) {
      this.notice = 'Standings completion paused. Accepted work is safe.';
      return false;
    }
    await this.service.acceptStandings(complete.result);
    if (this.isDestroyed()) return false;
    await this.load();
    return true;
  }

  private async simulatePlayoffBatch(
    games: readonly CapRushPlayoffGamePlan[],
  ): Promise<number | null> {
    const view = this.draft;
    if (view === null || view.draft.locked === null) {
      throw new Error('there is no locked cap rush run');
    }
    let userGames = 0;
    const complete = await this.runner.simulatePlayoffs({
      requestId: newRequestId('cap-rush-playoffs'),
      locked: view.draft.locked,
      games,
      handlers: {
        onGame: async (message) => {
          await this.service.acceptPlayoffGame({
            summary: message.game.summary,
            stored: message.game,
          });
          if (this.isDestroyed()) return;
          if (message.game.summary.userSide !== null) userGames += 1;
          this.playoffGames = [
            ...this.playoffGames.filter((entry) => entry.gameId !== message.game.gameId),
            message.game,
          ];
          this.draft = this.service.getSnapshot().draft;
        },
        onError: (message) => {
          if (!this.isDestroyed()) this.error = message.message;
        },
      },
    });
    if (this.isDestroyed()) return null;
    if (complete.cancelled) {
      this.notice = 'The postseason paused. Accepted games are saved.';
      return null;
    }
    await this.load();
    return userGames;
  }

  async finalizeSeason(): Promise<boolean> {
    if (this.draft === null || this.isDestroyed()) return false;
    try {
      const report = await this.service.finalizeSeason();
      if (this.isDestroyed()) return false;
      await this.load();
      if (report === null) return false;
      this.report = report;
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
