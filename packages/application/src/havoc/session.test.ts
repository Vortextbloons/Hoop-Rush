import { describe, expect, it } from 'vitest';
/* eslint-disable @typescript-eslint/require-await -- the in-memory fake mirrors async repository methods without I/O */
import {
  HAVOC_GAME_COUNT,
  HAVOC_WORKER_WIRE_SCHEMA_VERSION,
  seedSchema,
  type HavocCommandResult,
  type HavocComparison,
  type HavocGameResult,
  type HavocGameTape,
  type HavocReport,
  type HavocRunState,
  type HavocVariant,
  type HoopRushManifest,
  type EraSimulationProfile,
} from '@hoop-rush/data-contracts';
import {
  auditHavocGame,
  buildHavocGameInput,
  createEngineContext,
  havocGameResultDigest,
  havocGameSummaryOf,
  havocGameTapeDigest,
  simulateHavocGame,
} from '@hoop-rush/engine';
import type {
  HavocApplyOutcomeInput,
  HavocHistoryEntry,
  HavocRepository,
} from '@hoop-rush/persistence';
import {
  buildFixtureBracket,
  buildHavocEraProfile,
  buildSeasonDraftCatalog,
} from '@hoop-rush/test-fixtures';
import type { HavocBatchHandlers, HavocRunnerPort } from './ports.ts';
import { HavocSession, type HavocService, type HavocSessionOptions } from './index.ts';
import type { HavocWorkerCompleteMessage, HavocWorkerTapeMessage } from '@hoop-rush/data-contracts';

class MemoryHavocRepository implements HavocRepository {
  private active: HavocRunState | null = null;
  private completed = new Map<string, { state: HavocRunState; report: HavocReport | null }>();
  private commands = new Map<string, HavocCommandResult>();
  private games = new Map<string, { result: HavocGameResult; resultDigest: string }>();
  private tapes = new Map<string, HavocGameTape>();
  private comparisons = new Map<string, HavocComparison>();
  private reports = new Map<string, HavocReport>();
  private history = new Map<string, HavocHistoryEntry>();

  async loadActiveRun(): Promise<HavocRunState | null> {
    return this.active;
  }

  async clearActiveRun(): Promise<void> {
    this.active = null;
  }

  async loadCommandResult(commandId: string): Promise<HavocCommandResult | null> {
    return this.commands.get(commandId) ?? null;
  }

  async applyOutcome(input: HavocApplyOutcomeInput): Promise<HavocCommandResult> {
    const recorded = this.commands.get(input.outcome.result.commandId);
    if (recorded !== undefined) return recorded;
    const result = input.outcome.result;
    this.commands.set(result.commandId, result);
    if (result.status !== 'accepted') return result;
    const next = input.outcome.state;
    if (next.revision !== result.revisionAfter) {
      throw new Error('accepted outcome state must match revisionAfter');
    }
    if (result.revisionAfter <= result.revisionBefore) {
      throw new Error('accepted commands must advance the run revision');
    }
    if (input.game !== undefined) {
      this.games.set(
        `${next.runId}:${input.game.result.variant}:${String(input.game.result.gameNumber)}`,
        {
          result: input.game.result,
          resultDigest: input.game.resultDigest,
        },
      );
    }
    if (input.tape !== undefined) {
      this.tapes.set(`${next.runId}:${String(input.tape.tape.gameNumber)}`, input.tape.tape);
    }
    if (input.comparison !== undefined) {
      this.comparisons.set(next.runId, input.comparison);
    }
    if (input.report !== undefined) {
      this.reports.set(next.runId, input.report);
    }
    const archived =
      next.completionState === 'complete' ||
      (next.completionState === 'abandoned' && next.phase === 'run') ||
      next.havocCursor === HAVOC_GAME_COUNT;
    if (next.phase === 'draft' && next.completionState === 'abandoned') {
      this.active = null;
      this.history.delete(next.runId);
      return result;
    }
    if (archived) {
      this.completed.set(next.runId, {
        state: next,
        report: this.reports.get(next.runId) ?? null,
      });
      this.active = null;
    } else {
      this.active = next;
    }
    if (next.phase === 'run') {
      this.history.set(next.runId, {
        runId: next.runId,
        createdAtIso: '2026-10-11T00:00:00.000Z',
        updatedAtIso: '2026-10-11T00:00:00.000Z',
        havocWins: next.havocAggregate.wins,
        havocLosses: next.havocAggregate.losses,
        perfectSeason: next.perfectSeason,
        comparisonStatus: next.comparisonStatus,
        completionState: next.completionState === 'draft' ? 'season' : next.completionState,
      });
    }
    return result;
  }

