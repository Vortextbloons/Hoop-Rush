import { describe, expect, it } from 'vitest';
import {
  contentHashSchema,
  eraIdSchema,
  fixedFiveCommandSchema,
  franchiseIdSchema,
  playerIdSchema,
  seedFromString,
  seedSchema,
  type ClassicDraftCatalog,
  type EraId,
  type FixedFiveCommand,
  type FranchiseId,
  type PlayerId,
  type Position,
} from '@hoop-rush/data-contracts';
import { createEngineContext } from '../../sim/kernel.ts';
import { createParticipantClassicDraft } from '../classic/draft.ts';
import { claimDuelPlayer, createDuelDraft, duelCurrentPicker } from './duel.ts';
import { fixedFiveDraftSeed } from './seeds.ts';
import { enumerateClassicSafeMoves, enumerateDuelSafeMoves, chooseAutopick } from './timeout.ts';
import type { FixedFiveCandidate } from './sandbox-builder.ts';
import {
  computeDueAutopick,
  deriveEffectivePhase,
  mergeFixedFiveCommands,
  replayFixedFiveLog,
  restoreFixedFiveCommandSyncState,
  roomLogFacts,
} from './log.ts';

const pid = (value: string): PlayerId => playerIdSchema.parse(value);
const fid = (value: string): FranchiseId => franchiseIdSchema.parse(value);
const eid = (value: string): EraId => eraIdSchema.parse(value);
const context = createEngineContext();
const ROOT = seedSchema.parse(seedFromString('fixed-five-log-golden'));
const ROOM_ID = 'room-1';

function poolFixture(): { pool: FixedFiveCandidate[]; byId: Map<string, FixedFiveCandidate> } {
  const defs: Array<{
    playerId: PlayerId;
    positions: Position[];
    score: number;
    franchiseId: string;
    eraId: string;
  }> = [
    { playerId: pid('l-g1'), positions: ['PG'], score: 90, franchiseId: 'lakers', eraId: '1990s' },
    { playerId: pid('l-g2'), positions: ['SG'], score: 88, franchiseId: 'lakers', eraId: '1990s' },
    { playerId: pid('b-f1'), positions: ['SF'], score: 87, franchiseId: 'bulls', eraId: '1990s' },
    { playerId: pid('b-f2'), positions: ['PF'], score: 86, franchiseId: 'bulls', eraId: '1990s' },
    { playerId: pid('c-c1'), positions: ['C'], score: 89, franchiseId: 'celtics', eraId: '1990s' },
    {
      playerId: pid('c-g3'),
      positions: ['PG', 'SG'],
      score: 84,
      franchiseId: 'celtics',
      eraId: '2000s',
    },
    {
      playerId: pid('h-f3'),
      positions: ['SF', 'PF'],
      score: 83,
      franchiseId: 'heat',
      eraId: '2000s',
    },
    {
      playerId: pid('h-c2'),
      positions: ['PF', 'C'],
      score: 82,
      franchiseId: 'heat',
      eraId: '2000s',
    },
  ];
  const pool = defs.map((def) => ({
    playerId: def.playerId,
    playerVersionId: `pv-${def.playerId}`,
    positions: def.positions,
    selectionScore: def.score,
    franchiseId: def.franchiseId,
    eraId: def.eraId,
  }));
  return { pool, byId: new Map(pool.map((candidate) => [candidate.playerId, candidate])) };
}

function catalogFixture(): ClassicDraftCatalog {
  const entry = (
    franchiseId: string,
    eraId: string,
    players: Array<{ playerId: PlayerId; positions: Position[] }>,
  ): ClassicDraftCatalog[number] => ({
    franchiseId: fid(franchiseId),
    eraId: eid(eraId),
    players,
  });
  return [
    entry('lakers', '1990s', [
      { playerId: pid('l-g1'), positions: ['PG'] },
      { playerId: pid('l-g2'), positions: ['SG'] },
    ]),
    entry('bulls', '1990s', [
      { playerId: pid('b-f1'), positions: ['SF'] },
      { playerId: pid('b-f2'), positions: ['PF'] },
    ]),
    entry('celtics', '1990s', [{ playerId: pid('c-c1'), positions: ['C'] }]),
    entry('celtics', '2000s', [{ playerId: pid('c-g3'), positions: ['PG', 'SG'] }]),
    entry('heat', '2000s', [
      { playerId: pid('h-f3'), positions: ['SF', 'PF'] },
      { playerId: pid('h-c2'), positions: ['PF', 'C'] },
    ]),
  ];
}

