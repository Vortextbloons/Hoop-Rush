/* eslint-disable @typescript-eslint/require-await -- test double mirrors the async service contract without real I/O */
import {
  HAVOC_GAME_COUNT,
  HAVOC_SCHEMA_VERSION,
  POSITIONS,
  havocDraftStateSchema,
  havocGameSummarySchema,
  havocRunStateSchema,
  seedFromString,
} from '@hoop-rush/data-contracts';
import type {
  HavocCommandResult,
  HavocComparison,
  HavocDraftState,
  HavocGameResult,
  HavocGameSummary,
  HavocGameTape,
  HavocReport,
  HavocRunState,
  HavocVariant,
} from '@hoop-rush/data-contracts';
import type {
  HavocActiveSnapshot,
  HavocBatchResult,
  HavocHistoryView,
  HavocRunView,
  HavocService,
  HavocServiceErrorCode,
  HavocServiceEvent,
  HavocWatchSession,
} from '@hoop-rush/application/havoc';

import { HavocServiceError } from '@hoop-rush/application/havoc';
import {
  fakeHex32,
  buildOffer,
  makeDraftRunState,
  lockedFromDraft,
  toRunView,
  commandResult,
  rejected,
  buildFakeGameResult,
  buildFakeTape,
  buildFakeComparison,
  totalsFromAggregate,
  buildFakeReport,
  foldAggregate,
  makeLockedRunState,
  splitPeriods,
} from './havoc-fixtures.ts';

export interface FakeHavocCompletedRun {
  run: HavocRunView;
  report: HavocReport | null;
  comparison: HavocComparison | null;
}

export interface FakeHavocServiceOptions {
  /** Per-game havoc outcomes; defaults to a win for every game. */
  outcomes?: readonly ('win' | 'loss')[];
  history?: readonly HavocHistoryView[];
  completedRuns?: readonly FakeHavocCompletedRun[];
}

export class FakeHavocService implements HavocService {
  outcomeFor: (gameNumber: number) => 'win' | 'loss' = () => 'win';
  scoreFor: (gameNumber: number, outcome: 'win' | 'loss') => { human: number; opponent: number } = (
    gameNumber,
    outcome,
  ) =>
    outcome === 'win'
      ? { human: 100 + (gameNumber % 11), opponent: 92 + (gameNumber % 7) }
      : { human: 96 + (gameNumber % 5), opponent: 104 + (gameNumber % 9) };
  normalOutcomeFor: (gameNumber: number) => 'win' | 'loss' = (gameNumber) =>
    gameNumber % 4 === 0 ? 'loss' : 'win';
  normalScoreFor: (
    gameNumber: number,
    outcome: 'win' | 'loss',
  ) => {
    human: number;
    opponent: number;
  } = (gameNumber, outcome) =>
    outcome === 'win'
      ? { human: 98 + (gameNumber % 5), opponent: 91 + (gameNumber % 6) }
      : { human: 95 + (gameNumber % 4), opponent: 102 + (gameNumber % 8) };
  tapeBuilder: ((gameNumber: number) => HavocGameTape) | null = null;
  resultBuilder: ((gameNumber: number) => HavocGameResult) | null = null;

  readonly calls = {
    createDraft: 0,
    rerollOffer: 0,
    pickCard: 0,
    lockLineup: 0,
    simulateRange: 0,
    cancelSimulation: 0,
    watchGame: 0,
    acceptGame: 0,
    startNormalSeason: 0,
    finalizeComparison: 0,
    abandon: 0,
  };
  readonly emitted: HavocServiceEvent[] = [];
  cancelled = false;

  private isCancelled(): boolean {
    return this.cancelled;
  }

  private listeners = new Set<(event: HavocServiceEvent) => void>();
  private runState: HavocRunState | null = null;
  private readonly summaries: Record<HavocVariant, HavocGameSummary[]> = { havoc: [], normal: [] };
  private readonly results = new Map<string, HavocGameResult>();
  private readonly pendingSummaries = new Map<string, HavocGameSummary>();
  private comparison: HavocComparison | null = null;
  private report: HavocReport | null = null;
  private readonly completedRuns = new Map<string, FakeHavocCompletedRun>();
  private readonly historyEntries: HavocHistoryView[] = [];

