import { describe, expect, it, vi } from 'bun:test';
import { defaultFixedFiveVersionLocks } from '@hoop-rush/data-contracts';
import { LobbySession, type LobbySessionDeps } from './lobby-session.ts';
import { RoomLifecycle } from './room-lifecycle.ts';
import { SeriesCoordinator } from './series-coordinator.ts';
import { CommandRecovery, executeMultiplayerCommand } from './command-execution.ts';
import { CoalescedTask } from '../runtime/index.ts';

const lobbyId = '00000000-0000-4000-8000-000000000001';
const roomId = '00000000-0000-4000-8000-000000000002';
const room2 = '00000000-0000-4000-8000-000000000003';
const lobby = {
  id: lobbyId,
  code: '1234',
  revision: 0,
  participantId: 'p1' as 'p1' | 'p2',
  guestJoined: false,
  gameKind: null as 'fixed-five' | null,
  gameRoomId: null as string | null,
  canStart: true,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
function harness(command: LobbySessionDeps['command'] = vi.fn(() => Promise.resolve(lobby))) {
  let tick = () => {};
  const stop = vi.fn();
  const deps: LobbySessionDeps = {
    command,
    resumeGame: vi.fn(() => Promise.resolve()),
    rememberLobby: vi.fn(),
    friendlyError: String,
    scheduleTick: vi.fn((callback: () => void, interval: number) => {
      expect(interval).toBe(2000);
      tick = callback;
      return stop;
    }),
  };
  const session = new LobbySession(deps);
  return {
    session,
    deps,
    stop,
    tick: () => {
      tick();
    },
  };
}

describe('lobby orchestration', () => {
  it.each(['success', 'error'] as const)(
    'clears room previews on code edits and ignores delayed %s responses',
    async (result) => {
      const firstPreview = { legacy: false, code: '1234', guestJoined: false } as const;
      const nextPreview = { legacy: false, code: '5678', guestJoined: true } as const;
      const pending = deferred<unknown>();
      const command = vi
        .fn<LobbySessionDeps['command']>()
        .mockResolvedValueOnce(firstPreview)
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce(nextPreview);
      const h = harness(command);
      await h.session.preview('1234');
      expect(h.session.getSnapshot().preview).toEqual(firstPreview);
      h.session.clearPreview();
      expect(h.session.getSnapshot().preview).toBeNull();
      const refresh = h.session.preview('1234');
      h.session.clearPreview();
      if (result === 'success') pending.resolve(firstPreview);
      else pending.reject(new Error('invalid-code'));
      await refresh;
      expect(h.session.getSnapshot()).toMatchObject({ preview: null, error: null, busy: false });
      await h.session.preview('5678');
      expect(h.session.getSnapshot().preview).toEqual(nextPreview);
      h.session.dispose();
    },
  );

  it('creates and remembers one validated lobby and publishes a navigation intent', async () => {
    const h = harness();
    await h.session.create();
    expect(h.session.getSnapshot()).toMatchObject({
      lobby,
      busy: false,
      connection: 'connected',
      navigation: { kind: 'lobby', lobbyId },
    });
    expect(h.deps.rememberLobby).toHaveBeenCalledWith(lobby);
    h.session.acknowledgeNavigation();
    expect(h.session.getSnapshot().navigation).toBeNull();
    h.session.dispose();
    expect(h.stop).toHaveBeenCalledTimes(1);
  });
  it('never overlaps refreshes and coalesces duplicate events', async () => {
    const pending = deferred<unknown>();
    const command = vi
      .fn<LobbySessionDeps['command']>()
      .mockResolvedValueOnce(lobby)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(lobby);
    const h = harness(command);
    await h.session.attach(lobbyId);
    h.tick();
    h.tick();
    h.tick();
    await flush();
    expect(command).toHaveBeenCalledTimes(2);
    const refresh = h.session.refresh();
    pending.resolve(lobby);
    await refresh;
    expect(command).toHaveBeenCalledTimes(3);
    h.session.dispose();
  });
  it('keeps validated state during disconnection and recovers on reconnect', async () => {
    const command = vi
      .fn<LobbySessionDeps['command']>()
      .mockResolvedValueOnce(lobby)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ ...lobby, revision: 1 });
    const h = harness(command);
    await h.session.attach(lobbyId);
    await h.session.refresh();
    expect(h.session.getSnapshot()).toMatchObject({ lobby, connection: 'error' });
    await h.session.reconnect();
    expect(h.session.getSnapshot()).toMatchObject({
      connection: 'connected',
      error: null,
      lobby: { revision: 1 },
    });
    h.session.dispose();
  });
  it('rejects stale snapshots and invalid wire data', async () => {
    const command = vi
      .fn<LobbySessionDeps['command']>()
      .mockResolvedValueOnce({ ...lobby, revision: 3 })
      .mockResolvedValueOnce(lobby)
      .mockResolvedValueOnce({ ...lobby, code: 'bad' });
    const h = harness(command);
    await h.session.attach(lobbyId);
    await h.session.refresh();
    await h.session.refresh();
    expect(h.session.getSnapshot().lobby?.revision).toBe(3);
    expect(h.session.getSnapshot().error).not.toBeNull();
    h.session.dispose();
  });
  it('follows each new guest match once, including when returning to the lobby', async () => {
    const command = vi
      .fn<LobbySessionDeps['command']>()
      .mockResolvedValueOnce({ ...lobby, participantId: 'p2' })
      .mockResolvedValue({
        ...lobby,
        participantId: 'p2',
        revision: 1,
        gameKind: 'fixed-five',
        gameRoomId: roomId,
        canStart: false,
      });
    const h = harness(command);
    await h.session.attach(lobbyId);
    await h.session.refresh();
    expect(h.session.getSnapshot().navigation).toEqual({
      kind: 'game',
      gameKind: 'fixed-five',
      roomId,
    });
    h.session.acknowledgeNavigation();
    await h.session.attach(lobbyId);
    await h.session.refresh();
    expect(h.deps.resumeGame).toHaveBeenCalledTimes(1);
    expect(h.session.getSnapshot().navigation).toBeNull();
    h.session.dispose();
  });
  it('does not navigate after disposal during membership recovery', async () => {
    const pending = deferred<undefined>();
    const h = harness(
      vi
        .fn()
        .mockResolvedValueOnce({ ...lobby, participantId: 'p2' })
        .mockResolvedValue({
          ...lobby,
          participantId: 'p2',
          revision: 1,
          gameKind: 'fixed-five',
          gameRoomId: roomId,
        }),
    );
    h.deps.resumeGame = () => pending.promise;
    await h.session.attach(lobbyId);
    const refresh = h.session.refresh();
    await flush();
    h.session.dispose();
    pending.resolve(undefined);
    await refresh;
    expect(h.session.getSnapshot().navigation).toBeNull();
  });
  it('ignores an attachment replaced while its request is pending', async () => {
    const pending = deferred<unknown>();
    const h = harness(
      vi
        .fn()
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValue({ ...lobby, id: room2 }),
    );
    const first = h.session.attach(lobbyId);
    await h.session.attach(room2);
    pending.resolve(lobby);
    await first;
    expect(h.session.getSnapshot().lobby?.id).toBe(room2);
    h.session.dispose();
  });
  it('starts matches with the validated revision and authoritative settings', async () => {
    const settings = {
      gameKind: 'fixed-five' as const,
      mode: 'duel' as const,
      sourceMode: 'classic' as const,
      variant: 'ratings' as const,
      versions: defaultFixedFiveVersionLocks({}),
    };
    const command = vi
      .fn<LobbySessionDeps['command']>()
      .mockResolvedValueOnce(lobby)
      .mockResolvedValueOnce({
        ...lobby,
        revision: 1,
        gameKind: 'fixed-five',
        gameRoomId: roomId,
        canStart: false,
      });
    const h = harness(command);
    await h.session.attach(lobbyId);
    await h.session.startMatch(settings);
    expect(command).toHaveBeenLastCalledWith({
      kind: 'start',
      lobbyId,
      expectedRevision: 0,
      settings,
    });
    expect(h.deps.resumeGame).toHaveBeenCalledWith('fixed-five', roomId);
    h.session.dispose();
  });
  it('does not create a second match after a lost response; refresh recovers it', async () => {
    const command = vi
      .fn<LobbySessionDeps['command']>()
      .mockResolvedValueOnce(lobby)
      .mockRejectedValueOnce(new Error('lost'))
      .mockResolvedValue({
        ...lobby,
        revision: 1,
        gameKind: 'fixed-five',
        gameRoomId: roomId,
        canStart: false,
      });
    const h = harness(command);
    await h.session.attach(lobbyId);
    await h.session.startMatch({
      gameKind: 'fixed-five',
      mode: 'duel',
      sourceMode: 'classic',
      variant: 'ratings',
      versions: defaultFixedFiveVersionLocks({}),
    });
    await h.session.refresh();
    expect(command.mock.calls.filter(([c]) => c.kind === 'start')).toHaveLength(1);
    expect(h.session.getSnapshot().lobby?.gameRoomId).toBe(roomId);
    h.session.dispose();
  });
  it('joins a legacy room through the same membership and navigation ports', async () => {
    const h = harness(() =>
      Promise.resolve({ legacy: true, gameKind: 'fixed-five', gameRoomId: roomId }),
    );
    await h.session.join('1234');
    expect(h.deps.resumeGame).toHaveBeenCalledWith('fixed-five', roomId);
    expect(h.session.getSnapshot().navigation).toEqual({
      kind: 'game',
      gameKind: 'fixed-five',
      roomId,
    });
    h.session.dispose();
  });
  it('leaves and removes opponents with typed commands', async () => {
    const command = vi
      .fn<LobbySessionDeps['command']>()
      .mockResolvedValueOnce(lobby)
      .mockResolvedValueOnce({ ...lobby, revision: 1 })
      .mockResolvedValueOnce({ left: true });
    const h = harness(command);
    await h.session.attach(lobbyId);
    await h.session.removeOpponent();
    await h.session.leave();
    expect(command.mock.calls.slice(1)).toEqual([
      [{ kind: 'remove-guest', lobbyId }],
      [{ kind: 'leave', lobbyId }],
    ]);
    expect(h.session.getSnapshot().lobby).toBeNull();
    h.session.dispose();
  });
});

