import { describe, expect, it } from 'vitest';
import {
  playerIdSchema,
  seedSchema,
  type FixedFiveWorkerResultEntry,
  type SimulationTeam,
} from '@hoop-rush/data-contracts';
import { createEngineContext, simulateDuelSeries } from '@hoop-rush/engine';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildFixtureBracket,
  buildLegalSimulationTeam,
} from '@hoop-rush/test-fixtures';
import {
  summarizeWorkerEntries,
  deriveEffectivePhase,
  type DraftReplay,
} from './fixed-five-room-state';

const ROOT = seedSchema.parse('c'.repeat(32));
const CONTEXT = createEngineContext();
function teamWithIds(teamId: string, displayName: string, prefix: string): SimulationTeam {
  const base = buildLegalSimulationTeam({ teamId, displayName });
  return {
    ...base,
    players: base.players.map((player, index) => ({
      ...player,
      playerId: playerIdSchema.parse(`${prefix}-${String(index + 1)}`),
    })),
  };
}
const P1_TEAM = teamWithIds('p1', 'Player 1', 'identity-p1');
const P2_TEAM = teamWithIds('p2', 'Player 2', 'identity-p2');
const SERIES = simulateDuelSeries(
  {
    p1Team: P1_TEAM,
    p2Team: P2_TEAM,
    profile: DEFAULT_ERA_SIM_PROFILE,
    rootSeed: ROOT,
    dataVersion: 'data-v1',
  },
  CONTEXT,
);
const ENTRIES: FixedFiveWorkerResultEntry[] = SERIES.games.map((game) => ({
  tag: 'duel',
  game,
}));
const P1_PLAYER_IDS = P1_TEAM.players.map((player) => player.playerId);
const P2_PLAYER_IDS = P2_TEAM.players.map((player) => player.playerId);

describe('summarizeWorkerEntries participant identity', () => {
  it('accepts duel entries when rosters match the declared participants', () => {
    const { result } = summarizeWorkerEntries({
      mode: 'duel',
      bracket: buildFixtureBracket(),
      rootSeed: ROOT,
      p1TeamId: 'p1',
      p2TeamId: 'p2',
      p1PlayerIds: P1_PLAYER_IDS,
      p2PlayerIds: P2_PLAYER_IDS,
      entries: ENTRIES,
    });
    expect(result.competition).toBe('duel');
    if (result.competition !== 'duel') throw new Error('expected a duel result');
    expect(result.stoppedAtGame).toBe(SERIES.games.length);
  });

  it('rejects entries whose rosters are swapped between the participants', () => {
    expect(() =>
      summarizeWorkerEntries({
        mode: 'duel',
        bracket: buildFixtureBracket(),
        rootSeed: ROOT,
        p1TeamId: 'p1',
        p2TeamId: 'p2',
        p1PlayerIds: P2_PLAYER_IDS,
        p2PlayerIds: P1_PLAYER_IDS,
        entries: ENTRIES,
      }),
    ).toThrow(/identities/);
  });
});

describe('deriveEffectivePhase with the server phase ladder', () => {
  function classicReplay(hasStart: boolean, complete: boolean): DraftReplay {
    return {
      mode: 'classic-shared-82',
      hasStart,
      p1: { status: complete ? 'complete' : 'drafting' },
      p2: { status: complete ? 'complete' : 'drafting' },
      skipped: 0,
    } as unknown as DraftReplay;
  }
  it('derives the local phase from the draft and simulation instead of the server drafting phase', () => {
    expect(deriveEffectivePhase('lobby', classicReplay(false, false), false)).toBe('lobby');
    expect(deriveEffectivePhase('drafting', classicReplay(true, false), false)).toBe('drafting');
    expect(deriveEffectivePhase('drafting', classicReplay(true, true), false)).toBe('simulating');
    expect(deriveEffectivePhase('drafting', classicReplay(true, true), true)).toBe(
      'awaiting-confirmation',
    );
    expect(deriveEffectivePhase('awaiting-confirmation', classicReplay(true, true), false)).toBe(
      'simulating',
    );
    expect(deriveEffectivePhase('completed', classicReplay(true, true), true)).toBe('completed');
    expect(deriveEffectivePhase('integrity-failed', classicReplay(true, true), true)).toBe(
      'integrity-failed',
    );
  });
});