  async listRunGames(runId: string, variant: HavocVariant): Promise<HavocGameResult[]> {
    return [...this.games.entries()]
      .filter(([key]) => key.startsWith(`${runId}:${variant}:`))
      .map(([, value]) => value.result)
      .sort((a, b) => a.gameNumber - b.gameNumber);
  }

  async readRunGame(
    runId: string,
    variant: HavocVariant,
    gameNumber: number,
  ): Promise<{ result: HavocGameResult; resultDigest: string } | null> {
    return this.games.get(`${runId}:${variant}:${String(gameNumber)}`) ?? null;
  }

  async readRetainedTape(runId: string, gameNumber: number): Promise<HavocGameTape | null> {
    return this.tapes.get(`${runId}:${String(gameNumber)}`) ?? null;
  }

  async writeRetainedTape(runId: string, gameNumber: number, tape: HavocGameTape): Promise<void> {
    this.tapes.set(`${runId}:${String(gameNumber)}`, tape);
  }

  async readComparison(runId: string): Promise<HavocComparison | null> {
    return this.comparisons.get(runId) ?? null;
  }

  async readReport(runId: string): Promise<HavocReport | null> {
    return this.reports.get(runId) ?? null;
  }

  async listHistory(): Promise<HavocHistoryEntry[]> {
    return [...this.history.values()];
  }

  async readCompletedRun(
    runId: string,
  ): Promise<{ state: HavocRunState; report: HavocReport | null } | null> {
    return this.completed.get(runId) ?? null;
  }
}

class EngineRunner implements HavocRunnerPort {
  private cancelled = false;

  private isCancelled(): boolean {
    return this.cancelled;
  }

  async startBatch(
    request: Parameters<HavocRunnerPort['startBatch']>[0],
    handlers: HavocBatchHandlers,
  ): Promise<HavocWorkerCompleteMessage> {
    this.cancelled = false;
    const context = createEngineContext();
    let delivered = 0;
    for (let offset = 0; offset < request.count; offset += 1) {
      if (this.isCancelled()) break;
      const gameNumber = request.cursor + offset + 1;
      const input = buildHavocGameInput({
        locked: request.locked,
        gameNumber,
        variant: request.variant,
      });
      const { result, tape } = simulateHavocGame(input, context);
      const audit = auditHavocGame(input, result, tape);
      if (!audit.ok) throw new Error(`audit failed for game ${String(gameNumber)}`);
      const resultDigest = havocGameResultDigest(result);
      await handlers.onGame?.({
        schemaVersion: HAVOC_WORKER_WIRE_SCHEMA_VERSION,
        type: 'havoc-game',
        requestId: request.requestId,
        variant: request.variant,
        cursor: gameNumber,
        inputDigest: result.inputDigest,
        resultDigest,
        summary: havocGameSummaryOf(result, resultDigest),
        result,
      });
      delivered += 1;
    }
    return {
      schemaVersion: HAVOC_WORKER_WIRE_SCHEMA_VERSION,
      type: 'havoc-complete',
      requestId: request.requestId,
      variant: request.variant,
      gamesDelivered: delivered,
      cancelled: this.cancelled,
      lastCursor: request.cursor + delivered,
    };
  }