  constructor(options: FakeHavocServiceOptions = {}) {
    if (options.outcomes !== undefined) {
      const outcomes = options.outcomes;
      this.outcomeFor = (gameNumber) => outcomes[gameNumber - 1] ?? 'win';
    }
    this.historyEntries.push(
      ...(options.history ?? [
        {
          runId: 'havoc-run-1',
          createdAtIso: '2026-10-01T10:00:00.000Z',
          updatedAtIso: '2026-10-02T10:00:00.000Z',
          havocWins: 55,
          havocLosses: 27,
          perfectSeason: false,
          comparisonStatus: 'complete',
          completionState: 'complete',
        },
        {
          runId: 'havoc-run-2',
          createdAtIso: '2026-09-20T10:00:00.000Z',
          updatedAtIso: '2026-09-21T10:00:00.000Z',
          havocWins: 3,
          havocLosses: 2,
          perfectSeason: false,
          comparisonStatus: 'not-started',
          completionState: 'abandoned',
        },
      ]),
    );
    const completed = options.completedRuns ?? this.defaultCompletedRuns();
    for (const entry of completed) {
      this.completedRuns.set(entry.run.runId, entry);
    }
  }

  private defaultCompletedRuns(): FakeHavocCompletedRun[] {
    const comparison = buildFakeComparison('havoc-run-1');
    const report = buildFakeReport('havoc-run-1', comparison);
    const completeState = havocRunStateSchema.parse({
      ...makeLockedRunState(),
      havocCursor: HAVOC_GAME_COUNT,
      havocAggregate: {
        games: HAVOC_GAME_COUNT,
        wins: 55,
        losses: 27,
        pointsFor: 8321,
        pointsAgainst: 8110,
        adjustments: 214,
      },
      perfectSeason: false,
      comparisonStatus: 'complete',
      completionState: 'complete',
    });
    const abandonedState = havocRunStateSchema.parse({
      ...makeLockedRunState('havoc-run-2'),
      havocCursor: 5,
      havocAggregate: {
        games: 5,
        wins: 3,
        losses: 2,
        pointsFor: 502,
        pointsAgainst: 498,
        adjustments: 12,
      },
      perfectSeason: false,
      comparisonStatus: 'not-started',
      completionState: 'abandoned',
    });
    const abandonedReport = buildFakeReport('havoc-run-2', null, {
      games: 5,
      wins: 3,
      losses: 2,
      pointsFor: 502,
      pointsAgainst: 498,
      differential: 4,
      averagePointsFor: 100.4,
      averagePointsAgainst: 99.6,
      largestPointsFor: 112,
      largestPointsAgainst: 108,
      adjustments: 12,
    });
    return [
      { run: toRunView(completeState), report, comparison },
      { run: toRunView(abandonedState), report: abandonedReport, comparison: null },
    ];
  }

  seedActiveRun(state: HavocRunState): void {
    this.runState = state;
    this.summaries.havoc = [];
    this.summaries.normal = [];
    this.comparison = null;
    this.report = null;
  }

  seedComparison(comparison: HavocComparison, report: HavocReport | null = null): void {
    this.comparison = comparison;
    this.report = report ?? buildFakeReport(comparison.runId, comparison);
  }

  activeRunState(): HavocRunState | null {
    return this.runState;
  }

  emit(event: HavocServiceEvent): void {
    this.emitted.push(event);
    for (const listener of [...this.listeners]) listener(event);
  }

  emitError(code: HavocServiceErrorCode, message: string): void {
    this.emit({ type: 'error', code, message });
  }

