import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HAVOC_MULTIPLAYER_BROADCAST_MS,
  HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
  HAVOC_MULTIPLAYER_TURNS,
  HAVOC_MULTIPLAYER_VERSION,
  contentHashSchema,
  eraSimulationProfileSchema,
  havocMultiplayerCommandSchema,
  type HavocBattleInput,
  type HavocCatalogSource,
  type HavocMultiplayerCommandPayload,
  type HavocMultiplayerCommandReceipt,
  type HavocMultiplayerParticipantId,
  type HavocMultiplayerRoomCode,
  type HavocMultiplayerRoomMembership,
  type HavocMultiplayerRoomSnapshot,
  type HavocMultiplayerVerificationReceipt,
  type HavocMultiplayerWorkerGameOutput,
  type Id,
} from '@hoop-rush/data-contracts';
import {
  createInMemoryHavocMultiplayerTransport,
  type InMemoryHavocMultiplayerTransport,
} from '@hoop-rush/application/havoc-multiplayer';
import {
  AdaptHavocCatalog,
  createEngineContext,
  havocBattleGameInputDigest,
  havocBattleGameResultDigest,
  havocBattleGameTapeDigest,
  simulateHavocBattleGame,
  type HavocCommandEnvironment,
} from '@hoop-rush/engine';
import {
  buildHavocEraProfile,
  buildHavocVersionSet,
  buildSeasonDraftCatalog,
} from '@hoop-rush/test-fixtures';
import type {
  HavocMultiplayerActiveState,
  HavocMultiplayerCommandEntry,
  HavocMultiplayerCompletionRecap,
  HavocMultiplayerGameOutput,
  StoredHavocMultiplayerActive,
  StoredHavocMultiplayerCompleted,
  StoredHavocMultiplayerResultRow,
} from '@hoop-rush/persistence';
import type {
  HavocMultiplayerRunnerPort,
  HavocMultiplayerSession,
  HavocMultiplayerSessionAssets,
} from '@hoop-rush/application/havoc-multiplayer';
import { HavocMultiplayerController } from './havoc-multiplayer-controller.svelte.js';
import { createHavocMultiplayerSession } from './havoc-multiplayer-session';

const START_MS = Date.parse('2026-10-14T12:00:00.000Z');
const FIXED_ISO = new Date(START_MS).toISOString();

let now = START_MS;
let commandCounter = 0;

function nextCommandId(): string {
  commandCounter += 1;
  return `hvm-web-${String(commandCounter)}`;
}

function buildAssets(): HavocMultiplayerSessionAssets {
  const seasonCatalog = buildSeasonDraftCatalog();
  const source: HavocCatalogSource = {
    catalogVersion: seasonCatalog.catalogVersion,
    catalogHash: contentHashSchema.parse('ab'.repeat(32)),
    dataVersion: seasonCatalog.dataVersion,
    ratingsVersion: seasonCatalog.ratingsVersion,
    playerVersionIdVersion: seasonCatalog.playerVersionIdVersion,
    positionNormalizationVersion: seasonCatalog.positionNormalizationVersion,
  };
  const catalog = AdaptHavocCatalog(seasonCatalog, source);
  const profile = eraSimulationProfileSchema.parse(buildHavocEraProfile());
  const versionSet = buildHavocVersionSet({
    catalogVersion: source.catalogVersion,
    catalogHash: source.catalogHash,
    dataVersion: source.dataVersion,
    profileVersion: profile.profileVersion,
  });
  return { catalog, profile, versionSet, manifest: {} as never, context: createEngineContext() };
}

class FakeHavocMultiplayerRepository {
  active: StoredHavocMultiplayerActive | null = null;
  completed: StoredHavocMultiplayerCompleted | null = null;
  results: StoredHavocMultiplayerResultRow[] = [];
  commandRows: HavocMultiplayerCommandEntry[] = [];
  recaps: HavocMultiplayerCompletionRecap[] = [];
  verificationSaves: HavocMultiplayerVerificationReceipt[][] = [];

  loadActive(roomId: string): Promise<StoredHavocMultiplayerActive | null> {
    return Promise.resolve(
      this.active !== null && this.active.roomId === roomId ? this.active : null,
    );
  }

