import { describe, expect, it } from 'vitest';
import {
  commandIdSchema,
  eraIdSchema,
  franchiseIdSchema,
  idSchema,
  playerIdSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import type { FixedFiveCommand } from '@hoop-rush/data-contracts';
import { createEngineContext, type DuelDraftState } from '@hoop-rush/engine';
import {
  computeDueAutopick,
  deriveEffectivePhase,
  isDraftComplete,
  isFixedFiveDraftTurn,
  mergeFixedFiveCommands,
  pickOrdinalOf,
  picksCommittedOf,
  refsForParticipant,
  replayFixedFiveLog,
  restoreFixedFiveCommandSyncState,
  roomLogFacts,
  type DraftReplay,
  type FixedFiveAssets,
} from '$lib/fixed-five-room-state';

const ROOM = idSchema.parse('room-1');
const ROOT = seedSchema.parse('0123456789abcdef0123456789abcdef');

function duelReplay(overrides: Partial<Extract<DraftReplay, { mode: 'duel' }>> = {}): DraftReplay {
  return {
    mode: 'duel',
    hasStart: true,
    skipped: 0,
    state: {
      rootSeed: ROOT,
      firstPicker: 'p1',
      pickOrdinal: 0,
      currentRoll: {
        franchiseId: franchiseIdSchema.parse('bulls'),
        eraId: eraIdSchema.parse('1990s'),
      },
      picks: [],
      claimedPairs: [],
      claimedVersionIds: [],
      rerolls: {
        p1: { franchiseSpent: false, eraSpent: false },
        p2: { franchiseSpent: false, eraSpent: false },
      },
      status: 'drafting',
      ...overrides.state,
    },
    ...overrides,
  };
}

function command(
  ordinal: number,
  actor: 'p1' | 'p2',
  payload: FixedFiveCommand['payload'],
): FixedFiveCommand {
  return {
    schemaVersion: 1,
    roomId: ROOM,
    commandId: commandIdSchema.parse(`cmd-${String(ordinal)}`),
    ordinal,
    actorParticipantId: actor,
    payload,
  };
}

describe('roomLogFacts', () => {
  it('tracks ready, rematch, proposals, and confirmations in ordinal order', () => {
    const facts = roomLogFacts([
      command(0, 'p1', { kind: 'ready', ready: true }),
      command(1, 'p2', { kind: 'ready', ready: false }),
      command(2, 'p1', { kind: 'rematch-request' }),
      command(3, 'p2', { kind: 'rematch-confirm' }),
    ]);
    expect(facts.ready).toEqual({ p1: true, p2: false });
    expect(facts.rematchRequested.p1).toBe(true);
    expect(facts.rematchConfirmed.p2).toBe(true);
    expect(facts.proposals).toEqual([]);
  });
});

describe('mergeFixedFiveCommands', () => {
  it('keeps one local copy when overlapping resyncs return the same accepted commands', () => {
    const first = command(4, 'p1', {
      kind: 'sandbox-place',
      playerId: playerIdSchema.parse('player-1'),
      slotIndex: 0,
    });
    const second = command(5, 'p2', {
      kind: 'sandbox-place',
      playerId: playerIdSchema.parse('player-2'),
      slotIndex: 0,
    });

    const afterFirstSync = mergeFixedFiveCommands([], [first, second]);
    const afterOverlappingSync = mergeFixedFiveCommands(afterFirstSync, [first, second]);

    expect(afterOverlappingSync).toEqual([first, second]);
  });

  it('rejects contradictory commands at the same accepted ordinal', () => {
    const first = command(4, 'p1', { kind: 'ready', ready: true });
    const conflict = {
      ...command(4, 'p2', { kind: 'ready', ready: true }),
      commandId: commandIdSchema.parse('cmd-conflict'),
    };

    expect(() => mergeFixedFiveCommands([first], [conflict])).toThrow(
      'fixed-five command log conflicts at ordinal 4',
    );
  });
});

describe('restoreFixedFiveCommandSyncState', () => {
  it('restores accepted draft commands before choosing the resume cursor', () => {
    const start = command(0, 'p1', { kind: 'start' });
    const firstPick = command(1, 'p1', {
      kind: 'duel-claim',
      playerId: playerIdSchema.parse('player-1'),
      slotIndex: 0,
      franchiseId: franchiseIdSchema.parse('mavericks'),
      eraId: eraIdSchema.parse('2010s'),
    });

    const restored = restoreFixedFiveCommandSyncState([start, firstPick]);

    expect(restored.commands).toEqual([start, firstPick]);
    expect(restored.lastOrdinal).toBe(1);
  });

  it('refetches from the first gap instead of skipping missing commands', () => {
    const start = command(0, 'p1', { kind: 'start' });
    const laterPick = command(2, 'p1', {
      kind: 'duel-claim',
      playerId: playerIdSchema.parse('player-2'),
      slotIndex: 1,
      franchiseId: franchiseIdSchema.parse('lakers'),
      eraId: eraIdSchema.parse('2000s'),
    });

    const restored = restoreFixedFiveCommandSyncState([laterPick, start]);

    expect(restored.commands).toEqual([start]);
    expect(restored.lastOrdinal).toBe(0);
  });
});

describe('deriveEffectivePhase', () => {
  it('keeps server terminal phases untouched', () => {
    const replay = duelReplay({ hasStart: false });
    expect(deriveEffectivePhase('completed', replay, false)).toBe('completed');
    expect(deriveEffectivePhase('integrity-failed', replay, false)).toBe('integrity-failed');
    expect(deriveEffectivePhase('expired', replay, false)).toBe('expired');
  });
  it('walks lobby, drafting, simulating, and awaiting-confirmation from the log', () => {
    const completeState: DuelDraftState = {
      rootSeed: ROOT,
      firstPicker: 'p1',
      pickOrdinal: 10,
      currentRoll: null,
      picks: [],
      claimedPairs: [],
      claimedVersionIds: [],
      rerolls: {
        p1: { franchiseSpent: false, eraSpent: false },
        p2: { franchiseSpent: false, eraSpent: false },
      },
      status: 'complete',
    };
    expect(deriveEffectivePhase('lobby', duelReplay({ hasStart: false }), false)).toBe('lobby');
    expect(deriveEffectivePhase('lobby', duelReplay(), false)).toBe('drafting');
    expect(deriveEffectivePhase('lobby', duelReplay({ state: completeState }), false)).toBe(
      'simulating',
    );
    expect(deriveEffectivePhase('lobby', duelReplay({ state: completeState }), true)).toBe(
      'awaiting-confirmation',
    );
  });
  it('reports draft completion from duel state', () => {
    const drafting = duelReplay();
    expect(isDraftComplete(drafting)).toBe(false);
    const done = duelReplay({
      state: {
        rootSeed: ROOT,
        firstPicker: 'p1',
        pickOrdinal: 10,
        currentRoll: null,
        picks: [],
        claimedPairs: [],
        claimedVersionIds: [],
        rerolls: {
          p1: { franchiseSpent: false, eraSpent: false },
          p2: { franchiseSpent: false, eraSpent: false },
        },
        status: 'complete',
      },
    });
    expect(isDraftComplete(done)).toBe(true);
  });
});

describe('sandbox duel replay', () => {
  function poolAssets(): FixedFiveAssets {
    const defs: Array<{ playerId: string; positions: Array<'PG' | 'SG' | 'SF' | 'PF' | 'C'> }> = [
      { playerId: 'player-g1', positions: ['PG'] },
      { playerId: 'player-g2', positions: ['SG'] },
      { playerId: 'player-g3', positions: ['PG', 'SG'] },
      { playerId: 'player-f1', positions: ['SF'] },
      { playerId: 'player-f2', positions: ['PF'] },
      { playerId: 'player-f3', positions: ['SF', 'PF'] },
      { playerId: 'player-c1', positions: ['C'] },
      { playerId: 'player-c2', positions: ['PF', 'C'] },
    ];
    const pool = defs.map((d, index) => ({
      playerId: playerIdSchema.parse(d.playerId),
      playerVersionId: `pv-${d.playerId}`,
      positions: d.positions,
      selectionScore: 80 - index,
      franchiseId: franchiseIdSchema.parse('lakers'),
      eraId: eraIdSchema.parse('1990s'),
    }));
    return {
      pool,
      poolById: new Map(pool.map((c) => [c.playerId, c])),
      catalog: [
        {
          franchiseId: franchiseIdSchema.parse('lakers'),
          eraId: eraIdSchema.parse('1990s'),
          players: pool.map((c) => ({ playerId: c.playerId, positions: [...c.positions] })),
        },
      ],
      context: createEngineContext(),
    } as unknown as FixedFiveAssets;
  }

  function place(ordinal: number, actor: 'p1' | 'p2', playerId: string, slotIndex: number) {
    return command(ordinal, actor, {
      kind: 'sandbox-place',
      playerId: playerIdSchema.parse(playerId),
      slotIndex,
    });
  }

  it('replays alternating free picks from sandbox-place commands', () => {
    const replay = replayFixedFiveLog(
      'duel',
      ROOM,
      ROOT,
      'data-v1',
      'ratings',
      poolAssets(),
      [
        command(0, 'p1', { kind: 'start' }),
        place(1, 'p1', 'player-g1', 0),
        place(2, 'p2', 'player-g2', 1),
      ],
      'sandbox',
    );
    expect(replay.mode).toBe('sandbox-duel');
    if (replay.mode !== 'sandbox-duel') return;
    expect(replay.skipped).toBe(0);
    expect(replay.state.picks.map((p) => [p.participantId, p.playerId])).toEqual([
      ['p1', playerIdSchema.parse('player-g1')],
      ['p2', playerIdSchema.parse('player-g2')],
    ]);
    expect(isDraftComplete(replay)).toBe(false);
    expect(isFixedFiveDraftTurn(replay, 'p1')).toBe(true);
    expect(isFixedFiveDraftTurn(replay, 'p2')).toBe(false);
    expect(picksCommittedOf(replay, 'p1')).toBe(1);
    expect(pickOrdinalOf(replay, 'p1')).toBe(2);
  });

  it('lets both duelists share a star, ignores roll-era commands, and counts illegal claims', () => {
    const replay = replayFixedFiveLog(
      'duel',
      ROOM,
      ROOT,
      'data-v1',
      'ratings',
      poolAssets(),
      [
        command(0, 'p1', { kind: 'start' }),
        place(1, 'p1', 'player-g1', 0),
        place(2, 'p2', 'player-g1', 0),
        command(3, 'p2', { kind: 'reroll', axis: 'franchise' }),
        command(4, 'p1', {
          kind: 'duel-claim',
          playerId: playerIdSchema.parse('player-g2'),
          slotIndex: 1,
          franchiseId: franchiseIdSchema.parse('lakers'),
          eraId: eraIdSchema.parse('1990s'),
        }),
        place(5, 'p1', 'player-g1', 1),
      ],
      'sandbox',
    );
    expect(replay.mode).toBe('sandbox-duel');
    if (replay.mode !== 'sandbox-duel') return;
    expect(replay.skipped).toBe(1);
    expect(replay.state.picks).toHaveLength(2);
    const refs = refsForParticipant(replay, poolAssets(), 'p2');
    expect(refs).toHaveLength(1);
    expect(refs[0]?.slotIndex).toBe(0);
  });

  it('keeps classic-sourced duels on the roll draft', () => {
    const replay = replayFixedFiveLog(
      'duel',
      ROOM,
      ROOT,
      'data-v1',
      'ratings',
      poolAssets(),
      [command(0, 'p1', { kind: 'start' }), place(1, 'p1', 'player-g1', 0)],
      'classic',
    );
    expect(replay.mode).toBe('duel');
  });
});

describe('isFixedFiveDraftTurn', () => {
  it('allows only the current participant to interact with a duel offer', () => {
    const replay = duelReplay();
    expect(isFixedFiveDraftTurn(replay, 'p1')).toBe(true);
    expect(isFixedFiveDraftTurn(replay, 'p2')).toBe(false);
  });

  it('does not start timeout work for the participant who is waiting', () => {
    const replay = duelReplay();
    expect(computeDueAutopick('duel', ROOT, replay, {} as FixedFiveAssets, 'p2')).toBeNull();
  });
});
