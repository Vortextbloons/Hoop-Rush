import { describe, expect, it } from 'bun:test';
import { DeadlineRecovery } from './deadline-recovery.ts';
import { RoomActions } from './room-actions.ts';
import { RoomSynchronization } from './room-synchronization.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('room state owners', () => {
  it('does not let a detached submission release a replacement action', async () => {
    const actions = new RoomActions();
    const oldReceipt = deferred<{ accepted: boolean }>();
    let oldCurrent = true;
    const base = {
      payload: { kind: 'ready' },
      newCommandId: () => 'cmd-ready',
      build: (commandId: string) => ({ commandId }),
      sync: () => Promise.resolve(),
      rejectedLabel: 'rejected',
    };
    const old = actions.submit({
      ...base,
      current: () => oldCurrent,
      submit: () => oldReceipt.promise,
    });
    oldCurrent = false;
    actions.reset();
    const nextReceipt = deferred<{ accepted: boolean }>();
    const next = actions.submit({
      ...base,
      current: () => true,
      submit: () => nextReceipt.promise,
    });
    oldReceipt.resolve({ accepted: true });
    expect(await old).toBe('abandoned');
    expect(actions.busy).toBe(true);
    nextReceipt.resolve({ accepted: true });
    expect(await next).toBe('accepted');
    expect(actions.busy).toBe(false);
  });

  it('returns an action result after it intentionally attaches a new room without unlocking its next action', async () => {
    const actions = new RoomActions();
    const oldResult = deferred<string>();
    const old = actions.run(() => oldResult.promise);
    actions.reset();
    const nextResult = deferred<string>();
    const next = actions.run(() => nextResult.promise);
    oldResult.resolve('created-room');
    expect(await old).toEqual({ kind: 'succeeded', value: 'created-room' });
    expect(actions.busy).toBe(true);
    nextResult.resolve('next-room');
    await next;
    expect(actions.busy).toBe(false);
  });

  it('checks the latest room revision before adopting a delayed command log', async () => {
    type Response = {
      snapshot: { revision: number; commandCount: number };
      commands: Array<{ commandId: string }>;
    };
    const sync = new RoomSynchronization<Response['snapshot'], { commandId: string }>();
    const response = deferred<Response>();
    let revision = 1;
    const pending = sync.fetch({
      current: () => true,
      revision: () => revision,
      sync: () => response.promise,
    });
    revision = 3;
    response.resolve({
      snapshot: { revision: 2, commandCount: 1 },
      commands: [{ commandId: 'stale' }],
    });
    expect(await pending).toBeNull();
    expect(sync.commands).toEqual([]);
  });

  it('reuses a command id after an uncertain submission and releases it after a receipt', async () => {
    const actions = new RoomActions();
    const ids: string[] = [];
    let next = 0;
    const base = {
      payload: { kind: 'ready' },
      current: () => true,
      newCommandId: () => `cmd-${String(++next)}`,
      build: (commandId: string) => ({ commandId }),
      sync: () => Promise.resolve(),
      rejectedLabel: 'rejected',
    };
    await actions
      .submit({
        ...base,
        submit: (command) => {
          ids.push(command.commandId);
          return Promise.reject(new Error('connection lost'));
        },
      })
      .catch(() => {});
    await actions.submit({
      ...base,
      submit: (command) => {
        ids.push(command.commandId);
        return Promise.resolve({ accepted: true });
      },
    });
    await actions.submit({
      ...base,
      submit: (command) => {
        ids.push(command.commandId);
        return Promise.resolve({ accepted: true });
      },
    });
    expect(ids).toEqual(['cmd-1', 'cmd-1', 'cmd-2']);
  });

  it('retries failed log persistence without moving the durable cursor', async () => {
    const sync = new RoomSynchronization<
      { revision: number; commandCount: number },
      { commandId: string; ordinal: number }
    >();
    await sync.fetch({
      current: () => true,
      revision: () => 0,
      ordinalOf: (c) => c.ordinal,
      sync: () =>
        Promise.resolve({
          snapshot: { revision: 1, commandCount: 1 },
          commands: [{ commandId: 'cmd-1', ordinal: 0 }],
        }),
    });
    await sync
      .persist(
        () => true,
        () => Promise.reject(new Error('storage unavailable')),
      )
      .catch(() => {});
    expect(sync.persistedCount).toBe(0);
    const persisted: string[] = [];
    await sync.persist(
      () => true,
      (commands) => {
        persisted.push(...commands.map((c) => c.commandId));
        return Promise.resolve();
      },
    );
    expect(persisted).toEqual(['cmd-1']);
    expect(sync.persistedCount).toBe(1);
  });

  it('discards an old room sync after reset and keeps the new room log', async () => {
    type Response = {
      snapshot: { revision: number; commandCount: number };
      commands: Array<{ commandId: string }>;
    };
    const sync = new RoomSynchronization<Response['snapshot'], { commandId: string }>();
    const pending = deferred<Response>();
    const old = sync.fetch({ current: () => true, revision: () => 0, sync: () => pending.promise });
    sync.reset();
    await sync.fetch({
      current: () => true,
      revision: () => 0,
      sync: () =>
        Promise.resolve({
          snapshot: { revision: 1, commandCount: 1 },
          commands: [{ commandId: 'new' }],
        }),
    });
    pending.resolve({
      snapshot: { revision: 2, commandCount: 1 },
      commands: [{ commandId: 'old' }],
    });
    expect(await old).toBeNull();
    expect(sync.commands.map((c) => c.commandId)).toEqual(['new']);
  });

  it('keeps deadline retries and in-flight recovery scoped to their room', async () => {
    const recovery = new DeadlineRecovery();
    const commit = deferred<undefined>();
    let current = true;
    let resolved = 0;
    const old = recovery.resolve({
      cursor: 'old',
      current: () => current,
      now: () => 0,
      retryMs: 100,
      commit: () => commit.promise,
      resolveTimeout: () => {
        resolved += 1;
        return Promise.resolve({ accepted: true });
      },
      sync: () => Promise.resolve(),
    });
    expect(recovery.due('old', 0)).toBe(false);
    current = false;
    recovery.reset();
    commit.resolve(undefined);
    await old;
    expect(resolved).toBe(0);
    expect(recovery.due('new', 0)).toBe(true);
    await recovery.resolve({
      cursor: 'new',
      current: () => true,
      now: () => 0,
      retryMs: 100,
      commit: () => Promise.reject(new Error('offline')),
      resolveTimeout: () => Promise.resolve(null),
      sync: () => Promise.resolve(),
    });
    expect(recovery.due('new', 99)).toBe(false);
    expect(recovery.due('new', 100)).toBe(true);
  });
});