  loadCompleted(roomId: string): Promise<StoredHavocMultiplayerCompleted | null> {
    return Promise.resolve(
      this.completed !== null && this.completed.roomId === roomId ? this.completed : null,
    );
  }

  loadResults(roomId: string): Promise<StoredHavocMultiplayerResultRow[]> {
    return Promise.resolve(this.results.filter((row) => row.roomId === roomId));
  }

  appendCommands(roomId: string, entries: readonly HavocMultiplayerCommandEntry[]): Promise<void> {
    for (const entry of entries) {
      if (entry.command.roomId !== roomId) throw new Error('room mismatch');
      const sameId = this.commandRows.find(
        (row) => row.command.commandId === entry.command.commandId,
      );
      if (sameId !== undefined) {
        if (sameId.ordinal !== entry.ordinal) throw new Error('conflicting command');
        continue;
      }
      const sameOrdinal = this.commandRows.find((row) => row.ordinal === entry.ordinal);
      if (sameOrdinal !== undefined) throw new Error('conflicting ordinal');
      this.commandRows.push(entry);
    }
    return Promise.resolve();
  }

  saveResult(output: HavocMultiplayerGameOutput): Promise<void> {
    const row: StoredHavocMultiplayerResultRow = {
      saveSchemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
      roomId: output.roomId,
      gameNumber: output.gameNumber,
      winner: output.winner,
      result: output.result,
      tape: output.tape,
      inputDigest: output.inputDigest,
      resultDigest: output.resultDigest,
      tapeDigest: output.tapeDigest,
      verified: false,
      storedAtIso: FIXED_ISO,
    };
    this.results = [
      ...this.results.filter(
        (entry) => entry.roomId !== output.roomId || entry.gameNumber !== output.gameNumber,
      ),
      row,
    ];
    return Promise.resolve();
  }

  saveVerification(
    roomId: string,
    entries: readonly HavocMultiplayerVerificationReceipt[],
  ): Promise<void> {
    this.verificationSaves.push([...entries]);
    void roomId;
    return Promise.resolve();
  }

  saveActive(state: HavocMultiplayerActiveState): Promise<void> {
    this.active = {
      saveSchemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
      roomId: state.roomId,
      snapshot: state.snapshot,
      verification: state.verification,
      updatedAtIso: FIXED_ISO,
    };
    return Promise.resolve();
  }

  complete(recap: HavocMultiplayerCompletionRecap): Promise<void> {
    this.recaps.push(recap);
    this.completed = {
      saveSchemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
      roomId: recap.roomId,
      champion: recap.champion,
      series: recap.series,
      mvp: recap.mvp,
      games: recap.games,
      completedAtIso: FIXED_ISO,
    };
    this.active = null;
    return Promise.resolve();
  }
}

class FakeHavocRunner implements HavocMultiplayerRunnerPort {
  disposed = false;
  private readonly context = createEngineContext();

  runGame(request: {
    roomId: string;
    gameNumber: number;
    input: HavocBattleInput;
  }): Promise<HavocMultiplayerWorkerGameOutput> {
    const inputDigest = havocBattleGameInputDigest(request.input);
    const simulation = simulateHavocBattleGame(request.input, this.context);
    return Promise.resolve({
      result: simulation.result,
      tape: simulation.tape,
      inputDigest,
      resultDigest: havocBattleGameResultDigest(simulation.result),
      tapeDigest: havocBattleGameTapeDigest(simulation.tape),
    });
  }

  dispose(): void {
    this.disposed = true;
  }
}

type SessionInternals = {
  roomId: Id | null;
  participantId: HavocMultiplayerParticipantId | null;
  assets: HavocMultiplayerSessionAssets | null;
  environment: HavocCommandEnvironment | null;
  snapshot: HavocMultiplayerRoomSnapshot | null;
  syncFromServer: () => Promise<void>;
  applySnapshot: (snapshot: HavocMultiplayerRoomSnapshot) => void;
  startTimers: () => void;
  rebuildDraft: () => void;
  ensureGamePipeline: () => Promise<void>;
  persistActive: () => Promise<void>;
  maybeProposeOrConfirm: () => void;
};

