import { afterAll, beforeAll, expect, test } from 'bun:test';
import type {
  CapRushMultiplayerCommand,
  CapRushMultiplayerCommandPayload,
  CapRushMultiplayerSeatId,
  CapRushMultiplayerState,
  CapRushMultiplayerWorkerMessage,
  CapRushMultiplayerWorkerRequest,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
  commandIdSchema,
  idSchema,
} from '@hoop-rush/data-contracts';
import {
  applyCapRushMultiplayerCommand,
  capRushMultiplayerLockDigest,
  capRushMultiplayerStateDigest,
  createCapRushMultiplayerState,
} from '@hoop-rush/engine';
import { capRushTestSetup } from '../../../../packages/engine/src/modes/cap-rush/cap-rush-test-support.ts';
import {
  capRushTestDate,
  capRushTestEnvironment,
  capRushTestRootSeed,
} from '../../../../packages/engine/src/modes/cap-rush/multiplayer/shared-league.test-support.ts';
import { CapRushMultiplayerRunner } from '../lib/features/cap-rush-multiplayer/cap-rush-multiplayer-runner';

interface FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(value: unknown): void;
  terminate(): void;
}

const originalSelf = (globalThis as { self?: unknown }).self;
const fakeSelf = {
  postMessage: (() => {}) as (message: unknown) => void,
  onmessage: null as ((event: { data: unknown }) => void) | null,
};
const requests: CapRushMultiplayerWorkerRequest[] = [];
const responses: CapRushMultiplayerWorkerMessage[] = [];
let activeWorker: FakeWorker | null = null;

beforeAll(async () => {
  (globalThis as { self?: unknown }).self = fakeSelf;
  await import('./cap-rush-multiplayer-worker.ts');
});

afterAll(() => {
  if (originalSelf === undefined) delete (globalThis as { self?: unknown }).self;
  else (globalThis as { self?: unknown }).self = originalSelf;
});

function createWorker(): Worker {
  const worker: FakeWorker = {
    onmessage: null,
    onerror: null,
    postMessage(value) {
      requests.push(structuredClone(value) as CapRushMultiplayerWorkerRequest);
      fakeSelf.onmessage?.({ data: structuredClone(value) });
    },
    terminate() {
      worker.onmessage = null;
    },
  };
  activeWorker = worker;
  fakeSelf.postMessage = (message) => {
    responses.push(structuredClone(message) as CapRushMultiplayerWorkerMessage);
    activeWorker?.onmessage?.({ data: structuredClone(message) } as MessageEvent<unknown>);
  };
  return worker as unknown as Worker;
}

interface Harness {
  environment: ReturnType<typeof capRushTestEnvironment>;
  state: CapRushMultiplayerState;
  run: (
    actor: CapRushMultiplayerSeatId,
    payload: CapRushMultiplayerCommandPayload,
  ) => CapRushMultiplayerState;
}

function seasonHarness(): Harness {
  const setup = capRushTestSetup();
  const engineEnvironment = capRushTestEnvironment(setup);
  // The worker wire schema requires one candidate identity per player; the engine fixture expands
  // candidates per opponent, which is valid for local commands but fails that catalog contract.
  const environment = { ...engineEnvironment, seasonCatalog: setup.catalog };
  let state = createCapRushMultiplayerState(capRushTestRootSeed());
  let ordinal = 0;
  let clock = capRushTestDate();
  const run = (
    actor: CapRushMultiplayerSeatId,
    payload: CapRushMultiplayerCommandPayload,
  ): CapRushMultiplayerState => {
    const command: CapRushMultiplayerCommand = {
      schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
      roomId: idSchema.parse('room-worker-boundary'),
      commandId: commandIdSchema.parse(`worker-boundary-${String(ordinal)}`),
      ordinal,
      actorParticipantId: actor,
      expectedRevision: ordinal,
      acceptedAtIso: new Date(clock).toISOString(),
      payload,
    };
    ordinal += 1;
    const outcome = applyCapRushMultiplayerCommand(state, command, engineEnvironment);
    if (!outcome.ok) throw new Error(`${payload.kind} rejected: ${outcome.message}`);
    state = outcome.state;
    return state;
  };
  run('p1', { kind: 'start' });
  for (let round = 0; round < 5; round += 1) {
    clock += 61_000;
    run('p1', { kind: 'close-due-auctions', round });
  }
  const lockDigest = capRushMultiplayerLockDigest(state);
  if (lockDigest === null) throw new Error('no lock digest');
  run('p1', { kind: 'confirm-lock', stateDigest: lockDigest });
  run('p2', { kind: 'confirm-lock', stateDigest: lockDigest });
  const block = state.season?.block;
  if (block === undefined) throw new Error('no season block');
  run('p1', { kind: 'choose-block-plan', block: block.index, choice: 'sim' });
  run('p2', { kind: 'choose-block-plan', block: block.index, choice: 'sim' });
  run('p1', { kind: 'simulate-range', slot: 1, throughSlot: 1 });
  return {
    environment,
    get state() {
      return state;
    },
    run,
  };
}

