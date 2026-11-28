import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  capRushPlayoffSeriesId,
  capRushSeriesWinner,
  capRushSeriesWins,
  type FullCourtPlayoffCheckpoint,
  type FullCourtSeasonCheckpoint,
  type FullCourtSeasonScore,
  type FullCourtWatchedReplay,
} from '@hoop-rush/data-contracts';
import {
  fullCourtUserNextPlayoffMatchup,
  type FullCourtPlayoffLock,
  type FullCourtSeasonLock,
  type FullCourtSeasonSlotOptions,
} from '@hoop-rush/engine';
import type { FullCourtPlayoffAdvanceResult } from './playoffs.ts';
import {
  fullCourtNextReviewSlot,
  fullCourtPlayoffAdjustmentChanged,
  fullCourtRegularSeasonInjuryStop,
  fullCourtSlotOptions,
  fullCourtUserSeries,
  type FullCourtAdvanceOptions,
  type FullCourtAdvancePlayoffState,
  type FullCourtAdvanceSeasonState,
  type FullCourtPinnedGamePlan,
  type FullCourtPlayedGame,
  type FullCourtPlayoffView,
  type FullCourtSimulationStop,
} from './progression.ts';
import type { FullCourtSeasonAdvanceResult } from './season.ts';

export interface FullCourtAdvanceSeasonCommandInput {
  readonly lock: FullCourtSeasonLock;
  readonly expectedThroughSlot: number;
  readonly options?: FullCourtSeasonSlotOptions;
}

export interface FullCourtAdvancePlayoffCommandInput {
  readonly lock: FullCourtPlayoffLock;
  readonly expectedGames: number;
  readonly options?: FullCourtSeasonSlotOptions;
}

export type FullCourtPlayoffProgressionResult =
  | Exclude<FullCourtPlayoffAdvanceResult, { kind: 'simulated' }>
  | (Extract<FullCourtPlayoffAdvanceResult, { kind: 'simulated' }> & {
      readonly view: FullCourtPlayoffView;
    });

export interface FullCourtSeasonCommit {
  readonly checkpoint: FullCourtSeasonCheckpoint;
  readonly scores: readonly FullCourtSeasonScore[];
}

export interface FullCourtGamePlanClear {
  readonly runId: string;
  readonly gameId: string | null;
  readonly pinned: FullCourtPinnedGamePlan;
}

/**
 * Narrow host port for the browser controller. It receives committed states
 * and publishes them, but the advancement, accounting, and stop policy stays
 * here.
 */
export interface FullCourtAdvanceObserver {
  readonly isActive: () => boolean;
  readonly stopRequested: () => boolean;
  readonly progress: (completed: number, total: number) => void;
  readonly seasonCommitted: (commit: FullCourtSeasonCommit) => void;
  readonly playoffsCommitted: (state: FullCourtAdvancePlayoffState) => void;
  readonly publishedGame: (
    game: FullCourtPlayedGame | null,
    watchedReplay: FullCourtWatchedReplay | null,
  ) => void;
  readonly clearGamePlan: (input: FullCourtGamePlanClear) => Promise<void>;
  readonly archiveRun: (
    lock: FullCourtPlayoffLock,
    checkpoint: FullCourtPlayoffCheckpoint,
  ) => Promise<void>;
}

export interface FullCourtAdvanceSessionDependencies {
  readonly advanceSeasonSlot: (
    input: FullCourtAdvanceSeasonCommandInput,
  ) => Promise<FullCourtSeasonAdvanceResult>;
  readonly advancePlayoffGame: (
    input: FullCourtAdvancePlayoffCommandInput,
  ) => Promise<FullCourtPlayoffProgressionResult>;
  readonly observer: FullCourtAdvanceObserver;
}

export interface FullCourtAdvanceRequest {
  readonly count: number;
  readonly acceptForfeit: boolean;
  readonly record: boolean;
  readonly options: FullCourtAdvanceOptions;
  readonly season: FullCourtAdvanceSeasonState;
  readonly playoffs: FullCourtAdvancePlayoffState | null;
  readonly pinned: FullCourtPinnedGamePlan;
}