  async runTape(
    request: Parameters<HavocRunnerPort['runTape']>[0],
  ): Promise<HavocWorkerTapeMessage> {
    const input = buildHavocGameInput({
      locked: request.locked,
      gameNumber: request.gameNumber,
      variant: request.variant,
    });
    const { result, tape } = simulateHavocGame(input, createEngineContext());
    const resultDigest = havocGameResultDigest(result);
    return {
      schemaVersion: HAVOC_WORKER_WIRE_SCHEMA_VERSION,
      type: 'havoc-tape',
      requestId: request.requestId,
      variant: request.variant,
      gameNumber: request.gameNumber,
      inputDigest: result.inputDigest,
      resultDigest,
      tapeDigest: havocGameTapeDigest(tape),
      summary: havocGameSummaryOf(result, resultDigest),
      result,
      tape,
    };
  }

  cancel(): void {
    this.cancelled = true;
  }

  dispose(): void {}
}

const MANIFEST = {
  season: {
    draftCatalog: { url: '/data/season/draft-catalog.json', contentHash: 'a'.repeat(64) },
  },
  eraSimulationProfiles: [
    { eraId: '2010s', url: '/data/era-2010s.json', contentHash: 'b'.repeat(64) },
  ],
  bracket: { url: '/data/opponents/bracket.json', contentHash: 'c'.repeat(64) },
} as unknown as HoopRushManifest;

function manifestWithBracketHash(hash: string): HoopRushManifest {
  return {
    ...(MANIFEST as unknown as Record<string, unknown>),
    bracket: { url: '/data/opponents/bracket.json', contentHash: hash },
  } as unknown as HoopRushManifest;
}

function buildService() {
  const repository = new MemoryHavocRepository();
  let counter = 0;
  const service = new HavocSession({
    repository,
    runner: new EngineRunner(),
    assets: {
      loadCatalog: async () => buildSeasonDraftCatalog({ playersPerPool: 40 }),
      loadPreamble: async () => ({
        profile: buildHavocEraProfile() as unknown as EraSimulationProfile,
        bracket: buildFixtureBracket(),
      }),
      loadManifest: async () => MANIFEST,
    },
    ids: {
      newRunId: () => 'havoc-run-test',
      newCommandId: () => `havoc-cmd-${String(++counter)}`,
      newRequestId: (prefix) => `${prefix}-${String(++counter)}`,
      rootSeed: () => seedSchema.parse('f'.repeat(32)),
    },
  });
  return { service, repository };
}

async function draftFivePicks(service: HavocService): Promise<void> {
  for (let round = 0; round < 5; round += 1) {
    const snapshot = await service.loadActive();
    const card = snapshot.draft?.cards[0];
    if (card === undefined) throw new Error(`missing offer for round ${String(round + 1)}`);
    const result = await service.pickCard(card.cardId);
    expect(result.status).toBe('accepted');
  }
}