test('the real worker sends a compact season patch for a warm ACK command', async () => {
  const harness = seasonHarness();
  const runner = new CapRushMultiplayerRunner({ createWorker });
  try {
    const primed = await runner.projectDetailed({
      state: harness.state,
      commands: [],
      environment: harness.environment,
      variant: harness.environment.variant,
    });
    const game = primed.state.season?.games[0];
    if (game === undefined) throw new Error('no accepted game');
    const command: CapRushMultiplayerCommand = {
      schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
      roomId: idSchema.parse('room-worker-boundary'),
      commandId: commandIdSchema.parse('worker-ack'),
      ordinal: 1_000,
      actorParticipantId: 'p1',
      expectedRevision: 1_000,
      acceptedAtIso: new Date(capRushTestDate()).toISOString(),
      payload: {
        kind: 'ack-broadcast',
        gameId: game.gameId,
        cursor: 2,
        total: 8,
        resolved: false,
      },
    };
    const expected = applyCapRushMultiplayerCommand(primed.state, command, harness.environment);
    if (!expected.ok) throw new Error(expected.message);
    const expectedDigest = capRushMultiplayerStateDigest(expected.state);
    requests.length = 0;
    responses.length = 0;
    const result = await runner.projectDetailed({
      state: primed.state,
      commands: [command],
      environment: harness.environment,
      variant: harness.environment.variant,
      baseDigest: primed.stateDigest,
    });
    expect(result.stateDigest).toBe(expectedDigest);
    expect(result.state.locked).toBe(primed.state.locked);
    expect(result.state.season?.games).toBe(primed.state.season?.games);
    expect(capRushMultiplayerStateDigest(result.state)).toBe(expectedDigest);
    const request = requests.find(
      (entry) => entry.kind === 'cap-rush-multiplayer-project',
    ) as Extract<CapRushMultiplayerWorkerRequest, { kind: 'cap-rush-multiplayer-project' }>;
    const response = responses.find(
      (entry) => entry.kind === 'cap-rush-multiplayer-projection',
    ) as Extract<CapRushMultiplayerWorkerMessage, { kind: 'cap-rush-multiplayer-projection' }>;
    expect(request.state).toBeUndefined();
    expect(request.baseDigest).toBe(primed.stateDigest);
    expect(request.response).toBe('patch');
    expect(response.state).toBeUndefined();
    expect(response.baseDigest).toBe(primed.stateDigest);
    expect(response.patch).toBeDefined();
    const responseBytes = JSON.stringify(response).length;
    const stateBytes = JSON.stringify(expected.state).length;
    expect(responseBytes).toBeLessThan(stateBytes / 50);
    expect(JSON.stringify(response)).not.toContain('leagueSchedule');
    expect(JSON.stringify(response)).not.toContain('inputDigest');
  } finally {
    runner.dispose();
  }
}, 120_000);

test('a stranded base in a restarted worker falls back to a validated full snapshot', async () => {
  const harness = seasonHarness();
  let projectRequests = 0;
  const failingWorker = (): Worker => {
    const worker: FakeWorker = {
      onmessage: null,
      onerror: null,
      postMessage(value) {
        const request = structuredClone(value) as CapRushMultiplayerWorkerRequest;
        requests.push(request);
        if (request.kind === 'cap-rush-multiplayer-hydrate') {
          fakeSelf.onmessage?.({ data: request });
          return;
        }
        if (request.kind === 'cap-rush-multiplayer-project') {
          projectRequests += 1;
          if (projectRequests === 1) {
            worker.onerror?.({} as ErrorEvent);
            return;
          }
        }
        fakeSelf.onmessage?.({ data: request });
      },
      terminate() {
        worker.onmessage = null;
      },
    };
    activeWorker = worker;
    fakeSelf.postMessage = (message) => {
      responses.push(structuredClone(message) as CapRushMultiplayerWorkerMessage);
      activeWorker?.onmessage?.({ data: structuredClone(message) } as MessageEvent<unknown>);
    };
    return worker as unknown as Worker;
  };
  requests.length = 0;
  responses.length = 0;
  const runner = new CapRushMultiplayerRunner({ createWorker: failingWorker });
  try {
    const result = await runner.projectDetailed({
      state: harness.state,
      commands: [],
      environment: harness.environment,
      variant: harness.environment.variant,
      baseDigest: capRushMultiplayerStateDigest(harness.state),
    });
    expect(result.stateDigest).toBe(capRushMultiplayerStateDigest(harness.state));
    expect(projectRequests).toBe(2);
    const lastRequest = requests.at(-1) as Extract<
      CapRushMultiplayerWorkerRequest,
      { kind: 'cap-rush-multiplayer-project' }
    >;
    expect(lastRequest.response).toBe('snapshot');
    expect(lastRequest.state).toEqual(harness.state);
    const response = responses.at(-1) as Extract<
      CapRushMultiplayerWorkerMessage,
      { kind: 'cap-rush-multiplayer-projection' }
    >;
    expect(response.state).toBeDefined();
    expect(response.patch).toBeUndefined();
  } finally {
    runner.dispose();
  }
}, 120_000);