export type FullCourtAdvanceOutcome =
  | { readonly kind: 'finished'; readonly stop: FullCourtSimulationStop | null }
  | { readonly kind: 'decision'; readonly reason: 'rest-conflict' | 'confirm-forfeit' }
  | { readonly kind: 'stale' };

/**
 * Browser-free regular-season and playoff batch coordinator. Existing
 * application commands own per-step persistence; this session owns the batch
 * loop, user/bracket accounting, pinned plan scope, and stop policy.
 */
export class FullCourtAdvanceSession {
  readonly #dependencies: FullCourtAdvanceSessionDependencies;
  /**
   * The next-round series whose opponent change was already surfaced. It lets
   * the next sim play that series instead of stopping on the same boundary.
   */
  #controlReturnedForSeriesId: string | null = null;

  constructor(dependencies: FullCourtAdvanceSessionDependencies) {
    this.#dependencies = dependencies;
  }

  reset(): void {
    this.#controlReturnedForSeriesId = null;
  }

  advance(request: FullCourtAdvanceRequest): Promise<FullCourtAdvanceOutcome> {
    return request.playoffs === null
      ? this.#advanceRegularSeason(request)
      : this.#advancePlayoffs(request);
  }

  async #advanceRegularSeason(request: FullCourtAdvanceRequest): Promise<FullCourtAdvanceOutcome> {
    const { observer } = this.#dependencies;
    const { lock, coaching } = request.season;
    const userTeamId = lock.season.userTeamId;
    let season = request.season;
    let acceptNextForfeit = request.acceptForfeit;
    let played = 0;
    const total = Math.min(
      request.count,
      Math.max(0, CAP_RUSH_CONFERENCE_GAMES_PER_TEAM - season.checkpoint.completedThroughSlot),
    );
    if (total > 0) observer.progress(0, total);

