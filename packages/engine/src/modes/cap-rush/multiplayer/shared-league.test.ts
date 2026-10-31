import { describe, expect, test } from 'bun:test';
import type {
  CapRushMultiplayerCommand,
  CapRushMultiplayerCommandPayload,
  CapRushMultiplayerSeatId,
  CapRushMultiplayerState,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
  commandIdSchema,
  idSchema,
} from '@hoop-rush/data-contracts';
import { capRushTestSetup } from '../cap-rush-test-support.ts';
import { createEngineContext } from '../../../sim/kernel.ts';
import {
  applyCapRushMultiplayerCommand,
  capRushMultiplayerLockDigest,
  capRushMultiplayerStateDigest,
  createCapRushMultiplayerState,
  type CapRushMultiplayerEnvironment,
} from './state.ts';
import { replayCapRushMultiplayerLog } from './replay.ts';
import { capRushMultiplayerAcceptedThrough, simulateCapRushMultiplayerSlot } from './league.ts';
import {
  capRushMultiplayerCurrentRound,
  capRushMultiplayerPlayoffPlans,
  simulateCapRushMultiplayerPlayoffGame,
} from './postseason.ts';
import {
  capRushTestDate,
  capRushTestEnvironment,
  capRushTestRootSeed,
} from './shared-league.test-support.ts';