  subscribe(listener: (event: HavocServiceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): HavocActiveSnapshot {
    return {
      run: this.runState === null ? null : toRunView(this.runState),
      draft: this.runState?.draft ?? null,
    };
  }

  async loadActive(): Promise<HavocActiveSnapshot> {
    return {
      run: this.runState === null ? null : toRunView(this.runState),
      draft: this.runState?.draft ?? null,
    };
  }

  async listHistory(): Promise<HavocHistoryView[]> {
    return [...this.historyEntries];
  }

  async readCompletedRun(runId: string): Promise<FakeHavocCompletedRun | null> {
    return this.completedRuns.get(runId) ?? null;
  }

  async createDraft(): Promise<HavocCommandResult> {
    this.calls.createDraft += 1;
    if (this.runState !== null) {
      return rejected(
        this.runState.runId,
        this.runState.revision,
        'phase-mismatch',
        'a run is already active',
      );
    }
    this.runState = makeDraftRunState();
    return commandResult({
      runId: this.runState.runId,
      revisionBefore: 0,
      revisionAfter: 0,
    });
  }

  async rerollOffer(): Promise<HavocCommandResult> {
    this.calls.rerollOffer += 1;
    const state = this.runState;
    if (state === null || state.draft === null) {
      throw new HavocServiceError('no-active-run', 'no active havoc draft');
    }
    const draft = state.draft;
    if (draft.status !== 'drafting') {
      return rejected(state.runId, state.revision, 'not-drafting', 'the draft is already complete');
    }
    if (draft.rerollUsed) {
      return rejected(
        state.runId,
        state.revision,
        'reroll-spent',
        'the draft-wide reroll is spent',
      );
    }
    const offer = buildOffer({
      runSeed: state.runSeed,
      round: draft.round,
      slot: draft.slot,
      offerIndex: draft.offerIndex + 1,
    });
    const nextDraft = havocDraftStateSchema.parse({
      ...draft,
      offerId: offer.offerId,
      offerIndex: offer.offerIndex,
      cards: offer.cards,
      rerollUsed: true,
    });
    this.runState = havocRunStateSchema.parse({
      ...state,
      revision: state.revision + 1,
      draft: nextDraft,
    });
    return commandResult({
      runId: state.runId,
      revisionBefore: state.revision,
      revisionAfter: state.revision + 1,
    });
  }

  async pickCard(cardId: string): Promise<HavocCommandResult> {
    this.calls.pickCard += 1;
    const state = this.runState;
    if (state === null || state.draft === null) {
      throw new HavocServiceError('no-active-run', 'no active havoc draft');
    }
    const draft = state.draft;
    if (draft.status !== 'drafting') {
      return rejected(state.runId, state.revision, 'not-drafting', 'the draft is already complete');
    }
    const card = draft.cards.find((candidate) => candidate.cardId === cardId);
    if (card === undefined) {
      return rejected(
        state.runId,
        state.revision,
        'unknown-card',
        'card is not in the current offer',
      );
    }
    const pick = {
      pickOrdinal: draft.picks.length,
      slot: draft.slot,
      claimKey: { playerId: card.source.playerId, seasonKey: card.source.seasonKey ?? '1996-97' },
      card,
    };
    const picks = [...draft.picks, pick];
    let nextDraft: HavocDraftState;
    if (picks.length >= POSITIONS.length) {
      nextDraft = havocDraftStateSchema.parse({ ...draft, picks, status: 'complete' });
    } else {
      const round = picks.length + 1;
      const slot = POSITIONS[picks.length] ?? 'C';
      const offer = buildOffer({ runSeed: state.runSeed, round, slot, offerIndex: 0 });
      nextDraft = havocDraftStateSchema.parse({
        ...draft,
        round,
        slot,
        offerId: offer.offerId,
        offerIndex: 0,
        cards: offer.cards,
        picks,
        status: 'drafting',
      });
    }
    this.runState = havocRunStateSchema.parse({
      ...state,
      revision: state.revision + 1,
      draft: nextDraft,
    });
    return commandResult({
      runId: state.runId,
      revisionBefore: state.revision,
      revisionAfter: state.revision + 1,
    });
  }

  async lockLineup(): Promise<HavocCommandResult> {
    this.calls.lockLineup += 1;
    const state = this.runState;
    if (state === null || state.draft === null) {
      throw new HavocServiceError('no-active-run', 'no active havoc draft');
    }
    if (state.draft.status !== 'complete') {
      return rejected(
        state.runId,
        state.revision,
        'incomplete-lineup',
        'the draft is not complete',
      );
    }
    const locked = lockedFromDraft(state, state.draft);
    this.runState = havocRunStateSchema.parse({
      ...state,
      revision: state.revision + 1,
      phase: 'run',
      draft: null,
      locked,
      completionState: 'season',
    });
    return commandResult({
      runId: state.runId,
      revisionBefore: state.revision,
      revisionAfter: state.revision + 1,
    });
  }

  private humanSideFor(gameNumber: number): 'home' | 'away' {
    const entry = this.runState?.locked?.schedule[gameNumber - 1];
    return entry?.humanHome === false ? 'away' : 'home';
  }

  private summaryFor(gameNumber: number): HavocGameSummary {
    const outcome = this.outcomeFor(gameNumber);
    const score = this.scoreFor(gameNumber, outcome);
    return havocGameSummarySchema.parse({
      schemaVersion: HAVOC_SCHEMA_VERSION,
      gameNumber,
      variant: 'havoc',
      seed: seedFromString(`havoc-fake-game-${String(gameNumber)}`),
      humanSide: this.humanSideFor(gameNumber),
      humanScore: score.human,
      opponentScore: score.opponent,
      outcome,
      periods: { human: splitPeriods(score.human), opponent: splitPeriods(score.opponent) },
      overtimePeriods: 0,
      adjustments: 0,
      resultDigest: fakeHex32(),
      inputDigest: fakeHex32(),
    });
  }

  private normalSummaryFor(gameNumber: number): HavocGameSummary {
    const outcome = this.normalOutcomeFor(gameNumber);
    const score = this.normalScoreFor(gameNumber, outcome);
    return havocGameSummarySchema.parse({
      schemaVersion: HAVOC_SCHEMA_VERSION,
      gameNumber,
      variant: 'normal',
      seed: seedFromString(`havoc-fake-game-${String(gameNumber)}`),
      humanSide: this.humanSideFor(gameNumber),
      humanScore: score.human,
      opponentScore: score.opponent,
      outcome,
      periods: { human: splitPeriods(score.human), opponent: splitPeriods(score.opponent) },
      overtimePeriods: 0,
      adjustments: 0,
      resultDigest: fakeHex32(),
      inputDigest: fakeHex32(),
    });
  }

  private resultFor(summary: HavocGameSummary): HavocGameResult {
    if (this.resultBuilder !== null) return this.resultBuilder(summary.gameNumber);
    return buildFakeGameResult(summary);
  }

  private acceptHavocSummary(summary: HavocGameSummary): void {
    const state = this.runState;
    if (state === null) throw new HavocServiceError('no-active-run', 'no active havoc run');
    const aggregate = foldAggregate(state.havocAggregate, summary);
    const havocCursor = state.havocCursor + 1;
    this.runState = havocRunStateSchema.parse({
      ...state,
      revision: state.revision + 1,
      havocCursor,
      havocAggregate: aggregate,
      perfectSeason: havocCursor === HAVOC_GAME_COUNT && aggregate.losses === 0,
    });
    this.summaries.havoc.push(summary);
    this.results.set(`havoc:${String(summary.gameNumber)}`, this.resultFor(summary));
    this.pendingSummaries.delete(`havoc:${String(summary.gameNumber)}`);
  }

  private acceptNormalSummary(summary: HavocGameSummary): void {
    const state = this.runState;
    if (state === null) throw new HavocServiceError('no-active-run', 'no active havoc run');
    const aggregate = foldAggregate(state.normalAggregate, summary);
    const normalCursor = state.normalCursor + 1;
    this.runState = havocRunStateSchema.parse({
      ...state,
      revision: state.revision + 1,
      normalCursor,
      normalAggregate: aggregate,
      comparisonStatus:
        state.comparisonStatus === 'not-started' ? 'running' : state.comparisonStatus,
      completionState: normalCursor === HAVOC_GAME_COUNT ? 'comparison' : state.completionState,
    });
    this.summaries.normal.push(summary);
    this.results.set(`normal:${String(summary.gameNumber)}`, this.resultFor(summary));
  }

  async simulateRange(input: {
    variant: HavocVariant;
    count: number | 'remaining';
  }): Promise<HavocBatchResult> {
    this.calls.simulateRange += 1;
    const state = this.runState;
    if (state === null || state.phase !== 'run') {
      throw new HavocServiceError('invalid-phase', 'simulateRange requires an active locked run');
    }
    if (input.variant !== 'havoc') {
      throw new HavocServiceError('invalid-phase', 'simulateRange only advances the havoc variant');
    }
    this.cancelled = false;
    const remaining = HAVOC_GAME_COUNT - state.havocCursor;
    const target = input.count === 'remaining' ? remaining : Math.min(input.count, remaining);
    let accepted = 0;
    for (let index = 0; index < target; index += 1) {
      if (this.isCancelled()) break;
      const current = this.runState;
      if (current === null) break;
      const gameNumber = current.havocCursor + 1;
      const summary = this.summaryFor(gameNumber);
      this.acceptHavocSummary(summary);
      accepted += 1;
      this.emit({
        type: 'progress',
        progress: {
          variant: 'havoc',
          gamesCompleted: gameNumber,
          gamesTotal: HAVOC_GAME_COUNT,
          latestGameNumber: gameNumber,
        },
      });
      this.emit({ type: 'game-accepted', summary });
      await Promise.resolve();
    }
    return {
      accepted,
      cancelled: this.cancelled,
      nextCursor: this.runState?.havocCursor ?? HAVOC_GAME_COUNT,
    };
  }

  async cancelSimulation(): Promise<void> {
    this.calls.cancelSimulation += 1;
    this.cancelled = true;
  }

  async watchGame(input: {
    gameNumber: number;
    variant: HavocVariant;
  }): Promise<HavocWatchSession> {
    this.calls.watchGame += 1;
    const variant = input.variant;
    const key = `${variant}:${String(input.gameNumber)}`;
    const summary =
      this.summaries[variant].find((entry) => entry.gameNumber === input.gameNumber) ??
      this.pendingSummaries.get(key) ??
      this.summaryFor(input.gameNumber);
    const tape =
      this.tapeBuilder === null ? buildFakeTape(summary) : this.tapeBuilder(input.gameNumber);
    const result = this.results.get(key) ?? this.resultFor(summary);
    const session: HavocWatchSession = {
      gameNumber: input.gameNumber,
      variant,
      seed: summary.seed,
      tape,
      summary,
      result,
    };
    if (!this.summaries[variant].some((entry) => entry.gameNumber === input.gameNumber)) {
      this.pendingSummaries.set(key, summary);
      this.results.set(key, result);
    }
    return session;
  }

  async acceptGame(input: {
    gameNumber: number;
    variant: HavocVariant;
  }): Promise<HavocCommandResult> {
    this.calls.acceptGame += 1;
    const state = this.runState;
    if (state === null || state.phase !== 'run') {
      throw new HavocServiceError('invalid-phase', 'acceptGame requires an active locked run');
    }
    const key = `${input.variant}:${String(input.gameNumber)}`;
    const cursor = input.variant === 'havoc' ? state.havocCursor : state.normalCursor;
    if (input.gameNumber !== cursor + 1) {
      return rejected(
        state.runId,
        state.revision,
        'cursor-mismatch',
        'game is not the next cursor',
      );
    }
    const summary =
      this.pendingSummaries.get(key) ??
      (input.variant === 'havoc'
        ? this.summaryFor(input.gameNumber)
        : this.normalSummaryFor(input.gameNumber));
    if (input.variant === 'havoc') this.acceptHavocSummary(summary);
    else this.acceptNormalSummary(summary);
    this.emit({ type: 'game-accepted', summary });
    const next = this.runState;
    return commandResult({
      runId: state.runId,
      revisionBefore: state.revision,
      revisionAfter: next?.revision ?? state.revision + 1,
    });
  }

  async listGames(variant: HavocVariant): Promise<HavocGameSummary[]> {
    return [...this.summaries[variant]].sort((a, b) => a.gameNumber - b.gameNumber);
  }

  async readGame(input: {
    gameNumber: number;
    variant: HavocVariant;
  }): Promise<HavocGameResult | null> {
    const key = `${input.variant}:${String(input.gameNumber)}`;
    const stored = this.results.get(key);
    if (stored !== undefined) return stored;
    const summary = this.summaries[input.variant].find(
      (entry) => entry.gameNumber === input.gameNumber,
    );
    if (summary === undefined) return null;
    const result = this.resultFor(summary);
    this.results.set(key, result);
    return result;
  }

  async startNormalSeason(): Promise<HavocBatchResult> {
    this.calls.startNormalSeason += 1;
    const state = this.runState;
    if (state === null || state.phase !== 'run') {
      throw new HavocServiceError(
        'invalid-phase',
        'startNormalSeason requires an active locked run',
      );
    }
    if (state.havocCursor < HAVOC_GAME_COUNT) {
      throw new HavocServiceError('invalid-phase', 'the normal season starts after havoc game 82');
    }
    this.cancelled = false;
    let accepted = 0;
    for (let gameNumber = state.normalCursor + 1; gameNumber <= HAVOC_GAME_COUNT; gameNumber += 1) {
      if (this.isCancelled()) break;
      const summary = this.normalSummaryFor(gameNumber);
      this.acceptNormalSummary(summary);
      accepted += 1;
      this.emit({
        type: 'progress',
        progress: {
          variant: 'normal',
          gamesCompleted: gameNumber,
          gamesTotal: HAVOC_GAME_COUNT,
          latestGameNumber: gameNumber,
        },
      });
      await Promise.resolve();
    }
    return {
      accepted,
      cancelled: this.cancelled,
      nextCursor: this.runState?.normalCursor ?? HAVOC_GAME_COUNT,
    };
  }

  async finalizeComparison(): Promise<HavocComparison> {
    this.calls.finalizeComparison += 1;
    const state = this.runState;
    if (state === null) throw new HavocServiceError('no-active-run', 'no active havoc run');
    if (state.normalCursor < HAVOC_GAME_COUNT) {
      throw new HavocServiceError('invalid-phase', 'the normal season is not complete');
    }
    const comparison = this.comparison ?? buildFakeComparison(state.runId);
    this.comparison = comparison;
    this.report = buildFakeReport(state.runId, comparison);
    this.runState = havocRunStateSchema.parse({
      ...state,
      revision: state.revision + 1,
      comparisonStatus: 'complete',
      completionState: 'complete',
    });
    this.emit({ type: 'comparison-updated', comparison });
    return comparison;
  }

  async readComparison(): Promise<HavocComparison | null> {
    return this.comparison;
  }

  async readReport(): Promise<HavocReport | null> {
    if (this.report !== null) return this.report;
    const state = this.runState;
    if (state === null) return null;
    return buildFakeReport(state.runId, null, totalsFromAggregate(state.havocAggregate));
  }

  async abandon(): Promise<HavocCommandResult> {
    this.calls.abandon += 1;
    const state = this.runState;
    if (state === null) {
      throw new HavocServiceError('no-active-run', 'no active havoc run');
    }
    const abandoned = havocRunStateSchema.parse({
      ...state,
      revision: state.revision + 1,
      completionState: 'abandoned',
    });
    this.historyEntries.push({
      runId: abandoned.runId,
      createdAtIso: '2026-10-10T10:00:00.000Z',
      updatedAtIso: '2026-10-10T10:00:00.000Z',
      havocWins: abandoned.havocAggregate.wins,
      havocLosses: abandoned.havocAggregate.losses,
      perfectSeason: false,
      comparisonStatus: abandoned.comparisonStatus,
      completionState: 'abandoned',
    });
    this.completedRuns.set(abandoned.runId, {
      run: toRunView(abandoned),
      report: await this.readReport(),
      comparison: null,
    });
    this.runState = null;
    return commandResult({
      runId: state.runId,
      revisionBefore: state.revision,
      revisionAfter: state.revision + 1,
    });
  }

  async discardStaleActiveRun(): Promise<void> {
    this.runState = null;
  }

  dispose(): void {
    this.listeners.clear();
  }
}