interface Harness {
  transport: InMemoryHavocMultiplayerTransport;
  repository: FakeHavocMultiplayerRepository;
  runner: FakeHavocRunner;
  session: HavocMultiplayerSession;
  presenter: HavocMultiplayerController;
  assets: HavocMultiplayerSessionAssets;
  roomId: Id;
  code: HavocMultiplayerRoomCode;
  submit(
    actor: HavocMultiplayerParticipantId,
    payload: HavocMultiplayerCommandPayload,
    options?: { expectedRevision?: number },
  ): Promise<HavocMultiplayerCommandReceipt>;
  sync(): Promise<void>;
  internals(): SessionInternals;
}

async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 40; turn += 1) await Promise.resolve();
}

async function waitFor(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (await check()) return;
    await flushMicrotasks();
  }
  throw new Error('condition was not reached');
}

function must<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${label}`);
  return value;
}

let scheduledFrames: FrameRequestCallback[] = [];

function tickFrame(): void {
  const frame = scheduledFrames.at(-1);
  if (frame) frame(Date.now());
}

async function createHarness(seed: string): Promise<Harness> {
  now = START_MS;
  const transport = createInMemoryHavocMultiplayerTransport({ random: { seed }, clock: () => now });
  const assets = buildAssets();
  const repository = new FakeHavocMultiplayerRepository();
  const runner = new FakeHavocRunner();
  let membership: HavocMultiplayerRoomMembership | null = null;
  const session = createHavocMultiplayerSession({
    transport,
    repository,
    runner,
    loadAssets: () => Promise.resolve(assets),
    now: () => now,
    newCommandId: nextCommandId,
    friendlyError: (error) => (error instanceof Error ? error.message : String(error)),
    loadMembership: () => membership,
    saveMembership: (saved) => {
      membership = saved;
    },
  });
  const presenter = new HavocMultiplayerController(session);
  const created = await presenter.createRoom();
  if (created === null) throw new Error('room creation failed');
  await presenter.joinRoom(created.code);
  await presenter.attach(created.roomId);
  await waitFor(() => presenter.participantId === 'p1' && presenter.snapshot !== null);
  const harness: Harness = {
    transport,
    repository,
    runner,
    session,
    presenter,
    assets,
    roomId: created.roomId,
    code: created.code,
    async submit(actor, payload, options): Promise<HavocMultiplayerCommandReceipt> {
      const receipt = await transport.submitCommand(
        havocMultiplayerCommandSchema.parse({
          schemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
          roomId: created.roomId,
          commandId: nextCommandId(),
          actorParticipantId: actor,
          ...(options?.expectedRevision !== undefined
            ? { expectedRevision: options.expectedRevision }
            : {}),
          payload,
        }),
      );
      await flushMicrotasks();
      return receipt;
    },
    async sync(): Promise<void> {
      await harness.internals().syncFromServer();
      await flushMicrotasks();
    },
    internals(): SessionInternals {
      return session as unknown as SessionInternals;
    },
  };
  return harness;
}

function pickPayload(
  draft: NonNullable<HavocMultiplayerRoomSnapshot['draft']>,
  cardIndex = 0,
): Extract<HavocMultiplayerCommandPayload, { kind: 'pick' }> {
  const offer = draft.offer;
  if (offer === null) throw new Error('draft has no offer');
  const card = must(offer.cards[cardIndex], 'offer card');
  const seasonKey = must(card.source.seasonKey, 'card season');
  return {
    kind: 'pick',
    turnOrdinal: draft.turnOrdinal,
    offerId: offer.offerId,
    cardId: card.cardId,
    claimKey: { playerId: card.source.playerId, seasonKey },
  };
}

async function startDraft(h: Harness): Promise<void> {
  await h.presenter.setReady();
  await h.submit('p2', { kind: 'ready' });
  await h.presenter.startDraft();
  await waitFor(() => h.presenter.phase === 'drafting');
}

async function completeDraft(h: Harness): Promise<void> {
  for (let turn = 0; turn < HAVOC_MULTIPLAYER_TURNS; turn += 1) {
    const draft = must(h.presenter.draft, 'draft state');
    if (draft.activeParticipantId === 'p1') {
      await h.presenter.pickCard(must(draft.offer?.cards[0], 'local offer card'));
    } else {
      await h.submit(must(draft.activeParticipantId, 'active participant'), pickPayload(draft));
    }
    await waitFor(
      () => h.presenter.draft?.turnOrdinal === turn + 1 || h.presenter.draft?.status === 'complete',
    );
  }
  expect(h.presenter.draft?.status).toBe('complete');
  expect(h.presenter.phase).toBe('lineup-showdown');
}

async function reachBroadcast(h: Harness, gameNumber: number): Promise<void> {
  await h.presenter.readyForNextGame();
  await h.submit('p2', { kind: 'ready-next-game', gameNumber });
  await waitFor(() => h.presenter.phase === 'preparing-game');
  await h.presenter.startBroadcast();
  await waitFor(
    () =>
      h.presenter.phase === 'broadcasting' &&
      h.presenter.currentBroadcast?.gameNumber === gameNumber,
  );
  await waitFor(() => h.presenter.currentOutput !== null);
}

async function finishPlayback(h: Harness): Promise<void> {
  for (let frame = 0; frame < 9; frame += 1) {
    vi.advanceTimersByTime(1000);
    tickFrame();
    await flushMicrotasks();
  }
  await waitFor(() => h.presenter.progress >= 1);
}

async function hasCommand(
  h: Harness,
  predicate: (command: {
    actorParticipantId: HavocMultiplayerParticipantId;
    payload: HavocMultiplayerCommandPayload;
  }) => boolean,
): Promise<boolean> {
  const commands = await h.transport.refetch(h.roomId, -1);
  return commands.some(predicate);
}

describe('havoc multiplayer presenter flow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(START_MS));
    commandCounter = 0;
    scheduledFrames = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        scheduledFrames.push(callback);
        return scheduledFrames.length;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates, joins, drafts, plays back, and verifies the first game', async () => {
    const h = await createHarness('web-flow');
    expect(h.presenter.participantId).toBe('p1');
    expect(h.presenter.phase).toBe('lobby');
    expect(h.presenter.members).toHaveLength(2);
    const versions = await h.presenter.roomVersions();
    expect(versions.multiplayerVersion).toBe(HAVOC_MULTIPLAYER_VERSION);

    await startDraft(h);
    await completeDraft(h);

    await reachBroadcast(h, 1);
    const output = must(h.presenter.currentOutput, 'game one output');
    expect(h.presenter.currentBroadcast?.durationMs).toBe(HAVOC_MULTIPLAYER_BROADCAST_MS);
    tickFrame();
    expect(h.presenter.progress).toBe(0);
    for (let frame = 0; frame < 4; frame += 1) {
      vi.advanceTimersByTime(1000);
      tickFrame();
      await flushMicrotasks();
    }
    expect(h.presenter.progress).toBeCloseTo(0.5, 5);
    expect(h.presenter.visibleCount).toBeGreaterThanOrEqual(0);
    expect(h.presenter.feed.length).toBeGreaterThan(0);
    expect(h.presenter.visible?.homeScore).toBeGreaterThanOrEqual(0);

    await finishPlayback(h);
    await waitFor(() =>
      hasCommand(
        h,
        (command) =>
          command.payload.kind === 'propose-result' && command.actorParticipantId === 'p1',
      ),
    );
    await h.submit('p2', {
      kind: 'propose-result',
      gameNumber: 1,
      winner: output.winner,
      resultDigest: output.resultDigest,
      inputDigest: output.inputDigest,
      tapeDigest: output.tapeDigest,
    });
    h.presenter.continueAfterGame();
    await waitFor(() =>
      hasCommand(
        h,
        (command) =>
          command.payload.kind === 'confirm-result' && command.actorParticipantId === 'p1',
      ),
    );
    await h.submit('p2', {
      kind: 'confirm-result',
      gameNumber: 1,
      verified: true,
      resultDigest: output.resultDigest,
      inputDigest: output.inputDigest,
      tapeDigest: output.tapeDigest,
    });
    await waitFor(() => h.presenter.currentGameNumber === 2);
    expect(h.presenter.phase).toBe('preparing-game');
    expect(h.presenter.verification.find((entry) => entry.gameNumber === 1)?.status).toBe(
      'verified',
    );
    expect(h.presenter.awaitingContinue).toBe(false);

    await h.presenter.readyForNextGame();
    await h.submit('p2', { kind: 'ready-next-game', gameNumber: 2 });
    await waitFor(() => h.presenter.localReady && h.presenter.opponentReady);
  });

  it('flags a mismatched rival result and fails the room', async () => {
    const h = await createHarness('web-mismatch');
    await startDraft(h);
    await completeDraft(h);
    await reachBroadcast(h, 1);
    const output = must(h.presenter.currentOutput, 'game one output');
    await finishPlayback(h);
    await waitFor(() =>
      hasCommand(
        h,
        (command) =>
          command.payload.kind === 'propose-result' && command.actorParticipantId === 'p1',
      ),
    );
    const rivalDigest = `${output.resultDigest.slice(0, 31)}${output.resultDigest.endsWith('0') ? '1' : '0'}`;
    await h.submit('p2', {
      kind: 'propose-result',
      gameNumber: 1,
      winner: output.winner === 'p1' ? 'p2' : 'p1',
      resultDigest: rivalDigest,
      inputDigest: output.inputDigest,
      tapeDigest: output.tapeDigest,
    });
    await waitFor(() => h.presenter.integrityFailed);
    await waitFor(() => h.presenter.phase === 'integrity-failed');
    expect(h.presenter.verification.find((entry) => entry.gameNumber === 1)?.status).toBe(
      'mismatch',
    );
    expect(h.presenter.error).toBeNull();
  });

  it('creates a successor room after a championship rematch', async () => {
    const h = await createHarness('web-rematch');
    const internals = h.internals();
    vi.spyOn(internals, 'rebuildDraft').mockImplementation(() => {});
    vi.spyOn(internals, 'ensureGamePipeline').mockResolvedValue();
    vi.spyOn(internals, 'persistActive').mockResolvedValue();
    vi.spyOn(h.repository, 'appendCommands').mockResolvedValue();
    vi.spyOn(h.repository, 'saveVerification').mockResolvedValue();
    vi.spyOn(h.repository, 'saveResult').mockResolvedValue();

    await h.submit('p1', { kind: 'ready' });
    await h.submit('p2', { kind: 'ready' });
    await h.submit('p1', { kind: 'start' });
    let snapshot = (await h.transport.resume(h.roomId)).snapshot;
    for (let turn = 0; turn < HAVOC_MULTIPLAYER_TURNS; turn += 1) {
      const draft = must(snapshot.draft, 'draft state');
      const actor = must(draft.activeParticipantId, 'active participant');
      await h.submit(actor, pickPayload(draft));
      snapshot = (await h.transport.resume(h.roomId)).snapshot;
    }
    expect(snapshot.draft?.status).toBe('complete');

    const digest = 'b'.repeat(32);
    for (let gameNumber = 1; gameNumber <= 4; gameNumber += 1) {
      await h.submit('p1', { kind: 'ready-next-game', gameNumber });
      await h.submit('p2', { kind: 'ready-next-game', gameNumber });
      await h.submit('p1', { kind: 'broadcast-start', gameNumber });
      for (const actor of ['p1', 'p2'] as const) {
        await h.submit(actor, {
          kind: 'propose-result',
          gameNumber,
          winner: 'p1',
          inputDigest: digest,
          resultDigest: digest,
          tapeDigest: digest,
        });
      }
      for (const actor of ['p1', 'p2'] as const) {
        await h.submit(actor, {
          kind: 'confirm-result',
          gameNumber,
          verified: true,
          inputDigest: digest,
          resultDigest: digest,
          tapeDigest: digest,
        });
      }
    }
    await h.sync();
    await waitFor(() => h.presenter.phase === 'championship');
    expect(h.presenter.series?.champion).toBe('p1');

    await h.presenter.requestRematch();
    await waitFor(() => h.presenter.myRematchRequested);
    await h.submit('p2', { kind: 'rematch-request' });
    await h.sync();
    await waitFor(() => h.presenter.rivalRematchRequested);
    await h.presenter.confirmRematch();
    await waitFor(() => h.presenter.successorRoomId !== null);
    const successor = await h.presenter.followRematch();
    expect(successor).not.toBeNull();
    expect(successor).toBe(h.presenter.successorRoomId);
    expect(h.presenter.error).toBeNull();
  });
});
