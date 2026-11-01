import { describe, expect, it } from 'bun:test';
import { GameExecution } from './game-execution.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('GameExecution', () => {
  it('publishes an output only after persistence and suppresses concurrent simulation', async () => {
    const execution = new GameExecution<{ gameNumber: number }>();
    const save = deferred<undefined>();
    let simulations = 0;
    const input = {
      gameNumber: 1,
      current: () => true,
      simulate: () => {
        simulations += 1;
        return Promise.resolve({ gameNumber: 1 });
      },
      persist: () => save.promise,
    };
    const pending = execution.run(input);
    await Promise.resolve(undefined);
    expect(execution.getOutputs()[1]).toBeUndefined();
    expect(await execution.run(input)).toBe('idle');
    expect(simulations).toBe(1);
    save.resolve(undefined);
    expect(await pending).toBe('saved');
    expect(execution.getOutputs()[1]).toEqual({ gameNumber: 1 });
  });

  it('keeps a failed save unavailable for proposals and permits a retry', async () => {
    const execution = new GameExecution<{ gameNumber: number }>();
    let fail = true;
    const input = {
      gameNumber: 1,
      current: () => true,
      simulate: () => Promise.resolve({ gameNumber: 1 }),
      persist: () => (fail ? Promise.reject(new Error('disk full')) : Promise.resolve()),
    };
    let error: unknown;
    try {
      await execution.run(input);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(execution.getOutputs()[1]).toBeUndefined();
    fail = false;
    expect(await execution.run(input)).toBe('saved');
  });

  it('abandons a saved output from a detached room without disturbing a new job', async () => {
    const execution = new GameExecution<{ gameNumber: number; room: string }>();
    const oldSave = deferred<undefined>();
    let current = true;
    const old = execution.run({
      gameNumber: 1,
      current: () => current,
      simulate: () => Promise.resolve({ gameNumber: 1, room: 'old' }),
      persist: () => oldSave.promise,
    });
    await Promise.resolve(undefined);
    current = false;
    execution.reset();
    const nextSave = deferred<undefined>();
    const input = {
      gameNumber: 1,
      current: () => true,
      simulate: () => Promise.resolve({ gameNumber: 1, room: 'new' }),
      persist: () => nextSave.promise,
    };
    const next = execution.run(input);
    oldSave.resolve(undefined);
    expect(await old).toBe('abandoned');
    expect(await execution.run(input)).toBe('idle');
    nextSave.resolve(undefined);
    expect(await next).toBe('saved');
    expect(execution.getOutputs()[1]?.room).toBe('new');
  });
});
