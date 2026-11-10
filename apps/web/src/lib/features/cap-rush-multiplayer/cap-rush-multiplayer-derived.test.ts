import { describe, expect, test } from 'bun:test';
import { createEngineContext, simulateCapRushMultiplayerSlot } from '@hoop-rush/engine';
import { capRushTestSetup } from '../../../../../../packages/engine/src/modes/cap-rush/cap-rush-test-support.ts';
import {
  capRushTestDate,
  capRushTestEnvironment,
  capRushTestRootSeed,
} from '../../../../../../packages/engine/src/modes/cap-rush/multiplayer/shared-league.test-support.ts';
import { applyCapRushMultiplayerCommand, createCapRushMultiplayerState } from '@hoop-rush/engine';
import { capRushMultiplayerCommandSchema } from '@hoop-rush/data-contracts';
import type { CapRushMultiplayerCommandPayload } from '@hoop-rush/data-contracts';
import {
  capRushMultiplayerPlayerAverages,
  capRushMultiplayerSeasonWindow,
} from './cap-rush-multiplayer-derived';

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
  return state.locked;
}

describe('cap rush multiplayer derived season data', () => {
  test('shares a window and player averages across repeated seat renders', () => {
    const locked = league();
    const context = createEngineContext();
    const games = [
      ...simulateCapRushMultiplayerSlot({ locked, slot: 1, context }).games,
      ...simulateCapRushMultiplayerSlot({ locked, slot: 2, context }).games,
    ];
    const first = capRushMultiplayerSeasonWindow(locked, games, 1);
    const second = capRushMultiplayerSeasonWindow(locked, games, 1);
    expect(second).toBe(first);
    expect(first.throughSlot).toBe(1);
    expect(first.games.every((game) => game.slot <= 1)).toBe(true);
    expect(first.records.p1.played + first.records.p2.played).toBeGreaterThan(0);
    // Standings intentionally stay locked until the conference results are complete.
    expect(first.standings).toBeNull();

    const full = capRushMultiplayerSeasonWindow(locked, games, 2);
    expect(full.throughSlot).toBe(2);
    expect(full.games).toHaveLength(games.length);
    expect(full.games).toBe(games);
    expect(full.records.p1.played).toBeGreaterThanOrEqual(first.records.p1.played);

    const averages = capRushMultiplayerPlayerAverages(games);
    expect(capRushMultiplayerPlayerAverages(games)).toBe(averages);
    const player = games[0]?.box.home.participants[0];
    if (player === undefined) throw new Error('missing participant');
    expect(averages.get(player.playerId)?.games).toBeGreaterThan(0);
  });
});
