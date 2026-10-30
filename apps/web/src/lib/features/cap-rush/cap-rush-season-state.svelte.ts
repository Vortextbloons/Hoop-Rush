import {
  CAP_RUSH_GAME_COUNT,
  type CapRushLeagueGame,
  type CapRushPlayoffGamePlan,
  type CapRushReport,
  type CapRushStandingsGame,
  type CapRushStoredGame,
  type CapRushStoredPlayoffGame,
  type CapRushWorkerGameMessage,
} from '@hoop-rush/data-contracts';
import {
  CapRushServiceError,
  type CapRushDraftView,
  type CapRushService,
} from '@hoop-rush/application/cap-rush';
import {
  buildCapRushConferenceStandings,
  capRushBoxOf,
  capRushLeagueFieldOfLocked,
  capRushUserLeagueGameOf,
} from '@hoop-rush/engine';
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
  leagueGames = $state.raw<CapRushLeagueGame[]>([]);
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
  private aiLeagueGames: CapRushLeagueGame[] = [];
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
      if (runId !== undefined && (snapshot.draft?.season?.leagueGamesAccepted ?? 0) > 0) {
        const stored = await this.service.listLeagueGames(runId);
        if (this.isDestroyed()) return;
        this.aiLeagueGames = [...stored];
        this.leagueGames = [...stored, ...this.userLeagueGamesOf(snapshot.draft)];
      } else {
        this.aiLeagueGames = [];
        this.leagueGames = [];
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
          onGame: (message) => this.acceptUserGame(message),
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

  async playNextGame(): Promise<boolean> {
    const view = this.draft;
    if (this.busy || this.isDestroyed() || view === null || view.draft.locked === null)
      return false;
    if (view.draft.stage === 'postseason') {
      return this.simulatePostseasonBatch();
    }
    if (view.draft.stage !== 'locked') return false;
    if (view.season !== null && view.season.completedAt !== null) {
      this.notice = 'The regular season is complete.';
      return false;
    }
    const start = view.season?.nextGameNumber ?? 1;
    this.busy = true;
    this.cancelling = false;
    this.error = null;
    this.notice = null;
    try {
      const complete = await this.runner.simulate({
        requestId: newRequestId('cap-rush-game'),
        locked: view.draft.locked,
        startGame: start,
        count: 1,
        handlers: {
          onGame: (message) => this.acceptUserGame(message),
          onError: (message) => {
            if (!this.isDestroyed()) this.error = message.message;
          },
        },
      });
      if (this.isDestroyed()) return false;
      await this.load();
      if (this.isDestroyed()) return false;
      if (complete.cancelled) {
        this.notice = 'The game did not finish. Accepted results are saved.';
        return false;
      }
      if (this.draft?.season !== null && this.draft?.season.completedAt === null) {
        const played = this.draft?.season.games.length ?? 0;
        if (played === CAP_RUSH_GAME_COUNT) await this.service.finalizeSeason();
        if (this.isDestroyed()) return false;
        await this.load();
      }
      return !this.isDestroyed();
    } catch (error) {
      if (!this.isDestroyed()) this.error = errorMessageOf(error);
      return false;
    } finally {
      if (!this.isDestroyed()) {
        this.busy = false;
        this.cancelling = false;
      }
    }
  }

  async simSeries(): Promise<boolean> {
    if (this.busy || this.isDestroyed() || this.draft === null) return false;
    if (this.draft.draft.stage !== 'postseason') return false;
    this.busy = true;
    this.cancelling = false;
    this.error = null;
    this.notice = null;
    try {
      if (this.draft.postseason === null) return false;
      const userTeamId = this.draft.draft.locked?.human.teamId;
      if (userTeamId === undefined) return false;
      const round = this.currentUserRound();
      if (round === null) return false;
      for (let iteration = 0; iteration < 16; iteration += 1) {
        if (this.isDestroyed()) return false;
        const step = this.service.postseasonStep();
        if (step.kind === 'standings') {
          await this.completeStandings();
          return false;
        }
        if (step.kind === 'finalize') {
          this.report = await this.service.finalizePostseason();
          await this.load();
          return !this.isDestroyed();
        }
        if (step.kind === 'complete') {
          await this.load();
          return false;
        }
        if (!step.games.some((game) => game.userSide !== null)) {
          this.notice = 'Your series is complete.';
          await this.load();
          return false;
        }
        await this.simulatePlayoffBatch(step.games, { stopWhenUserSeriesComplete: true });
        if (this.isDestroyed()) return false;
        const after = this.currentUserRound();
        if (after === null) {
          await this.load();
          return true;
        }
      }
      this.notice = 'The series paused. Reopen the run to resume.';
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

  async advancePostseason(): Promise<boolean> {
    if (this.busy || this.isDestroyed() || this.draft === null) return false;
    if (this.draft.draft.stage === 'locked') {
      if (this.draft.season === null || this.draft.season.games.length !== CAP_RUSH_GAME_COUNT) {
        return false;
      }
      this.busy = true;
      try {
        const report = await this.service.finalizeSeason();
        if (this.isDestroyed()) return false;
        if (report !== null) {
          this.report = report;
          return true;
        }
        await this.load();
      } catch (error) {
        if (!this.isDestroyed()) this.error = errorMessageOf(error);
        return false;
      } finally {
        if (!this.isDestroyed()) this.busy = false;
      }
      return !this.isDestroyed();
    }
    return this.simulatePostseasonBatch();
  }

  private async simulatePostseasonBatch(): Promise<boolean> {
    if (this.busy || this.isDestroyed() || this.draft === null) return false;
    this.busy = true;
    this.cancelling = false;
    this.error = null;
    this.notice = null;
    try {
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
        const outcome = this.draft.postseason?.userOutcome.status ?? 'pending';
        if (userGames > 0 && outcome !== 'eliminated' && outcome !== 'not-qualified') {
          return false;
        }
        const next = this.service.postseasonStep();
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

  private currentUserRound(): number | null {
    const postseason = this.draft?.postseason;
    const userTeamId = this.draft?.draft.locked?.human.teamId;
    if (postseason === null || postseason === undefined || userTeamId === undefined) return null;
    if (postseason.series.length === 0) return null;
    const round = Math.max(...postseason.series.map((series) => series.round));
    const series = postseason.series.find(
      (entry) =>
        entry.round === round &&
        (entry.highTeamId === userTeamId || entry.lowTeamId === userTeamId),
    );
    if (series === undefined) return null;
    const wins = series.games.filter((game) => game.winnerTeamId === userTeamId).length;
    const losses = series.games.filter((game) => game.winnerTeamId !== userTeamId).length;
    if (wins >= 4 || losses >= 4) return null;
    return round;
  }

  private async completeStandings(): Promise<boolean> {
    const view = this.draft;
    if (view === null || view.draft.locked === null) {
      throw new Error('there is no locked cap rush run');
    }
    const locked = view.draft.locked;
    if (locked.leagueSchedule !== undefined) {
      const leagueById = new Map(this.leagueGames.map((game) => [game.gameId, game]));
      const results: CapRushStandingsGame[] = this.leagueGames.map((game) => ({
        gameId: game.gameId,
        homeTeamId: game.homeTeamId,
        awayTeamId: game.awayTeamId,
        homePoints: game.homePoints,
        awayPoints: game.awayPoints,
      }));
      for (const game of this.games) {
        const entry = capRushUserLeagueGameOf(locked, game.gameNumber);
        if (leagueById.has(entry.gameId)) continue;
        const humanHome = entry.homeTeamId === locked.human.teamId;
        const humanPoints = game.summary.humanPoints;
        const opponentPoints = game.summary.opponentPoints;
        results.push({
          gameId: entry.gameId,
          homeTeamId: entry.homeTeamId,
          awayTeamId: entry.awayTeamId,
          homePoints: humanHome ? humanPoints : opponentPoints,
          awayPoints: humanHome ? opponentPoints : humanPoints,
        });
      }
      const standings = buildCapRushConferenceStandings({
        teams: capRushLeagueFieldOfLocked(locked),
        games: results,
      });
      await this.service.acceptConferenceStandings(standings);
      if (this.isDestroyed()) return false;
      await this.load();
      return true;
    }
    const bracket = await this.service.loadBracket();
    const complete = await this.runner.simulateStandings({
      requestId: newRequestId('cap-rush-standings'),
      locked,
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

  private async acceptUserGame(message: CapRushWorkerGameMessage): Promise<void> {
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
      ...(message.leagueGames === undefined ? {} : { leagueGames: message.leagueGames }),
    });
    if (this.isDestroyed()) return;
    this.games = [
      ...this.games.filter((game) => game.gameNumber !== message.cursor),
      {
        gameNumber: message.cursor,
        summary: message.summary,
        audit: message.audit,
        result: message.result,
      },
    ].sort((left, right) => left.gameNumber - right.gameNumber);
    if (message.leagueGames !== undefined) {
      this.aiLeagueGames = [...this.aiLeagueGames, ...message.leagueGames];
    }
    this.draft = this.service.getSnapshot().draft;
    this.leagueGames = [...this.aiLeagueGames, ...this.userLeagueGamesOf(this.draft)];
  }

  private userLeagueGamesOf(view: CapRushDraftView | null): CapRushLeagueGame[] {
    const locked = view?.draft.locked;
    if (locked === null || locked === undefined || locked.leagueSchedule === undefined) return [];
    return this.games.map((game) => this.userLeagueGameOf(locked, game));
  }

  private userLeagueGameOf(
    locked: NonNullable<CapRushDraftView['draft']['locked']>,
    game: CapRushStoredGame,
  ): CapRushLeagueGame {
    const entry = capRushUserLeagueGameOf(locked, game.gameNumber);
    const humanHome = entry.homeTeamId === locked.human.teamId;
    const homePoints = humanHome ? game.summary.humanPoints : game.summary.opponentPoints;
    const awayPoints = humanHome ? game.summary.opponentPoints : game.summary.humanPoints;
    return {
      gameId: entry.gameId,
      slot: entry.slot,
      homeTeamId: entry.homeTeamId,
      awayTeamId: entry.awayTeamId,
      homePoints,
      awayPoints,
      winnerTeamId: homePoints > awayPoints ? entry.homeTeamId : entry.awayTeamId,
      box: capRushBoxOf(game.result.home, game.result.away, game.result.overtimePeriods),
      inputDigest: game.summary.inputDigest,
      resultDigest: game.summary.resultDigest,
    };
  }

  private async simulatePlayoffBatch(
    games: readonly CapRushPlayoffGamePlan[],
    options: { stopWhenUserSeriesComplete?: boolean } = {},
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
    if (options.stopWhenUserSeriesComplete === true && this.currentUserRound() === null) {
      return userGames;
    }
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