describe('cap rush multiplayer shared league', () => {
  test('runs recruitment, a full season with two head-to-head games, the playoffs, and a report', () => {
    const setup = capRushTestSetup();
    const environment: CapRushMultiplayerEnvironment = capRushTestEnvironment(setup);
    const rootSeed = capRushTestRootSeed();
    let state = createCapRushMultiplayerState(rootSeed);
    const commands: CapRushMultiplayerCommand[] = [];
    let ordinal = 0;
    let clock = capRushTestDate();

    const at = (): string => new Date(clock).toISOString();
    const advance = (ms: number): string => {
      clock += ms;
      return at();
    };
    const run = (
      actor: CapRushMultiplayerSeatId,
      payload: CapRushMultiplayerCommandPayload,
      acceptedAtIso = at(),
    ): CapRushMultiplayerState => {
      const command: CapRushMultiplayerCommand = {
        schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
        roomId: idSchema.parse('room-test'),
        commandId: commandIdSchema.parse(`cmd-${String(ordinal)}`),
        ordinal,
        actorParticipantId: actor,
        expectedRevision: ordinal,
        acceptedAtIso,
        payload,
      };
      ordinal += 1;
      commands.push(command);
      const outcome = applyCapRushMultiplayerCommand(state, command, environment);
      if (!outcome.ok) {
        throw new Error(`${payload.kind} rejected (${outcome.code}): ${outcome.message}`);
      }
      state = outcome.state;
      return state;
    };

    run('p1', { kind: 'start' });
    expect(state.phase).toBe('recruiting');
    expect(state.recruitment?.market.players).toHaveLength(60);

    for (let round = 0; round < 5; round += 1) {
      const closeAt = advance(61_000);
      run('p1', { kind: 'close-due-auctions', round }, closeAt);
    }
    expect(state.phase).toBe('preparation');
    expect(state.locked).not.toBeNull();
    expect(state.locked?.seats.p1.picks).toHaveLength(5);
    expect(state.locked?.seats.p2.picks).toHaveLength(5);
    expect(state.locked?.leagueSchedule).toHaveLength(1230);
    expect(state.locked?.opponents).toHaveLength(28);

    run('p1', { kind: 'skip-mutation' });
    run('p2', { kind: 'skip-mutation' });
    const lockDigest = capRushMultiplayerLockDigest(state);
    if (lockDigest === null) throw new Error('no lock digest');
    run('p1', { kind: 'confirm-lock', stateDigest: lockDigest });
    expect(state.phase).toBe('locking');
    run('p2', { kind: 'confirm-lock', stateDigest: lockDigest });
    expect(state.phase).toBe('season');
    expect(state.season?.h2hSlots).toHaveLength(2);

    const context = createEngineContext();
    const h2hSlots = new Set(state.season?.h2hSlots ?? []);
    expect(h2hSlots.size).toBe(2);

    for (let block = 0; block < 4; block += 1) {
      const season = state.season;
      if (season === null) throw new Error('no season');
      run('p1', { kind: 'choose-block-plan', block: season.block.index, choice: 'sim' });
      run('p2', { kind: 'choose-block-plan', block: season.block.index, choice: 'sim' });
      const accepted = capRushMultiplayerAcceptedThrough(state.season?.games ?? []);
      for (let slot = accepted + 1; slot <= season.block.endpoint; slot += 1) {
        const simulated = simulateCapRushMultiplayerSlot({
          locked: state.locked as NonNullable<CapRushMultiplayerState['locked']>,
          slot,
          context,
        });
        run('p1', { kind: 'accept-slot', slot, games: simulated.games });
        if (h2hSlots.has(slot)) {
          const locked = state.locked as NonNullable<CapRushMultiplayerState['locked']>;
          const ids = new Set([
            locked.seats.p1.franchise.franchiseId,
            locked.seats.p2.franchise.franchiseId,
          ]);
          const game = state.season?.games.find(
            (entry) =>
              entry.slot === slot && ids.has(entry.homeTeamId) && ids.has(entry.awayTeamId),
          );
          if (game === undefined) throw new Error('no head-to-head game');
          for (const seat of ['p1', 'p2'] as const) {
            run(seat, {
              kind: 'ack-broadcast',
              gameId: game.gameId,
              cursor: 1,
              total: 1,
              resolved: true,
            });
          }
        }
        run('p1', { kind: 'ack-slot', slot });
        run('p2', { kind: 'ack-slot', slot });
      }
      expect(state.season?.games).toHaveLength(season.block.endpoint * 15);
    }
    expect(state.phase).toBe('postseason');
    expect(state.season?.games).toHaveLength(1230);
    expect(state.postseason?.series).toHaveLength(8);

    let guard = 0;
    while (state.phase === 'postseason' && state.postseason?.championTeamId === null) {
      guard += 1;
      if (guard > 40) throw new Error('playoffs did not finish');
      const postseason = state.postseason;
      const round = capRushMultiplayerCurrentRound(postseason);
      const plans = capRushMultiplayerPlayoffPlans({
        locked: state.locked as NonNullable<CapRushMultiplayerState['locked']>,
        state: postseason,
      });
      if (plans.length === 0) throw new Error('no playoff games to play');
      run('p1', { kind: 'choose-playoff-plan', round, choice: 'sim' });
      run('p2', { kind: 'choose-playoff-plan', round, choice: 'sim' });
      const games = plans.map(
        (entry) =>
          simulateCapRushMultiplayerPlayoffGame({
            locked: state.locked as NonNullable<CapRushMultiplayerState['locked']>,
            plan: entry.plan,
            context,
          }).game,
      );
      run('p1', { kind: 'accept-playoff-step', round, games });
    }
    expect(state.postseason?.championTeamId).not.toBeNull();
    expect(state.postseason?.series).toHaveLength(15);

    run('p1', { kind: 'complete-league' });
    expect(state.phase).toBe('completed');
    expect(state.report).not.toBeNull();
    const report = state.report;
    if (report === null) throw new Error('no report');
    expect(report.seats.p1.roster).toHaveLength(5);
    expect(report.seats.p2.roster).toHaveLength(5);
    expect(report.seats.p1.wins + report.seats.p1.losses).toBe(82);
    expect(report.seats.p2.wins + report.seats.p2.losses).toBe(82);

    const replayed = replayCapRushMultiplayerLog({
      rootSeed,
      commands,
      environment,
    });
    expect(replayed.stateDigest).toBe(capRushMultiplayerStateDigest(state));
    expect(replayed.state.phase).toBe('completed');
  }, 600_000);
});
