import { expect, test } from 'bun:test';
import type {
  CapRushMultiplayerCommand,
  CapRushMultiplayerCommandPayload,
  CapRushMultiplayerSeatId,
  CapRushMultiplayerState,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
  CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
  capRushMultiplayerWorkerMessageSchema,
  commandIdSchema,
  idSchema,
} from '@hoop-rush/data-contracts';
import {
  applyCapRushMultiplayerCommand,
  capRushMultiplayerLockDigest,
  capRushMultiplayerStateDigest,
  createCapRushMultiplayerState,
  createEngineContext,
  simulateCapRushMultiplayerSlot,
} from '@hoop-rush/engine';
import { capRushTestSetup } from '../../../../../../packages/engine/src/modes/cap-rush/cap-rush-test-support.ts';
import {
  capRushTestDate,
  capRushTestEnvironment,
  capRushTestRootSeed,
} from '../../../../../../packages/engine/src/modes/cap-rush/multiplayer/shared-league.test-support.ts';
import {
  applyCapRushMultiplayerStatePatch,
  createCapRushMultiplayerStatePatch,
} from './cap-rush-multiplayer-patch';

function seasonHarness() {
  const setup = capRushTestSetup();
  const environment = capRushTestEnvironment(setup);
  const context = createEngineContext();
  let state = createCapRushMultiplayerState(capRushTestRootSeed());
  let ordinal = 0;
  let clock = capRushTestDate();
  const at = (): string => new Date(clock).toISOString();

  const run = (
    actor: CapRushMultiplayerSeatId,
    payload: CapRushMultiplayerCommandPayload,
    acceptedAtIso = at(),
  ): CapRushMultiplayerState => {
    const command: CapRushMultiplayerCommand = {
      schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
      roomId: idSchema.parse('room-patch'),
      commandId: commandIdSchema.parse(`patch-${String(ordinal)}`),
      ordinal,
      actorParticipantId: actor,
      expectedRevision: ordinal,
      acceptedAtIso,
      payload,
    };
    ordinal += 1;
    const outcome = applyCapRushMultiplayerCommand(state, command, environment);
    if (!outcome.ok) throw new Error(`${payload.kind} rejected: ${outcome.message}`);
    state = outcome.state;
    return state;
  };

  run('p1', { kind: 'start' });
  for (let round = 0; round < 5; round += 1) {
    clock += 61_000;
    run('p1', { kind: 'close-due-auctions', round }, at());
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
    context,
    run,
    get state() {
      return state;
    },
  };
}

test('ACK patches omit locked inputs and prior game history and reconstruct the digest', () => {
  const harness = seasonHarness();
  const before = harness.state;
  const game = before.season?.games[0];
  if (game === undefined) throw new Error('no accepted game');
  const after = harness.run('p1', {
    kind: 'ack-broadcast',
    gameId: game.gameId,
    cursor: 2,
    total: 8,
    resolved: false,
  });
  const patch = createCapRushMultiplayerStatePatch(before, after);
  const patchJson = JSON.stringify(patch);
  expect(patch.fields?.locked).toBeUndefined();
  expect(patch.fields?.recruitment).toBeUndefined();
  expect(patch.season?.games).toBeUndefined();
  expect(patchJson).not.toContain('leagueSchedule');
  expect(patchJson).not.toContain('inputDigest');
  expect(patchJson.length).toBeLessThan(2_000);
  const reconstructed = applyCapRushMultiplayerStatePatch(before, patch);
  expect(reconstructed).toEqual(after);
  expect(capRushMultiplayerStateDigest(reconstructed)).toBe(capRushMultiplayerStateDigest(after));

  const afterAgain = harness.run('p1', {
    kind: 'ack-broadcast',
    gameId: game.gameId,
    cursor: 3,
    total: 8,
    resolved: false,
  });
  const replacePatch = createCapRushMultiplayerStatePatch(after, afterAgain);
  expect(replacePatch.season?.playbackAcks).toMatchObject({ mode: 'replace' });
  expect(
    capRushMultiplayerStateDigest(applyCapRushMultiplayerStatePatch(after, replacePatch)),
  ).toBe(capRushMultiplayerStateDigest(afterAgain));
});

test('accepted slot patches append only the new games instead of resending the season', () => {
  const harness = seasonHarness();
  const before = harness.state;
  const locked = before.locked;
  if (locked === null) throw new Error('missing locked inputs');
  const simulated = simulateCapRushMultiplayerSlot({
    locked,
    slot: 2,
    context: harness.context,
  });
  const after = harness.run('p1', {
    kind: 'accept-slot',
    slot: 2,
    games: simulated.games,
  });
  const patch = createCapRushMultiplayerStatePatch(before, after);
  const patchJson = JSON.stringify(patch);
  expect(patch.season?.games).toMatchObject({ mode: 'append' });
  expect(patch.season?.games?.values).toHaveLength(simulated.games.length);
  expect(patch.fields?.locked).toBeUndefined();
  expect(patchJson.length).toBeLessThan(JSON.stringify(after).length / 10);
  const reconstructed = applyCapRushMultiplayerStatePatch(before, patch);
  expect(capRushMultiplayerStateDigest(reconstructed)).toBe(capRushMultiplayerStateDigest(after));
});

test('a divergent replace patch is validated against the exact result digest', () => {
  const harness = seasonHarness();
  const before = harness.state;
  const after = harness.run('p1', { kind: 'leave' });
  const patch = createCapRushMultiplayerStatePatch(before, after);
  const reconstructed = applyCapRushMultiplayerStatePatch(before, patch);
  expect(patch.fields?.phase).toBe('expired');
  expect(capRushMultiplayerStateDigest(reconstructed)).toBe(capRushMultiplayerStateDigest(after));
  const mismatched = applyCapRushMultiplayerStatePatch(before, {
    ...patch,
    fields: { ...patch.fields, phase: 'postseason' },
  });
  expect(capRushMultiplayerStateDigest(mismatched)).not.toBe(capRushMultiplayerStateDigest(after));
});

test('the worker wire schema requires one projection form and binds patches to a base digest', () => {
  const state = createCapRushMultiplayerState(capRushTestRootSeed());
  const response = {
    schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
    kind: 'cap-rush-multiplayer-projection',
    requestId: 'wire-patch',
    patch: {},
    baseDigest: capRushMultiplayerStateDigest(state),
    stateDigest: capRushMultiplayerStateDigest(state),
  };
  expect(capRushMultiplayerWorkerMessageSchema.safeParse(response).success).toBe(true);
  expect(
    capRushMultiplayerWorkerMessageSchema.safeParse({ ...response, baseDigest: undefined }).success,
  ).toBe(false);
  expect(capRushMultiplayerWorkerMessageSchema.safeParse({ ...response, state }).success).toBe(
    false,
  );
  expect(
    capRushMultiplayerWorkerMessageSchema.safeParse({
      schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
      kind: 'cap-rush-multiplayer-projection',
      requestId: 'wire-snapshot',
      state,
      stateDigest: capRushMultiplayerStateDigest(state),
    }).success,
  ).toBe(true);
});