function commandOf(
  ordinal: number,
  actor: 'p1' | 'p2',
  payload: FixedFiveCommand['payload'],
): FixedFiveCommand {
  return fixedFiveCommandSchema.parse({
    schemaVersion: 1,
    roomId: ROOM_ID,
    commandId: `cmd-${String(ordinal)}`,
    ordinal,
    actorParticipantId: actor,
    payload,
  });
}

describe('replayFixedFiveLog', () => {
  it('replays a classic pick log into the same per-participant drafts', () => {
    const { byId } = poolFixture();
    const catalog = catalogFixture();
    const p1Draft = createParticipantClassicDraft(
      `${ROOM_ID}:p1`,
      'ratings',
      fixedFiveDraftSeed(ROOT, 'p1'),
      'data-v1',
      catalog,
      context,
    );
    const p2Draft = createParticipantClassicDraft(
      `${ROOM_ID}:p2`,
      'ratings',
      fixedFiveDraftSeed(ROOT, 'p2'),
      'data-v1',
      catalog,
      context,
    );
    const p1Move = enumerateClassicSafeMoves(catalog, byId, p1Draft)[0];
    const p2Move = enumerateClassicSafeMoves(catalog, byId, p2Draft)[0];
    if (!p1Move || !p2Move) throw new Error('fixture has no classic safe moves');

    const replay = replayFixedFiveLog(
      'classic-shared-82',
      ROOM_ID,
      ROOT,
      'data-v1',
      'ratings',
      {
        catalog,
        pool: poolFixture().pool,
        poolById: byId,
        context,
      },
      [
        commandOf(0, 'p1', { kind: 'start' }),
        commandOf(1, 'p1', {
          kind: 'classic-pick',
          playerId: p1Move.playerId,
          slotIndex: p1Move.slotIndex,
        }),
        commandOf(2, 'p2', {
          kind: 'classic-pick',
          playerId: p2Move.playerId,
          slotIndex: p2Move.slotIndex,
        }),
      ],
    );

    expect(replay.mode).toBe('classic-shared-82');
    if (replay.mode !== 'classic-shared-82') throw new Error('unexpected replay mode');
    expect(replay.hasStart).toBe(true);
    expect(replay.skipped).toBe(0);
    expect(replay.p1.picks).toHaveLength(1);
    expect(replay.p1.picks[0]?.playerId).toBe(p1Move.playerId);
    expect(replay.p2.picks).toHaveLength(1);
    expect(replay.p2.picks[0]?.playerId).toBe(p2Move.playerId);
  });

  it('replays a duel claim log into the same duel draft', () => {
    const { pool, byId } = poolFixture();
    const catalog = catalogFixture();
    const state = createDuelDraft(ROOT, catalog, byId, context);
    const move = enumerateDuelSafeMoves(catalog, byId, state)[0];
    if (!move) throw new Error('fixture has no duel safe move');
    const actor = duelCurrentPicker(state);
    const expected = claimDuelPlayer(
      state,
      catalog,
      byId,
      { playerId: move.playerId, slotIndex: move.slotIndex, actor },
      context,
    );

    const replay = replayFixedFiveLog(
      'duel',
      ROOM_ID,
      ROOT,
      'data-v1',
      'ratings',
      {
        catalog,
        pool,
        poolById: byId,
        context,
      },
      [
        commandOf(0, 'p1', { kind: 'start' }),
        commandOf(1, actor, {
          kind: 'duel-claim',
          playerId: move.playerId,
          slotIndex: move.slotIndex,
          franchiseId: fid(byId.get(move.playerId)?.franchiseId ?? 'lakers'),
          eraId: byId.get(move.playerId)?.eraId ?? '1990s',
        }),
      ],
    );

    expect(replay.mode).toBe('duel');
    if (replay.mode !== 'duel') throw new Error('unexpected replay mode');
    expect(replay.state.picks).toEqual(expected.picks);
    expect(replay.state.pickOrdinal).toBe(expected.pickOrdinal);
  });

  it('merges command logs idempotently and rejects ordinal conflicts', () => {
    const first = commandOf(0, 'p1', { kind: 'start' });
    const duplicate = { ...first, commandId: first.commandId };
    expect(mergeFixedFiveCommands([first], [duplicate])).toHaveLength(1);
    expect(() => mergeFixedFiveCommands([first], [commandOf(0, 'p2', { kind: 'start' })])).toThrow(
      /conflicts at ordinal 0/,
    );
    expect(() => mergeFixedFiveCommands([first], [{ ...first, ordinal: 1 }])).toThrow(
      /changed ordinal/,
    );
  });

  it('restores a dense prefix and stops at the first gap', () => {
    const commands = [
      commandOf(1, 'p1', { kind: 'start' }),
      commandOf(0, 'p1', { kind: 'start' }),
      commandOf(2, 'p1', { kind: 'start' }),
    ];
    const restored = restoreFixedFiveCommandSyncState(commands);
    expect(restored.lastOrdinal).toBe(2);
    expect(restored.commands.map((command) => command.ordinal)).toEqual([0, 1, 2]);

    const withGap = restoreFixedFiveCommandSyncState([
      commandOf(0, 'p1', { kind: 'start' }),
      commandOf(2, 'p1', { kind: 'start' }),
    ]);
    expect(withGap.lastOrdinal).toBe(0);
    expect(withGap.commands).toHaveLength(1);
  });

  it('derives room log facts and effective phases', () => {
    const digest = contentHashSchema.parse('a'.repeat(64));
    const facts = roomLogFacts([
      commandOf(0, 'p1', { kind: 'ready', ready: true }),
      commandOf(1, 'p1', { kind: 'propose-result', resultDigest: digest }),
      commandOf(2, 'p2', { kind: 'confirm-result', resultDigest: digest, verified: true }),
    ]);
    expect(facts.ready).toEqual({ p1: true, p2: false });
    expect(facts.proposals).toEqual([{ actor: 'p1', digest }]);
    expect(facts.confirms).toEqual([{ actor: 'p2', digest, verified: true }]);

    const replay = replayFixedFiveLog(
      'classic-shared-82',
      ROOM_ID,
      ROOT,
      'data-v1',
      'ratings',
      {
        catalog: catalogFixture(),
        pool: poolFixture().pool,
        poolById: poolFixture().byId,
        context,
      },
      [],
    );
    expect(deriveEffectivePhase('lobby', replay, false)).toBe('lobby');
    expect(deriveEffectivePhase('drafting', replay, false)).toBe('lobby');
    expect(deriveEffectivePhase('completed', replay, false)).toBe('completed');
    expect(deriveEffectivePhase('integrity-failed', replay, true)).toBe('integrity-failed');
  });

  it('computes a deterministic due autopick from the replay', () => {
    const { pool, byId } = poolFixture();
    const catalog = catalogFixture();
    const replay = replayFixedFiveLog(
      'classic-shared-82',
      ROOM_ID,
      ROOT,
      'data-v1',
      'ratings',
      {
        catalog,
        pool,
        poolById: byId,
        context,
      },
      [commandOf(0, 'p1', { kind: 'start' })],
    );
    const assets = { catalog, pool, poolById: byId, context };
    const selection = computeDueAutopick('classic-shared-82', ROOT, replay, assets, 'p1');
    expect(selection).not.toBeNull();
    const again = computeDueAutopick('classic-shared-82', ROOT, replay, assets, 'p1');
    expect(again).toEqual(selection);
    const direct = chooseAutopick(
      ROOT,
      'classic-shared-82',
      'p1',
      0,
      enumerateClassicSafeMoves(
        catalog,
        byId,
        createParticipantClassicDraft(
          `${ROOM_ID}:p1`,
          'ratings',
          fixedFiveDraftSeed(ROOT, 'p1'),
          'data-v1',
          catalog,
          context,
        ),
      ),
    );
    expect(selection).toEqual(direct);
  });
});