test('a rejected command leaves the worker cache intact for the next patch', async () => {
  const harness = seasonHarness();
  const runner = new CapRushMultiplayerRunner({ createWorker });
  try {
    const primed = await runner.projectDetailed({
      state: harness.state,
      commands: [],
      environment: harness.environment,
      variant: harness.environment.variant,
    });
    const rejected = await runner
      .projectDetailed({
        state: primed.state,
        commands: [
          {
            schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
            roomId: idSchema.parse('room-worker-boundary'),
            commandId: commandIdSchema.parse('worker-rejected'),
            ordinal: 1_001,
            actorParticipantId: 'p1',
            expectedRevision: 1_001,
            acceptedAtIso: new Date(capRushTestDate()).toISOString(),
            payload: { kind: 'ready', ready: true },
          },
        ],
        environment: harness.environment,
        variant: harness.environment.variant,
        baseDigest: primed.stateDigest,
      })
      .catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(Error);
    expect(String(rejected)).toContain('readiness is only available in the lobby');

    const game = primed.state.season?.games[0];
    if (game === undefined) throw new Error('no accepted game');
    const ack: CapRushMultiplayerCommand = {
      schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
      roomId: idSchema.parse('room-worker-boundary'),
      commandId: commandIdSchema.parse('worker-ack-after-rejection'),
      ordinal: 1_002,
      actorParticipantId: 'p1',
      expectedRevision: 1_002,
      acceptedAtIso: new Date(capRushTestDate()).toISOString(),
      payload: {
        kind: 'ack-broadcast',
        gameId: game.gameId,
        cursor: 3,
        total: 8,
        resolved: false,
      },
    };
    const accepted = await runner.projectDetailed({
      state: primed.state,
      commands: [ack],
      environment: harness.environment,
      variant: harness.environment.variant,
      baseDigest: primed.stateDigest,
    });
    expect(accepted.stateDigest).not.toBe(primed.stateDigest);
  } finally {
    runner.dispose();
  }
}, 120_000);

test('replay verification returns an authoritative full snapshot', async () => {
  const harness = seasonHarness();
  const runner = new CapRushMultiplayerRunner({ createWorker });
  const rootSeed = capRushTestRootSeed();
  const command: CapRushMultiplayerCommand = {
    schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
    roomId: idSchema.parse('room-worker-boundary'),
    commandId: commandIdSchema.parse('worker-replay-ready'),
    ordinal: 0,
    actorParticipantId: 'p1',
    expectedRevision: 0,
    acceptedAtIso: new Date(capRushTestDate()).toISOString(),
    payload: { kind: 'ready', ready: true },
  };
  const expected = applyCapRushMultiplayerCommand(
    createCapRushMultiplayerState(rootSeed),
    command,
    harness.environment,
  );
  if (!expected.ok) throw new Error(expected.message);
  try {
    responses.length = 0;
    const digest = await runner.verifyLog({
      rootSeed,
      commands: [command],
      environment: harness.environment,
      variant: harness.environment.variant,
    });
    expect(digest).toBe(capRushMultiplayerStateDigest(expected.state));
    const response = responses.at(-1) as Extract<
      CapRushMultiplayerWorkerMessage,
      { kind: 'cap-rush-multiplayer-projection' }
    >;
    expect(response.state).toBeDefined();
    expect(response.patch).toBeUndefined();
  } finally {
    runner.dispose();
  }
}, 120_000);