describe('room attachment lifecycle', () => {
  it('invalidates delayed work, cleans old subscriptions, and refuses work after disposal', () => {
    const lifecycle = new RoomLifecycle();
    const first = lifecycle.begin(roomId);
    const stop = vi.fn();
    lifecycle.track(first, stop);
    const second = lifecycle.begin(room2);
    expect(first.current()).toBe(false);
    expect(stop).toHaveBeenCalledTimes(1);
    const late = vi.fn();
    lifecycle.track(first, late);
    expect(late).toHaveBeenCalledTimes(1);
    lifecycle.connected(second);
    expect(lifecycle.getConnection()).toBe('connected');
    lifecycle.dispose();
    expect(second.current()).toBe(false);
    expect(lifecycle.begin(roomId).current()).toBe(false);
  });
  it('waits for queued refreshes and rejects without an unhandled trailing request', async () => {
    const pending = deferred<undefined>();
    const task = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
    const coalesced = new CoalescedTask(task);
    const first = coalesced.request();
    const second = coalesced.request();
    await flush();
    expect(task).toHaveBeenCalledTimes(1);
    pending.resolve(undefined);
    await Promise.all([first, second]);
    expect(task).toHaveBeenCalledTimes(2);
  });
});

describe('series coordination', () => {
  it('preserves readiness timers, auto-start retries, broadcast progress, and continuation hold', () => {
    let now = 10_000;
    const series = new SeriesCoordinator(() => now, 5000);
    series.holdMs = 60_000;
    series.observe('preparing-game', null);
    expect(series.readyCountdown(false, 60_000)).toBe(60_000);
    now += 60_000;
    expect(series.shouldAutoStart(false, false, 60_000)).toBe(true);
    expect(series.shouldAutoStart(false, false, 60_000)).toBe(false);
    series.observe('broadcasting', 1);
    series.playback.begin(now, now, 1000);
    expect(series.playback.advance(1000, 1000, now).completed).toBe(true);
    expect(series.playback.continueApproved(1, 60_000, now)).toBe(false);
    series.playback.approve(1);
    expect(series.playback.continueApproved(1, 60_000, now)).toBe(true);
    expect(series.memberReady([{ participantId: 'p1', nextGameReady: 1 }], 'p1', 1)).toBe(true);
  });
  it('deduplicates jobs and discards simulation output after disposal', async () => {
    const series = new SeriesCoordinator(() => 0, 5000);
    let active = true;
    const pending = deferred<number>();
    const accept = vi.fn();
    const run = vi.fn(() => pending.promise);
    const first = series.runGame(1, () => active, run, accept);
    await series.runGame(1, () => active, run, accept);
    active = false;
    pending.resolve(42);
    await first;
    expect(run).toHaveBeenCalledTimes(1);
    expect(accept).not.toHaveBeenCalled();
  });
  it('deduplicates proposals and confirmations, verifies recorded peer facts, and retries only after the delay', async () => {
    let now = 10_000;
    const series = new SeriesCoordinator(() => now, 5000);
    series.observe('broadcasting', 1);
    series.playback.begin(now, now, 1000);
    series.playback.advance(1000, 1000, now);
    series.playback.approve(1);
    const propose = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const confirm = vi.fn(() => Promise.resolve(true));
    const verification = vi.fn();
    const input = {
      gameNumber: 1,
      localDigest: 'a',
      ownProposal: 'a',
      peerProposal: 'a',
      current: () => true,
      propose,
      confirm,
      verification,
    };
    series.coordinate(input);
    await flush();
    series.coordinate(input);
    expect(propose).toHaveBeenCalledTimes(1);
    now += 5000;
    series.coordinate(input);
    await flush();
    series.coordinate(input);
    series.coordinate(input);
    await flush();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(verification).toHaveBeenCalledWith(true, 'a');
  });
  it('waits for local review before confirming a matching peer result', async () => {
    let now = 10_000;
    const series = new SeriesCoordinator(() => now, 5000);
    series.holdMs = 60_000;
    series.proposals.add(1);
    const confirm = vi.fn(() => Promise.resolve(true));
    const input = {
      gameNumber: 1,
      localDigest: 'a',
      ownProposal: 'a',
      peerProposal: 'a',
      current: () => true,
      propose: () => Promise.resolve(true),
      confirm,
    };
    series.coordinate(input);
    await flush();
    expect(confirm).not.toHaveBeenCalled();
    series.playback.resumeReview(now);
    series.coordinate(input);
    await flush();
    expect(confirm).not.toHaveBeenCalled();
    now += 60_000;
    series.coordinate(input);
    await flush();
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it('requires a completion or an explicit review resume before continuing', () => {
    let now = 10_000;
    const series = new SeriesCoordinator(() => now, 5000);
    series.holdMs = 60_000;
    series.observe('game-results', 1);
    expect(series.playback.continueApproved(1, 60_000, now)).toBe(false);
    series.playback.resumeReview(now);
    now += 59_999;
    expect(series.playback.continueApproved(1, 60_000, now)).toBe(false);
    now += 1;
    expect(series.playback.continueApproved(1, 60_000, now)).toBe(true);
  });
  it('reports a mismatch immediately without waiting for the result hold', async () => {
    const series = new SeriesCoordinator(() => 10_000, 5000);
    series.holdMs = 60_000;
    series.proposals.add(1);
    series.playback.advance(1000, 1000, 10_000);
    const confirm = vi.fn(() => Promise.resolve(true));
    const mismatch = vi.fn();
    const verification = vi.fn();
    series.coordinate({
      gameNumber: 1,
      localDigest: 'a',
      ownProposal: 'a',
      peerProposal: 'b',
      current: () => true,
      propose: () => Promise.resolve(true),
      confirm,
      mismatch,
      verification,
    });
    expect(verification).toHaveBeenCalledWith(false, 'b');
    await flush();
    expect(confirm).toHaveBeenCalledWith(false);
    expect(mismatch).toHaveBeenCalledTimes(1);
  });
});

describe('command execution', () => {
  it('uses one attempt by default and preserves the ID when recovering an uncertain response', async () => {
    const recovery = new CommandRecovery();
    const create = vi.fn().mockReturnValueOnce('command-1').mockReturnValueOnce('command-2');
    const payload = { kind: 'ready' };
    const submit = vi
      .fn<(command: { commandId: string }) => Promise<{ accepted: boolean }>>()
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce({ accepted: true });
    const attempt = { submit, classify: () => 'accepted' as const };
    await expect(
      executeMultiplayerCommand({ commandId: recovery.id(payload, create) }, attempt),
    ).rejects.toThrow('lost response');
    await executeMultiplayerCommand({ commandId: recovery.id(payload, create) }, attempt);
    recovery.settled(payload);
    expect(submit.mock.calls.map(([c]) => c.commandId)).toEqual(['command-1', 'command-1']);
    expect(recovery.id(payload, create)).toBe('command-2');
  });
  it('rejects a retry policy that replaces a command ID', async () => {
    await expect(
      executeMultiplayerCommand<{ commandId: string }, string>(
        { commandId: 'first' },
        {
          submit: () => Promise.resolve('stale'),
          classify: () => 'stale',
          revise: () => ({ commandId: 'replacement' }),
        },
        {
          intent: 'multiplayer-command',
          conflict: 'resync-retry',
          maxAttempts: 2,
        },
      ),
    ).rejects.toThrow('retain its command ID');
  });
});