describe('HavocService integration', () => {
  it('drafts, rerolls once, locks, plays, watches, and finalizes a matched comparison', async () => {
    const { service } = buildService();
    expect((await service.loadActive()).run).toBeNull();

    const created = await service.createDraft();
    expect(created.status).toBe('accepted');
    let snapshot = await service.loadActive();
    expect(snapshot.draft?.cards).toHaveLength(3);
    expect(snapshot.draft?.rerollUsed).toBe(false);

    const reroll = await service.rerollOffer();
    expect(reroll.status).toBe('accepted');
    snapshot = await service.loadActive();
    expect(snapshot.draft?.rerollUsed).toBe(true);
    expect(snapshot.draft?.offerIndex).toBe(1);

    await draftFivePicks(service);
    snapshot = await service.loadActive();
    expect(snapshot.draft?.status).toBe('complete');
    expect(snapshot.draft?.picks).toHaveLength(5);

    const locked = await service.lockLineup();
    expect(locked.status).toBe('accepted');
    snapshot = await service.loadActive();
    expect(snapshot.run?.phase).toBe('run');
    expect(snapshot.run?.lineup).toHaveLength(5);
    expect(snapshot.run?.nextGameNumber).toBe(1);

    const first = await service.simulateRange({ variant: 'havoc', count: 2 });
    expect(first.accepted).toBe(2);
    expect(first.nextCursor).toBe(2);
    expect(await service.listGames('havoc')).toHaveLength(2);

    const session = await service.watchGame({ gameNumber: 3, variant: 'havoc' });
    expect(session.tape.events.length).toBeGreaterThan(0);
    const pendingGame = await service.readGame({ gameNumber: 3, variant: 'havoc' });
    expect(pendingGame?.gameNumber).toBe(3);
    const accepted = await service.acceptGame({ gameNumber: 3, variant: 'havoc' });
    expect(accepted.status).toBe('accepted');
    snapshot = await service.loadActive();
    expect(snapshot.run?.havocCursor).toBe(3);

    const rest = await service.simulateRange({ variant: 'havoc', count: 'remaining' });
    expect(rest.accepted).toBe(79);
    snapshot = await service.loadActive();
    expect(snapshot.run?.havocCursor).toBe(82);
    expect(snapshot.run?.runId).toBe('havoc-run-test');

    const normal = await service.startNormalSeason();
    expect(normal.accepted).toBe(82);

    const comparison = await service.finalizeComparison();
    expect(comparison.games).toHaveLength(82);
    expect(comparison.slots).toHaveLength(5);
    expect(comparison.mvp.gain).toBeTypeOf('number');

    const report = await service.readReport();
    expect(report?.status).toBe('complete');
    expect(report?.comparison).not.toBeNull();

    const history = await service.listHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.comparisonStatus).toBe('complete');
    const completed = await service.readCompletedRun(history[0]?.runId ?? '');
    expect(completed?.run.completionState).toBe('complete');
    expect(completed?.comparison).not.toBeNull();
    service.dispose();
  }, 180_000);

  it('abandons a draft without leaving an active run or history', async () => {
    const { service } = buildService();
    await service.createDraft();
    const result = await service.abandon();
    expect(result.status).toBe('accepted');
    expect((await service.loadActive()).run).toBeNull();
    expect(await service.listHistory()).toHaveLength(0);
    service.dispose();
  });

  it('rejects watching or accepting out of order', async () => {
    const { service } = buildService();
    await service.createDraft();
    await draftFivePicks(service);
    await service.lockLineup();
    await expect(service.watchGame({ gameNumber: 2, variant: 'havoc' })).rejects.toThrow(
      'only the next game can be watched',
    );
    await expect(service.acceptGame({ gameNumber: 2, variant: 'havoc' })).rejects.toThrow(
      'games must be accepted in order',
    );
    service.dispose();
  });

  it('refuses to replay a run under a different engine or data version', async () => {
    const repository = new MemoryHavocRepository();
    let counter = 0;
    const deps = (bracketHash: string): HavocSessionOptions => ({
      repository,
      runner: new EngineRunner(),
      assets: {
        loadCatalog: async () => buildSeasonDraftCatalog({ playersPerPool: 40 }),
        loadPreamble: async () => ({
          profile: buildHavocEraProfile() as unknown as EraSimulationProfile,
          bracket: buildFixtureBracket(),
        }),
        loadManifest: async () => manifestWithBracketHash(bracketHash),
      },
      ids: {
        newRunId: () => 'havoc-run-version',
        newCommandId: () => `havoc-cmd-version-${String(++counter)}`,
        newRequestId: (prefix) => `${prefix}-version-${String(++counter)}`,
        rootSeed: () => seedSchema.parse('e'.repeat(32)),
      },
    });
    const first = new HavocSession(deps('c'.repeat(64)));
    await first.createDraft();
    await draftFivePicks(first);
    await first.lockLineup();
    first.dispose();
    const second = new HavocSession(deps('d'.repeat(64)));
    await second.loadActive();
    await expect(second.simulateRange({ variant: 'havoc', count: 1 })).rejects.toThrow(
      'different engine or data version',
    );
    second.dispose();
  });
});
