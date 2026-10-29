import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import {
  HAVOC_MULTIPLAYER_BROADCAST_MS,
  HAVOC_MULTIPLAYER_LEGACY_RULES_VERSION,
  HAVOC_MULTIPLAYER_LEGACY_VERSION,
  HAVOC_MULTIPLAYER_PICK_TIMEOUT_MS,
  HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
  HAVOC_MULTIPLAYER_TURNS,
  contentHashSchema,
  defaultHavocMultiplayerVersionLocks,
  eraSimulationProfileSchema,
  havocMultiplayerCommandSchema,
  type HavocBattleInput,
  type HavocCatalogSource,
  type HavocMultiplayerCommand,
  type HavocMultiplayerCommandPayload,
  type HavocMultiplayerCommandReceipt,
  type HavocMultiplayerParticipantId,
  type HavocMultiplayerRoomCode,
  type HavocMultiplayerRoomMembership,
  type HavocMultiplayerRoomSnapshot,
  type HavocMultiplayerVariant,
  type HavocMultiplayerVerificationReceipt,
  type HavocMultiplayerVersionLocks,
  type HavocMultiplayerWorkerGameOutput,
  type HavocVersionSet,
  type Id,
} from '@hoop-rush/data-contracts';
import {
  createInMemoryHavocMultiplayerTransport,
  type InMemoryHavocMultiplayerTransport,
} from './in-memory-transport.ts';
import {
  AdaptHavocCatalog,
  HAVOC_MUTATION_DEFINITIONS,
  createEngineContext,
  createHavocCommandEnvironment,
  createRng,
  havocBattleGameInputDigest,
  havocBattleGameResultDigest,
  havocBattleGameTapeDigest,
  havocMultiplayerTimeoutPick,
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
import { HavocMultiplayerSession, type HavocMultiplayerSessionAssets } from './session.ts';

const START_MS = Date.parse('2026-10-13T12:00:00.000Z');
const FIXED_ISO = new Date(START_MS).toISOString();
const ROOM_SEED = 'havoc-multiplayer-session-test';

let commandCounter = 0;

function nextCommandId(): string {
  commandCounter += 1;
  return `hvm-test-${String(commandCounter)}`;
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

function locksFor(versionSet: HavocVersionSet): HavocMultiplayerVersionLocks {
  return defaultHavocMultiplayerVersionLocks({
    engineVersion: versionSet.engineVersion,
    rulesVersion: versionSet.rulesVersion,
    mutationCatalogVersion: versionSet.mutationCatalogVersion,
    profileVersion: versionSet.profileVersion,
    dataVersion: versionSet.dataVersion,
    catalogVersion: versionSet.catalogVersion,
    catalogHash: versionSet.catalogHash,
    profileHash: versionSet.profileHash,
  });
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
    const existing = this.results.find(
      (row) => row.roomId === output.roomId && row.gameNumber === output.gameNumber,
    );
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
      verified: existing?.verified ?? false,
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
    const receipts = [...entries];
    this.verificationSaves.push(receipts);
    if (this.active !== null && this.active.roomId === roomId) {
      this.active = { ...this.active, verification: receipts };
    }
    const digests = new Set(receipts.map((receipt) => receipt.resultDigest));
    this.results = this.results.map((row) => ({ ...row, verified: digests.has(row.resultDigest) }));
    return Promise.resolve();
  }

  saveActive(state: HavocMultiplayerActiveState): Promise<void> {
    this.active = {
      ...state,
      saveSchemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
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
    this.commandRows = [];
    return Promise.resolve();
  }
}

class FakeHavocRunner {
  readonly calls: Array<{ roomId: string; gameNumber: number; inputDigest: string }> = [];
  disposed = false;
  private readonly context = createEngineContext();

  runGame(request: {
    roomId: string;
    gameNumber: number;
    input: HavocBattleInput;
  }): Promise<HavocMultiplayerWorkerGameOutput> {
    const inputDigest = havocBattleGameInputDigest(request.input);
    this.calls.push({ roomId: request.roomId, gameNumber: request.gameNumber, inputDigest });
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
  syncFromServer: () => Promise<void>;
  applySnapshot: (snapshot: HavocMultiplayerRoomSnapshot) => void;
  startTimers: () => void;
  progress: number;
};

interface Harness {
  transport: InMemoryHavocMultiplayerTransport;
  repository: FakeHavocMultiplayerRepository;
  runner: FakeHavocRunner;
  session: HavocMultiplayerSession;
  assets: HavocMultiplayerSessionAssets;
  environment: HavocCommandEnvironment;
  roomId: Id;
  code: HavocMultiplayerRoomCode;
  now: number;
  createSession(
    repository?: FakeHavocMultiplayerRepository,
    runner?: FakeHavocRunner,
  ): HavocMultiplayerSession;
  advance(ms: number): Promise<void>;
  flush(): Promise<void>;
  sync(): Promise<void>;
  snapshot(): Promise<HavocMultiplayerRoomSnapshot>;
  submit(
    actor: HavocMultiplayerParticipantId,
    payload: HavocMultiplayerCommandPayload,
    options?: { roomId?: string; commandId?: string; expectedRevision?: number },
  ): Promise<HavocMultiplayerCommandReceipt>;
  waitFor(check: () => boolean | Promise<boolean>): Promise<void>;
  internals(session?: HavocMultiplayerSession): SessionInternals;
}

async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 40; turn += 1) await Promise.resolve();
}

function must<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${label}`);
  return value;
}

async function createHarness(options?: {
  rng?: () => number;
  seed?: string;
  variant?: HavocMultiplayerVariant;
  lockOverrides?: Partial<HavocMultiplayerVersionLocks>;
}): Promise<Harness> {
  let now = START_MS;
  const transport = createInMemoryHavocMultiplayerTransport({
    clock: () => now,
    random:
      options?.rng !== undefined
        ? { rng: options.rng }
        : { seed: options?.seed ?? 'havoc-session' },
  });
  const assets = buildAssets();
  const locks = { ...locksFor(assets.versionSet), ...options?.lockOverrides };
  const created = await transport.create({ variant: options?.variant, versions: locks });
  await transport.join(created.code);
  const repository = new FakeHavocMultiplayerRepository();
  const runner = new FakeHavocRunner();
  const membership: HavocMultiplayerRoomMembership = {
    roomId: created.snapshot.roomId,
    participantId: 'p1',
    code: created.code,
  };
  const environment = createHavocCommandEnvironment(assets.catalog, {
    rngFactory: createRng,
    definitions: HAVOC_MUTATION_DEFINITIONS,
  });
  const createSession = (
    repo: FakeHavocMultiplayerRepository = repository,
    run: FakeHavocRunner = runner,
  ): HavocMultiplayerSession =>
    new HavocMultiplayerSession({
      transport,
      repository: repo,
      runner: run,
      loadAssets: () => Promise.resolve(assets),
      now: () => now,
      newCommandId: nextCommandId,
      friendlyError: (error) => (error instanceof Error ? error.message : String(error)),
      loadMembership: () => membership,
      saveMembership: () => {},
    });
  const session = createSession();
  const harness: Harness = {
    transport,
    repository,
    runner,
    session,
    assets,
    environment,
    roomId: created.snapshot.roomId,
    code: created.code,
    get now() {
      return now;
    },
    set now(value: number) {
      now = value;
    },
    createSession,
    async advance(ms: number): Promise<void> {
      now += ms;
      vi.advanceTimersByTime(ms);
      await flushMicrotasks();
    },
    flush: flushMicrotasks,
    async sync(): Promise<void> {
      await harness.internals().syncFromServer();
      await flushMicrotasks();
    },
    async snapshot(): Promise<HavocMultiplayerRoomSnapshot> {
      return (await transport.resume(harness.roomId)).snapshot;
    },
    async submit(actor, payload, submitOptions): Promise<HavocMultiplayerCommandReceipt> {
      const receipt = await transport.submitCommand(
        havocMultiplayerCommandSchema.parse({
          schemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
          roomId: submitOptions?.roomId ?? harness.roomId,
          commandId: submitOptions?.commandId ?? nextCommandId(),
          actorParticipantId: actor,
          ...(submitOptions?.expectedRevision !== undefined
            ? { expectedRevision: submitOptions.expectedRevision }
            : {}),
          payload,
        }),
      );
      await flushMicrotasks();
      return receipt;
    },
    async waitFor(check: () => boolean | Promise<boolean>): Promise<void> {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (await check()) return;
        await flushMicrotasks();
      }
      throw new Error('condition was not reached');
    },
    internals(target: HavocMultiplayerSession = session): SessionInternals {
      return target as unknown as SessionInternals;
    },
  };
  return harness;
}

function cardPayload(
  draft: NonNullable<HavocMultiplayerRoomSnapshot['draft']>,
  cardIndex = 0,
): Extract<HavocMultiplayerCommandPayload, { kind: 'pick' }> {
  const offer = draft.offer;
  if (offer === null) throw new Error('draft has no offer');
  const card = offer.cards[cardIndex];
  if (card === undefined) throw new Error('offer has no cards');
  const seasonKey = card.source.seasonKey;
  if (seasonKey === null) throw new Error('card has no season');
  return {
    kind: 'pick',
    turnOrdinal: draft.turnOrdinal,
    offerId: offer.offerId,
    cardId: card.cardId,
    claimKey: { playerId: card.source.playerId, seasonKey },
  };
}

async function startDraft(h: Harness): Promise<void> {
  await h.session.setReady();
  await h.submit('p2', { kind: 'ready' });
  await h.session.startDraft();
}

async function pickOnce(h: Harness): Promise<void> {
  await h.sync();
  const snapshot = await h.snapshot();
  const draft = snapshot.draft;
  if (draft === null || draft.offer === null || draft.activeParticipantId === null) {
    throw new Error('draft has no active offer');
  }
  const payload = cardPayload(draft);
  if (draft.activeParticipantId === 'p1') {
    await h.session.pickCard(must(draft.offer.cards[0], 'offer card'));
  } else {
    await h.submit('p2', payload);
    await h.sync();
  }
}

async function completeDraft(h: Harness): Promise<void> {
  for (let turn = 0; turn < HAVOC_MULTIPLAYER_TURNS; turn += 1) {
    await pickOnce(h);
  }
  expect(h.session.getSnapshot().draft?.status).toBe('complete');
}

async function reachBroadcasting(h: Harness): Promise<number> {
  const gameNumber = h.session.getSnapshot().currentGameNumber;
  if (gameNumber === null) throw new Error('no current game');
  await h.session.readyForNextGame();
  await h.submit('p2', { kind: 'ready-next-game', gameNumber });
  await h.sync();
  await h.advance(250);
  await h.waitFor(() => h.session.getSnapshot().phase === 'broadcasting');
  await h.waitFor(() => h.session.getSnapshot().outputs[gameNumber] !== undefined);
  return gameNumber;
}

async function hasCommand(
  h: Harness,
  predicate: (command: HavocMultiplayerCommand) => boolean,
): Promise<boolean> {
  const commands = await h.transport.refetch(h.roomId, -1);
  return commands.some(predicate);
}

async function verifyCurrentGame(h: Harness): Promise<void> {
  const gameNumber = h.session.getSnapshot().currentGameNumber;
  if (gameNumber === null) throw new Error('no current game');
  const output = h.session.getSnapshot().outputs[gameNumber];
  if (output === undefined) throw new Error('current game has no output');
  const durationMs = (await h.snapshot()).broadcast?.durationMs ?? HAVOC_MULTIPLAYER_BROADCAST_MS;
  h.session.beginPlayback();
  h.session.advancePlayback(durationMs);
  h.session.continueAfterGame();
  await h.flush();
  await h.waitFor(() =>
    hasCommand(
      h,
      (command) =>
        command.payload.kind === 'propose-result' &&
        command.payload.gameNumber === gameNumber &&
        command.actorParticipantId === 'p1',
    ),
  );
  await h.submit('p2', {
    kind: 'propose-result',
    gameNumber,
    winner: output.winner,
    resultDigest: output.resultDigest,
    inputDigest: output.inputDigest,
    tapeDigest: output.tapeDigest,
  });
  await h.sync();
  await h.waitFor(() =>
    hasCommand(
      h,
      (command) =>
        command.payload.kind === 'confirm-result' &&
        command.payload.gameNumber === gameNumber &&
        command.actorParticipantId === 'p1',
    ),
  );
  await h.submit('p2', {
    kind: 'confirm-result',
    gameNumber,
    verified: true,
    resultDigest: output.resultDigest,
    inputDigest: output.inputDigest,
    tapeDigest: output.tapeDigest,
  });
  await h.sync();
}

describe('HavocMultiplayerSession lifecycle', () => {
  it('skips unchanged snapshots and retries a failed snapshot save', async () => {
    const h = await createHarness();
    vi.spyOn(h.transport, 'subscribe').mockReturnValue({ unsubscribe: () => {} });
    await h.session.attach(h.roomId);
    await h.sync();
    const save = vi.spyOn(h.repository, 'saveActive');
    await h.sync();
    expect(save).not.toHaveBeenCalled();
    await h.submit('p2', { kind: 'ready' });
    save.mockRejectedValueOnce(new Error('storage unavailable'));
    await h.sync();
    expect(h.session.getSnapshot().error).toBe('storage unavailable');
    await h.sync();
    expect(save).toHaveBeenCalledTimes(2);
    await h.sync();
    expect(save).toHaveBeenCalledTimes(2);
    h.session.dispose();
  });

  it('persists only new commands and retries an unsuccessful append', async () => {
    const h = await createHarness();
    vi.spyOn(h.transport, 'subscribe').mockReturnValue({ unsubscribe: () => {} });
    const append = vi.spyOn(h.repository, 'appendCommands');
    await h.session.attach(h.roomId);
    await h.sync();
    append.mockClear();
    await h.sync();
    expect(append).not.toHaveBeenCalled();
    await h.submit('p2', { kind: 'ready' });
    append.mockRejectedValueOnce(new Error('storage unavailable'));
    await h.sync();
    expect(h.session.getSnapshot().error).toBe('storage unavailable');
    await h.sync();
    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls[0]?.[1]).toEqual(append.mock.calls[1]?.[1]);
    expect(append.mock.calls[1]?.[1]).toHaveLength(1);
    expect(h.session.getSnapshot().error).toBeNull();
    append.mockClear();
    await h.sync();
    expect(append).not.toHaveBeenCalled();
    h.session.dispose();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reports a missing membership without touching the transport', async () => {
    const h = await createHarness({ seed: ROOM_SEED });
    const resume = vi.spyOn(h.transport, 'resume');
    const session = new HavocMultiplayerSession({
      transport: h.transport,
      repository: h.repository,
      runner: h.runner,
      loadAssets: () => Promise.resolve(h.assets),
      now: () => h.now,
      newCommandId: nextCommandId,
      friendlyError: (error) => (error instanceof Error ? error.message : String(error)),
      loadMembership: () => null,
      saveMembership: () => {},
    });

    await session.attach(h.roomId);

    expect(session.getSnapshot().error).toBe(
      'You are not a member of this room. Join from the Havoc lobby.',
    );
    expect(resume).not.toHaveBeenCalled();
    session.dispose();
  });

  it('refuses to attach, sync, or apply snapshots after dispose', async () => {
    const h = await createHarness({ seed: ROOM_SEED });
    const resume = vi.spyOn(h.transport, 'resume');
    const refetch = vi.spyOn(h.transport, 'refetch');

    h.session.dispose();
    await h.session.attach(h.roomId);
    await h.internals().syncFromServer();
    h.internals().applySnapshot({} as HavocMultiplayerRoomSnapshot);

    expect(resume).not.toHaveBeenCalled();
    expect(refetch).not.toHaveBeenCalled();
    expect(h.session.getSnapshot().snapshot).toBeNull();
  });

  it('stops ticking and drops late playback frames after dispose', async () => {
    vi.useFakeTimers();
    const h = await createHarness({ seed: ROOM_SEED });
    const listener = vi.fn();
    h.session.subscribe(listener);
    h.internals().startTimers();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(500);
    await flushMicrotasks();
    expect(listener.mock.calls.length).toBeGreaterThan(0);

    h.internals().progress = 0.25;
    h.session.dispose();
    expect(vi.getTimerCount()).toBe(0);
    const callsAfterDispose = listener.mock.calls.length;

    vi.advanceTimersByTime(1000);
    await flushMicrotasks();
    h.session.advancePlayback(5000);

    expect(listener.mock.calls.length).toBe(callsAfterDispose);
    expect(h.session.getSnapshot().progress).toBe(0.25);
  });

  it('refuses to sync a room locked to different versions', async () => {
    const h = await createHarness({
      seed: ROOM_SEED,
      lockOverrides: { catalogHash: contentHashSchema.parse('cd'.repeat(32)) },
    });
    const refetch = vi.spyOn(h.transport, 'refetch');

    await h.session.attach(h.roomId);

    expect(h.session.getSnapshot().error).toBe(
      'This room was created with different engine or data versions.',
    );
    expect(refetch).not.toHaveBeenCalled();
    h.session.dispose();
  });

  it('accepts legacy v1 room locks for standard rooms', async () => {
    const h = await createHarness({
      seed: ROOM_SEED,
      lockOverrides: {
        multiplayerVersion: HAVOC_MULTIPLAYER_LEGACY_VERSION,
        rulesVersion: HAVOC_MULTIPLAYER_LEGACY_RULES_VERSION,
      },
    });
    await h.session.attach(h.roomId);
    expect(h.session.getSnapshot().error).toBeNull();
    h.session.dispose();
  });

  it('rejects curated rooms locked to the legacy rules version', async () => {
    const h = await createHarness({
      seed: ROOM_SEED,
      variant: 'curated',
      lockOverrides: {
        multiplayerVersion: HAVOC_MULTIPLAYER_LEGACY_VERSION,
        rulesVersion: HAVOC_MULTIPLAYER_LEGACY_RULES_VERSION,
      },
    });
    await h.session.attach(h.roomId);
    expect(h.session.getSnapshot().error).toBe(
      'This room was created with different engine or data versions.',
    );
    h.session.dispose();
  });

  it('passes the requested variant through room creation', async () => {
    const h = await createHarness({ seed: ROOM_SEED });
    const created = await h.session.createRoom('curated');
    expect(created).not.toBeNull();
    if (created === null) return;
    const resumed = await h.transport.resume(created.roomId);
    expect(resumed.snapshot.settings.variant).toBe('curated');
    h.session.dispose();
  });
});

describe('HavocMultiplayerSession draft and series', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    commandCounter = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('drafts ten picks and completes the series with a persisted recap', async () => {
    const h = await createHarness({ seed: ROOM_SEED });
    const complete = vi
      .spyOn(h.repository, 'complete')
      .mockRejectedValueOnce(new Error('storage unavailable'));
    await h.session.attach(h.roomId);
    await startDraft(h);
    await completeDraft(h);
    expect(h.session.getSnapshot().phase).toBe('lineup-showdown');

    for (let game = 0; game < 7; game += 1) {
      if (h.session.getSnapshot().phase === 'championship') break;
      await reachBroadcasting(h);
      await verifyCurrentGame(h);
    }

    await h.sync();
    expect(complete).toHaveBeenCalledTimes(2);
    const view = h.session.getSnapshot();
    expect(view.phase).toBe('championship');
    const series = view.series;
    expect(series?.champion).not.toBeNull();
    expect(view.verification).toHaveLength(series?.games.length ?? 0);
    expect(view.verification.every((entry) => entry.status === 'verified')).toBe(true);
    expect(h.repository.recaps).toHaveLength(1);
    const recap = must(h.repository.recaps[0], 'recap');
    expect(recap.champion).toBe(must(series?.champion, 'champion'));
    expect(recap.games).toHaveLength(series?.games.length ?? 0);
    expect(recap.mvp).not.toBeNull();
    expect(h.repository.completed?.mvp).toEqual(recap.mvp);
    expect(view.mvp).toEqual(recap.mvp);
    expect(h.session.getSnapshot().mvp).toBe(view.mvp);
    expect(h.runner.calls.map((call) => call.gameNumber)).toHaveLength(series?.games.length ?? 0);
    expect(h.repository.results.every((row) => row.verified)).toBe(true);
    const savedReceipts = h.repository.verificationSaves.at(-1) ?? [];
    expect(savedReceipts.map((receipt) => receipt.receiptId)).toEqual(
      (series?.games ?? []).map((game) => `hvr-${String(game.gameNumber)}`),
    );
    h.session.dispose();
  }, 120_000);

  it('rejects wrong-turn, stale, and conflicting commands without changing the draft', async () => {
    const h = await createHarness({ rng: () => 0 });
    await h.session.attach(h.roomId);
    await startDraft(h);
    const before = await h.snapshot();
    const draft = must(before.draft, 'draft');
    const active = must(draft.activeParticipantId, 'active participant');
    const idle = active === 'p1' ? 'p2' : 'p1';
    const logBefore = (await h.transport.refetch(h.roomId, -1)).length;
    const payload = cardPayload(draft);

    const wrongTurn = await h.submit(idle, payload);
    expect(wrongTurn.accepted).toBe(false);
    expect(wrongTurn.rejectionCode).toBe('wrong-turn');

    const stale = await h.submit(active, payload, { expectedRevision: before.revision + 5 });
    expect(stale.accepted).toBe(false);
    expect(stale.rejectionCode).toBe('stale-revision');

    const duplicateId = nextCommandId();
    const accepted = await h.submit(active, payload, { commandId: duplicateId });
    expect(accepted.accepted).toBe(true);
    const duplicate = await h.submit(active, payload, { commandId: duplicateId });
    expect(duplicate.accepted).toBe(true);
    expect((await h.transport.refetch(h.roomId, -1)).length).toBe(logBefore + 1);

    const conflict = await h.submit(
      active,
      { kind: 'reroll', turnOrdinal: payload.turnOrdinal, offerId: payload.offerId },
      { commandId: duplicateId },
    );
    expect(conflict.accepted).toBe(false);
    expect(conflict.rejectionCode).toBe('command-conflict');

    const after = await h.snapshot();
    expect(after.draft?.picks).toHaveLength(1);
    expect(after.draft?.turnOrdinal).toBe(1);
    expect((await h.transport.refetch(h.roomId, -1)).length).toBe(logBefore + 1);
    expect(h.repository.commandRows).toHaveLength(logBefore + 1);

    await h.sync();
    const view = h.session.getSnapshot();
    expect(view.draft?.turnOrdinal).toBe(after.draft?.turnOrdinal);
    expect(view.draft?.offer?.offerId).toBe(after.draft?.offer?.offerId);
    expect(view.draft?.picks).toHaveLength(1);
    h.session.dispose();
  }, 60_000);

  it('resolves a timeout with the deterministic fallback only for the active participant', async () => {
    const h = await createHarness({ rng: () => 0 });
    await h.session.attach(h.roomId);
    await startDraft(h);
    const before = await h.snapshot();
    const draft = must(before.draft, 'draft');
    expect(draft.activeParticipantId).toBe('p1');
    const expected = havocMultiplayerTimeoutPick(draft, h.assets.catalog, h.environment);

    await h.advance(HAVOC_MULTIPLAYER_PICK_TIMEOUT_MS + 250);
    await h.waitFor(() => h.session.getSnapshot().draft?.turnOrdinal === 1);

    const commands = await h.transport.refetch(h.roomId, -1);
    const timeouts = commands.filter((command) => command.payload.kind === 'timeout-pick');
    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]?.actorParticipantId).toBe('p1');
    expect(timeouts[0]?.payload).toMatchObject({
      kind: 'timeout-pick',
      turnOrdinal: 0,
      offerId: draft.offer?.offerId,
      cardId: expected.cardId,
    });
    expect(h.session.getSnapshot().draft?.picks).toHaveLength(1);

    await h.advance(HAVOC_MULTIPLAYER_PICK_TIMEOUT_MS + 250);
    const later = await h.transport.refetch(h.roomId, -1);
    expect(later.filter((command) => command.payload.kind === 'timeout-pick')).toHaveLength(1);
    expect(h.session.getSnapshot().draft?.turnOrdinal).toBe(1);
    h.session.dispose();
  }, 60_000);

  it('keeps the deadline but invalidates the fallback after a reroll', async () => {
    const h = await createHarness({ rng: () => 0 });
    await h.session.attach(h.roomId);
    await startDraft(h);
    const before = await h.snapshot();
    const deadline = must(before.deadline, 'deadline');
    const draft = must(before.draft, 'draft');
    const stalePick = havocMultiplayerTimeoutPick(draft, h.assets.catalog, h.environment);
    await h.transport.commitFallback(h.roomId, deadline.cursor, {
      kind: 'timeout-pick',
      turnOrdinal: draft.turnOrdinal,
      offerId: must(draft.offer, 'offer').offerId,
      cardId: stalePick.cardId,
    });
    expect((await h.snapshot()).deadline?.fallback).not.toBeNull();

    await h.session.rerollOffer();

    const rerolled = await h.snapshot();
    expect(rerolled.draft?.offer?.offerIndex).toBe(1);
    expect(rerolled.draft?.rerollsUsed.p1).toBe(1);
    expect(rerolled.deadline?.at).toBe(deadline.at);
    expect(rerolled.deadline?.fallback).toBeNull();

    await h.advance(HAVOC_MULTIPLAYER_PICK_TIMEOUT_MS + 250);
    await h.waitFor(() => h.session.getSnapshot().draft?.turnOrdinal === 1);

    const commands = await h.transport.refetch(h.roomId, -1);
    const timeout = commands.find((command) => command.payload.kind === 'timeout-pick');
    expect(timeout?.payload).toMatchObject({
      kind: 'timeout-pick',
      offerId: rerolled.draft?.offer?.offerId,
    });
    const timeoutCardId = timeout?.payload.kind === 'timeout-pick' ? timeout.payload.cardId : null;
    expect(
      rerolled.draft?.offer?.cards.some((card) => card.cardId === timeoutCardId) ?? false,
    ).toBe(true);
    h.session.dispose();
  });

  it('halts advancement when the peer digest mismatches', async () => {
    const h = await createHarness({ seed: ROOM_SEED });
    await h.session.attach(h.roomId);
    await startDraft(h);
    await completeDraft(h);
    const gameNumber = await reachBroadcasting(h);
    const output = must(h.session.getSnapshot().outputs[gameNumber], 'game output');
    h.session.beginPlayback();
    h.session.advancePlayback(HAVOC_MULTIPLAYER_BROADCAST_MS);
    h.session.continueAfterGame();
    await h.flush();
    await h.waitFor(() =>
      hasCommand(
        h,
        (command) =>
          command.payload.kind === 'propose-result' &&
          command.actorParticipantId === 'p1' &&
          command.payload.gameNumber === gameNumber,
      ),
    );
    const flipped = `${output.resultDigest.slice(0, -1)}${output.resultDigest.endsWith('a') ? 'b' : 'a'}`;
    await h.submit('p2', {
      kind: 'propose-result',
      gameNumber,
      winner: output.winner,
      resultDigest: flipped,
      inputDigest: output.inputDigest,
      tapeDigest: output.tapeDigest,
    });
    await h.sync();
    await h.waitFor(() => h.session.getSnapshot().integrityFailed);
    await h.waitFor(async () => (await h.snapshot()).phase === 'integrity-failed');

    const view = h.session.getSnapshot();
    expect(view.verification).toEqual([
      {
        gameNumber,
        localResultDigest: output.resultDigest,
        peerResultDigest: flipped,
        status: 'mismatch',
      },
    ]);
    expect(view.phase).toBe('integrity-failed');
    expect(h.runner.calls.map((call) => call.gameNumber)).toEqual([gameNumber]);
    h.session.dispose();
  }, 60_000);

  it('reconnects during drafting without creating a new offer or refunding a reroll', async () => {
    const h = await createHarness({ rng: () => 0 });
    await h.session.attach(h.roomId);
    await startDraft(h);
    await h.session.rerollOffer();
    await pickOnce(h);
    await pickOnce(h);
    const before = h.session.getSnapshot();
    expect(before.draft?.rerollsUsed.p1).toBe(1);
    h.session.dispose();

    const sessionB = h.createSession(new FakeHavocMultiplayerRepository(), new FakeHavocRunner());
    await sessionB.attach(h.roomId);
    const viewB = sessionB.getSnapshot();
    expect(viewB.draft?.turnOrdinal).toBe(before.draft?.turnOrdinal);
    expect(viewB.draft?.offer?.offerId).toBe(before.draft?.offer?.offerId);
    expect(viewB.draft?.rerollsUsed.p1).toBe(1);
    expect(viewB.draft?.picks).toHaveLength(before.draft?.picks.length ?? 0);
    expect(viewB.commands).toHaveLength(before.commands.length);
    sessionB.dispose();
  }, 60_000);

  it('regenerates a missing game identically from the frozen input', async () => {
    const h = await createHarness({ seed: ROOM_SEED });
    await h.session.attach(h.roomId);
    await startDraft(h);
    await completeDraft(h);
    const gameNumber = await reachBroadcasting(h);
    const outputA = must(h.session.getSnapshot().outputs[gameNumber], 'game output');
    h.session.dispose();

    const runnerB = new FakeHavocRunner();
    const sessionB = h.createSession(new FakeHavocMultiplayerRepository(), runnerB);
    await sessionB.attach(h.roomId);
    const outputB = sessionB.getSnapshot().outputs[gameNumber];
    expect(outputB?.inputDigest).toBe(outputA.inputDigest);
    expect(outputB?.resultDigest).toBe(outputA.resultDigest);
    expect(outputB?.tapeDigest).toBe(outputA.tapeDigest);
    expect(runnerB.calls.map((call) => call.gameNumber)).toEqual([gameNumber]);
    sessionB.dispose();
  }, 60_000);

  it('reconnects during the results phase and recovers the current game', async () => {
    const h = await createHarness({ seed: ROOM_SEED });
    await h.session.attach(h.roomId);
    await startDraft(h);
    await completeDraft(h);
    const gameNumber = await reachBroadcasting(h);
    const output = must(h.session.getSnapshot().outputs[gameNumber], 'game output');
    h.session.beginPlayback();
    h.session.advancePlayback(HAVOC_MULTIPLAYER_BROADCAST_MS);
    await h.waitFor(() => h.session.getSnapshot().phase === 'game-results');
    h.session.dispose();

    const runnerB = new FakeHavocRunner();
    const sessionB = h.createSession(new FakeHavocMultiplayerRepository(), runnerB);
    await sessionB.attach(h.roomId);
    const viewB = sessionB.getSnapshot();
    expect(viewB.phase).toBe('game-results');
    expect(viewB.outputs[gameNumber]?.resultDigest).toBe(output.resultDigest);
    expect(viewB.awaitingContinue).toBe(true);
    expect(
      viewB.commands.some(
        (command) =>
          command.payload.kind === 'propose-result' && command.actorParticipantId === 'p1',
      ),
    ).toBe(true);
    expect(runnerB.calls.map((call) => call.gameNumber)).toEqual([gameNumber]);
    sessionB.dispose();
  }, 60_000);

  it('restores persisted verification and results on attach', async () => {
    const h = await createHarness({ seed: ROOM_SEED });
    await h.session.attach(h.roomId);
    await startDraft(h);
    await completeDraft(h);
    const gameNumber = await reachBroadcasting(h);
    await verifyCurrentGame(h);
    const view = h.session.getSnapshot();
    const output = must(view.outputs[gameNumber], 'game output');
    expect(view.verification).toEqual([
      {
        gameNumber,
        localResultDigest: output.resultDigest,
        peerResultDigest: output.resultDigest,
        status: 'verified',
      },
    ]);
    h.session.dispose();

    const runnerB = new FakeHavocRunner();
    const sessionB = h.createSession(h.repository, runnerB);
    await sessionB.attach(h.roomId);
    const viewB = sessionB.getSnapshot();
    expect(viewB.outputs[gameNumber]?.resultDigest).toBe(output.resultDigest);
    expect(viewB.verification).toEqual([
      {
        gameNumber,
        localResultDigest: output.resultDigest,
        peerResultDigest: output.resultDigest,
        status: 'verified',
      },
    ]);
    expect(runnerB.calls.some((call) => call.gameNumber === gameNumber)).toBe(false);
    sessionB.dispose();
  }, 60_000);

  it('starts the broadcast automatically when both participants are ready', async () => {
    const h = await createHarness({ seed: ROOM_SEED });
    await h.session.attach(h.roomId);
    await startDraft(h);
    await completeDraft(h);
    const gameNumber = must(h.session.getSnapshot().currentGameNumber, 'current game');
    await h.session.readyForNextGame();
    await h.submit('p2', { kind: 'ready-next-game', gameNumber });
    await h.sync();

    await h.advance(250);
    await h.waitFor(() => h.session.getSnapshot().phase === 'broadcasting');
    const view = h.session.getSnapshot();
    expect(view.broadcast?.gameNumber).toBe(gameNumber);
    expect(view.localReady).toBe(false);
    h.session.dispose();
  }, 60_000);

  it('waits for the opponent until the ready window elapses', async () => {
    const h = await createHarness({ seed: ROOM_SEED });
    await h.session.attach(h.roomId);
    await startDraft(h);
    await completeDraft(h);
    const gameNumber = must(h.session.getSnapshot().currentGameNumber, 'current game');
    await h.session.readyForNextGame();
    await h.sync();
    expect(h.session.getSnapshot().phase).toBe('preparing-game');
    expect(h.session.getSnapshot().localReady).toBe(true);
    expect(h.session.getSnapshot().opponentReady).toBe(false);
    expect(h.session.getSnapshot().readyCountdownMs).toBeGreaterThan(0);

    await h.advance(59_750);
    expect(h.session.getSnapshot().phase).toBe('preparing-game');
    await h.advance(250);
    await h.waitFor(() => h.session.getSnapshot().phase === 'broadcasting');
    expect(h.session.getSnapshot().broadcast?.gameNumber).toBe(gameNumber);
    h.session.dispose();
  }, 60_000);

  it('creates a successor rematch with a fresh draft and requires both confirmations', async () => {
    const h = await createHarness({ seed: ROOM_SEED });
    await h.submit('p1', { kind: 'ready' });
    await h.submit('p2', { kind: 'ready' });
    await h.submit('p1', { kind: 'start' });
    const started = await h.snapshot();
    const originalRootSeed = started.draft?.rootSeed;
    expect(originalRootSeed).toBeDefined();
    for (let turn = 0; turn < HAVOC_MULTIPLAYER_TURNS; turn += 1) {
      const snapshot = await h.snapshot();
      const draft = must(snapshot.draft, 'draft');
      await h.submit(must(draft.activeParticipantId, 'active participant'), cardPayload(draft));
    }
    const digest = '7c'.repeat(16);
    for (let gameNumber = 1; gameNumber <= 4; gameNumber += 1) {
      await h.submit('p1', { kind: 'ready-next-game', gameNumber });
      await h.submit('p2', { kind: 'ready-next-game', gameNumber });
      await h.submit('p1', { kind: 'broadcast-start', gameNumber });
      for (const actor of ['p1', 'p2'] as const) {
        await h.submit(actor, {
          kind: 'propose-result',
          gameNumber,
          winner: 'p1',
          resultDigest: digest,
          inputDigest: digest,
          tapeDigest: digest,
        });
      }
      for (const actor of ['p1', 'p2'] as const) {
        await h.submit(actor, {
          kind: 'confirm-result',
          gameNumber,
          verified: true,
          resultDigest: digest,
          inputDigest: digest,
          tapeDigest: digest,
        });
      }
    }
    expect((await h.snapshot()).phase).toBe('championship');

    await h.session.attach(h.roomId);
    expect(h.session.getSnapshot().phase).toBe('championship');

    const earlyConfirm = await h.submit('p2', { kind: 'rematch-confirm' });
    expect(earlyConfirm.accepted).toBe(false);
    await h.session.requestRematch();
    expect((await h.snapshot()).successorRoomId).toBeNull();

    await h.submit('p2', { kind: 'rematch-request' });
    await h.session.confirmRematch();
    await h.submit('p2', { kind: 'rematch-confirm' });
    const decided = await h.snapshot();
    expect(decided.successorRoomId).not.toBeNull();
    const commands = await h.transport.refetch(h.roomId, -1);
    expect(commands.filter((command) => command.payload.kind === 'rematch-confirm')).toHaveLength(
      2,
    );

    const successorRoomId = must(await h.session.followRematch(), 'successor room');
    expect(successorRoomId).not.toBe(h.roomId);

    await h.submit('p1', { kind: 'ready' }, { roomId: successorRoomId });
    await h.submit('p2', { kind: 'ready' }, { roomId: successorRoomId });
    await h.submit('p1', { kind: 'start' }, { roomId: successorRoomId });
    const successor = (await h.transport.resume(successorRoomId)).snapshot;
    expect(successor.draft?.rootSeed).toBeDefined();
    expect(successor.draft?.rootSeed).not.toBe(originalRootSeed);
    expect(successor.phase).toBe('drafting');
    h.session.dispose();
  }, 60_000);
});
