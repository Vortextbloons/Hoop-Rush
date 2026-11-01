import { expect, test } from 'bun:test';
import {
  capRushMultiplayerCommandSchema,
  type CapRushMultiplayerCommandPayload,
} from '@hoop-rush/data-contracts';
import {
  createEngineContext,
  simulateCapRushMultiplayerSlot,
  applyCapRushMultiplayerCommand,
  createCapRushMultiplayerState,
} from '@hoop-rush/engine';
import { capRushTestSetup } from '../../../../../../packages/engine/src/modes/cap-rush/cap-rush-test-support.ts';
import {
  capRushTestEnvironment,
  capRushTestRootSeed,
  capRushTestDate,
} from '../../../../../../packages/engine/src/modes/cap-rush/multiplayer/shared-league.test-support.ts';
import { CapRushMultiplayerRunner } from './cap-rush-multiplayer-runner';

function league() {
  const environment = capRushTestEnvironment(capRushTestSetup());
  const rootSeed = capRushTestRootSeed();
  let state = createCapRushMultiplayerState(rootSeed);
  let ordinal = 0;
  let clock = capRushTestDate();
  const run = (payload: CapRushMultiplayerCommandPayload) => {
    const command = capRushMultiplayerCommandSchema.parse({
      schemaVersion: state.schemaVersion,
      roomId: 'room-test',
      commandId: `cmd-${String(ordinal)}`,
      ordinal,
      actorParticipantId: 'p1',
      expectedRevision: ordinal,
      acceptedAtIso: new Date(clock).toISOString(),
      payload,
    });
    const outcome = applyCapRushMultiplayerCommand(state, command, environment);
    if (!outcome.ok) throw new Error(outcome.message);
    state = outcome.state;
    ordinal += 1;
  };
  run({ kind: 'start' });
  for (let round = 0; round < 5; round += 1) {
    clock += 61_000;
    run({ kind: 'close-due-auctions', round });
  }
  if (state.locked === null) throw new Error('missing locked league');
  return { locked: state.locked };
}

test('splits ranges into ordered workers and disposes pending work', async () => {
  const workers: {
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    posted: Record<string, unknown>[];
    terminated: boolean;
    postMessage(message: Record<string, unknown>): void;
    terminate(): void;
  }[] = [];
  const createWorker = () => {
    const worker = {
      onmessage: null,
      onerror: null,
      posted: [] as Record<string, unknown>[],
      terminated: false,
      postMessage(message: Record<string, unknown>) {
        this.posted.push(message);
      },
      terminate() {
        this.terminated = true;
      },
    };
    workers.push(worker);
    return worker as unknown as Worker;
  };
  const runner = new CapRushMultiplayerRunner({ createWorker, parallelism: 2 });
  try {
    const input = { roomId: 'room-test', locked: league().locked, slot: 1, throughSlot: 5 };
    const games = simulateCapRushMultiplayerSlot({
      locked: input.locked,
      slot: 1,
      context: createEngineContext(),
    }).games;
    const pending = runner.simulateSlot(input);
    expect(
      workers.map((worker) => [worker.posted[0]?.slot, worker.posted[0]?.throughSlot]),
    ).toEqual([
      [1, 3],
      [4, 5],
    ]);
    const respond = (index: number) => {
      const worker = workers[index];
      const request = worker?.posted[0];
      if (worker === undefined || request === undefined) throw new Error('missing worker request');
      worker.onmessage?.({
        data: {
          schemaVersion: request.schemaVersion,
          requestId: request.requestId,
          kind: 'cap-rush-multiplayer-slot',
          slot: request.slot,
          games,
          tapes: [{ gameId: `game-${String(index)}`, tape: index }],
        },
      } as MessageEvent);
    };
    respond(1);
    respond(0);
    expect((await pending).tapes.map((entry) => entry.gameId)).toEqual(['game-0', 'game-1']);
    const next = runner.simulateSlot(input);
    const rejected = next.catch((error: unknown) => error);
    runner.dispose();
    expect(await rejected).toBeInstanceOf(Error);
    expect(workers.every((worker) => worker.terminated)).toBe(true);
  } finally {
    runner.dispose();
  }
});