    while (observer.isActive()) {
      if (observer.stopRequested()) {
        return { kind: 'finished', stop: { kind: 'stopped', userGames: played, bracketGames: 0 } };
      }
      if (season.checkpoint.completedThroughSlot >= CAP_RUSH_CONFERENCE_GAMES_PER_TEAM) {
        return {
          kind: 'finished',
          stop:
            request.count > 1 && played > 0
              ? { kind: 'game-limit', userGames: played, bracketGames: 0 }
              : null,
        };
      }
      if (played >= request.count) {
        return {
          kind: 'finished',
          stop:
            request.count > 1 && played > 0
              ? { kind: 'game-limit', userGames: played, bracketGames: 0 }
              : null,
        };
      }

      const slot = season.checkpoint.completedThroughSlot + 1;
      const completedBefore = season.checkpoint.completedThroughSlot;
      const userFixture = lock.season.games.find(
        (game) =>
          game.slot === slot && (game.homeTeamId === userTeamId || game.awayTeamId === userTeamId),
      );
      const userGameId = userFixture?.gameId ?? null;
      const outcome = await this.#dependencies.advanceSeasonSlot({
        lock,
        expectedThroughSlot: season.checkpoint.completedThroughSlot,
        options: fullCourtSlotOptions({
          coaching,
          pinned: request.pinned,
          userGameId,
          acceptForfeit: acceptNextForfeit,
          record: request.record && request.count === 1,
        }),
      });
      if (!observer.isActive()) return { kind: 'finished', stop: null };
      if (outcome.kind === 'decision') {
        return { kind: 'decision', reason: outcome.reason };
      }
      if (outcome.kind === 'stale') return { kind: 'stale' };
      if (outcome.kind === 'season-complete') return { kind: 'finished', stop: null };

      acceptNextForfeit = false;
      played += 1;
      observer.progress(played, Math.max(total, played));
      observer.publishedGame(
        outcome.userGame.kind === 'played' ? outcome.userGame : null,
        outcome.watchedReplay,
      );
      observer.seasonCommitted({ checkpoint: outcome.checkpoint, scores: outcome.scores });
      season = {
        ...season,
        checkpoint: outcome.checkpoint,
        scores: [...season.scores, ...outcome.scores],
      };
      await observer.clearGamePlan({
        runId: lock.season.runId,
        gameId: userGameId,
        pinned: request.pinned,
      });

      const completed = outcome.checkpoint.completedThroughSlot;
      if (completed >= CAP_RUSH_CONFERENCE_GAMES_PER_TEAM) {
        if (request.options.stopAtReview === true) {
          return { kind: 'finished', stop: { kind: 'review', slot: completed } };
        }
        return {
          kind: 'finished',
          stop:
            request.count > 1 ? { kind: 'game-limit', userGames: played, bracketGames: 0 } : null,
        };
      }
      if (request.options.stopAtInjury === true) {
        const injury = fullCourtRegularSeasonInjuryStop(outcome, lock);
        if (injury !== null) return { kind: 'finished', stop: injury };
      }
      if (
        request.options.stopAtReview === true &&
        fullCourtNextReviewSlot(completedBefore) === completed
      ) {
        return { kind: 'finished', stop: { kind: 'review', slot: completed } };
      }
    }
    return {
      kind: 'finished',
      stop:
        request.count > 1 && played > 0
          ? { kind: 'game-limit', userGames: played, bracketGames: 0 }
          : null,
    };
  }

  async #advancePlayoffs(request: FullCourtAdvanceRequest): Promise<FullCourtAdvanceOutcome> {
    const { observer } = this.#dependencies;
    const playoffs = request.playoffs;
    if (playoffs === null) return { kind: 'finished', stop: null };
    const { lock, coaching } = request.season;
    const userTeamId = lock.season.userTeamId;
    let current = playoffs;
    let acceptNextForfeit = request.acceptForfeit;
    let userGames = 0;
    let bracketGames = 0;
    const total = Math.max(1, request.count);
    observer.progress(0, total);

    while (observer.isActive()) {
      if (observer.stopRequested()) {
        return {
          kind: 'finished',
          stop: { kind: 'stopped', userGames, bracketGames },
        };
      }
      const view = current.view;
      if (view.nextGame === null) {
        await observer.archiveRun(current.lock, current.checkpoint);
        return {
          kind: 'finished',
          stop: {
            kind: 'playoffs-complete',
            championTeamId: view.championTeamId ?? '',
            userTeamId,
          },
        };
      }
      const userAlive = view.userOutcome.status === 'pending';
      if (userAlive ? userGames >= request.count : bracketGames >= request.count) {
        return {
          kind: 'finished',
          stop: request.count > 1 ? { kind: 'game-limit', userGames, bracketGames } : null,
        };
      }
      const fixture = view.nextGame;
      const nextIsUser = fixture.userSide !== null;
      if (userAlive && nextIsUser && !request.record) {
        const preview = fullCourtUserNextPlayoffMatchup({
          userTeamId,
          runSeed: lock.season.runSeed,
          series: view.series,
        });
        const lastDecided = view.series
          .filter(
            (series) =>
              (series.highTeamId === userTeamId || series.lowTeamId === userTeamId) &&
              capRushSeriesWinner(series) !== null,
          )
          .at(-1);
        const nextSeriesId =
          preview === null ? null : capRushPlayoffSeriesId(preview.round, preview.seriesSlot);
        if (
          preview !== null &&
          nextSeriesId !== null &&
          preview.gameOrdinal === 1 &&
          lastDecided !== undefined &&
          lastDecided.seriesId !== nextSeriesId &&
          this.#controlReturnedForSeriesId !== nextSeriesId
        ) {
          this.#controlReturnedForSeriesId = nextSeriesId;
          return {
            kind: 'finished',
            stop: {
              kind: 'opponent-change',
              round: preview.round,
              opponentTeamId: preview.opponentTeamId,
              gameOrdinal: preview.gameOrdinal,
            },
          };
        }
      }
      const userGameId = nextIsUser ? fixture.gameId : null;
      const outcome = await this.#dependencies.advancePlayoffGame({
        lock: current.lock,
        expectedGames: current.checkpoint.games.length,
        options: fullCourtSlotOptions({
          coaching,
          pinned: request.pinned,
          userGameId,
          acceptForfeit: acceptNextForfeit && nextIsUser,
          record: request.record && request.count === 1 && nextIsUser,
        }),
      });
      if (!observer.isActive()) return { kind: 'finished', stop: null };
      if (outcome.kind === 'decision') {
        return { kind: 'decision', reason: outcome.reason };
      }
      if (outcome.kind === 'stale') return { kind: 'stale' };
      if (outcome.kind === 'playoffs-complete') {
        return {
          kind: 'finished',
          stop: {
            kind: 'playoffs-complete',
            championTeamId: view.championTeamId ?? '',
            userTeamId,
          },
        };
      }

      bracketGames += 1;
      if (!userAlive) {
        observer.progress(bracketGames, Math.max(total, bracketGames));
      }
      current = {
        lock: current.lock,
        checkpoint: outcome.checkpoint,
        view: outcome.view,
      };
      observer.playoffsCommitted(current);
      if (!nextIsUser) {
        if (outcome.view.nextGame === null) {
          await observer.archiveRun(current.lock, current.checkpoint);
          return {
            kind: 'finished',
            stop: {
              kind: 'playoffs-complete',
              championTeamId: outcome.view.championTeamId ?? '',
              userTeamId,
            },
          };
        }
        continue;
      }

      userGames += 1;
      observer.progress(userGames, Math.max(total, userGames));
      acceptNextForfeit = false;
      this.#controlReturnedForSeriesId = null;
      observer.publishedGame(
        outcome.game.kind === 'played' ? outcome.game : null,
        outcome.watchedReplay,
      );
      await observer.clearGamePlan({
        runId: lock.season.runId,
        gameId: userGameId,
        pinned: request.pinned,
      });
      const nextView = current.view;
      if (nextView.nextGame === null) {
        await observer.archiveRun(current.lock, current.checkpoint);
        return {
          kind: 'finished',
          stop: {
            kind: 'playoffs-complete',
            championTeamId: nextView.championTeamId ?? '',
            userTeamId,
          },
        };
      }

      const series = fullCourtUserSeries(nextView.series, userTeamId);
      if (
        series !== null &&
        series.games.at(-1)?.gameId === fixture.gameId &&
        capRushSeriesWinner(series) !== null
      ) {
        const opponentTeamId =
          series.highTeamId === userTeamId ? series.lowTeamId : series.highTeamId;
        return {
          kind: 'finished',
          stop: {
            kind: 'series-complete',
            round: series.round,
            opponentTeamId,
            won: capRushSeriesWinner(series) === userTeamId,
            userWins: capRushSeriesWins(series, userTeamId),
            opponentWins: capRushSeriesWins(series, opponentTeamId),
          },
        };
      }

      const nextPreview = fullCourtUserNextPlayoffMatchup({
        userTeamId,
        runSeed: lock.season.runSeed,
        series: nextView.series,
      });
      const opponentSide = fixture.userSide === 'home' ? 'away' : 'home';
      const applied = outcome.checkpoint.games.at(-1)?.adaptations?.[opponentSide];
      if (
        request.options.ignoreOpponentAdjustment !== true &&
        nextPreview?.adaptation !== null &&
        nextPreview?.adaptation !== undefined &&
        fullCourtPlayoffAdjustmentChanged(applied, nextPreview.adaptation)
      ) {
        return {
          kind: 'finished',
          stop: {
            kind: 'opponent-adjustment',
            round: nextPreview.round,
            opponentTeamId: nextPreview.opponentTeamId,
            gameOrdinal: nextPreview.gameOrdinal,
            adaptation: nextPreview.adaptation,
          },
        };
      }

      if (userGames >= request.count && request.count > 1) {
        return {
          kind: 'finished',
          stop: { kind: 'game-limit', userGames, bracketGames },
        };
      }
    }
    return {
      kind: 'finished',
      stop: { kind: 'stopped', userGames, bracketGames },
    };
  }
}
