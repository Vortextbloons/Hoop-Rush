import { describe, expect, it } from 'vitest';
import {
  buildFixtureBracket,
  buildLegalSimulationTeam,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import type {
  ClassicDraftCatalog,
  EraId,
  EraSimulationProfile,
  FranchiseId,
  PlayerId,
  Position,
} from '@hoop-rush/data-contracts';
import {
  commandIdSchema,
  contentHashSchema,
  eraIdSchema,
  franchiseIdSchema,
  idSchema,
  playerIdSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import type { FixedFiveCommand } from '@hoop-rush/data-contracts';
const pid = (value: string): PlayerId => playerIdSchema.parse(value);
const fid = (value: string): FranchiseId => franchiseIdSchema.parse(value);
const eid = (value: string): EraId => eraIdSchema.parse(value);
import { DEFAULT_ERA_SIM_PROFILE } from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../../sim/context.ts';
import { createClassicDraft } from '../classic/draft.ts';
import {
  FIXED_FIVE_TIEBREAK_PATH,
  fixedFiveAutopickSeed,
  fixedFiveDraftSeed,
  fixedFiveDuelGameSeed,
  fixedFiveFirstPicker,
  fixedFiveH2HSeed,
  fixedFiveParticipantSeed,
  fixedFiveSharedGameSeed,
  fixedFiveTiebreakWinner,
} from './seeds.ts';
import {
  applySandboxBuilderCommand,
  createSandboxBuilder,
  enumerateSandboxSafeMoves,
  type FixedFiveCandidate,
} from './sandbox-builder.ts';
import { applyClassicBuilderCommand, createParticipantClassicDraft } from './classic-reducer.ts';
import {
  claimDuelPlayer,
  createDuelDraft,
  duelAlternationHolds,
  duelCurrentPicker,
  isDuelComplete,
  rerollDuel,
} from './duel.ts';
import {
  chooseAutopick,
  chooseSandboxAutopicksUntilFull,
  enumerateClassicSafeMoves,
} from './timeout.ts';
import { findWeakestOpponent, h2hGameNumbersFor, simulateShared82 } from './shared82.ts';
import { simulateDuelSeries } from './duel-sim.ts';
import { fixedFiveResultDigest } from './digest.ts';
const context = createEngineContext();
const ROOT = seedSchema.parse(seedFromString('fixed-five-golden'));
function candidatePool(): FixedFiveCandidate[] {
  const defs: Array<{
    playerId: string;
    positions: FixedFiveCandidate['positions'];
    score: number;
    franchiseId: string;
    eraId: string;
  }> = [
    { playerId: pid(`p-g1`), positions: ['PG'], score: 90, franchiseId: 'lakers', eraId: '1990s' },
    { playerId: pid(`p-g2`), positions: ['SG'], score: 88, franchiseId: 'lakers', eraId: '1990s' },
    {
      playerId: 'p-g3',
      positions: ['PG', 'SG'],
      score: 85,
      franchiseId: 'celtics',
      eraId: '1990s',
    },
    { playerId: pid(`p-f1`), positions: ['SF'], score: 87, franchiseId: 'bulls', eraId: '1990s' },
    { playerId: pid(`p-f2`), positions: ['PF'], score: 86, franchiseId: 'bulls', eraId: '1990s' },
    { playerId: 'p-f3', positions: ['SF', 'PF'], score: 84, franchiseId: 'heat', eraId: '2000s' },
    { playerId: pid(`p-c1`), positions: ['C'], score: 89, franchiseId: 'celtics', eraId: '1990s' },
    { playerId: 'p-c2', positions: ['PF', 'C'], score: 83, franchiseId: 'heat', eraId: '2000s' },
  ];
  return defs.map((d) => ({
    playerId: pid(d.playerId),
    playerVersionId: `pv-${d.playerId}`,
    positions: d.positions,
    selectionScore: d.score,
    franchiseId: fid(d.franchiseId),
    eraId: eid(d.eraId),
  }));
}
function classicCatalog(): ClassicDraftCatalog {
  const entry = (
    franchiseId: string,
    eraId: string,
    players: Array<{
      playerId: string;
      positions: Position[];
    }>,
  ): ClassicDraftCatalog[number] => ({
    franchiseId: fid(franchiseId),
    eraId: eid(eraId),
    players: players.map((p) => ({ playerId: pid(p.playerId), positions: p.positions })),
  });
  return [
    entry('bulls', '1990s', [
      { playerId: pid(`p-f1`), positions: ['SF'] },
      { playerId: pid(`p-f2`), positions: ['PF'] },
    ]),
    entry('celtics', '1990s', [
      { playerId: 'p-g3', positions: ['PG', 'SG'] },
      { playerId: pid(`p-c1`), positions: ['C'] },
    ]),
    entry('heat', '2000s', [
      { playerId: 'p-f3', positions: ['SF', 'PF'] },
      { playerId: 'p-c2', positions: ['PF', 'C'] },
    ]),
    entry('lakers', '1990s', [
      { playerId: pid(`p-g1`), positions: ['PG'] },
      { playerId: pid(`p-g2`), positions: ['SG'] },
    ]),
    entry('lakers', '2010s', [{ playerId: 'p-g4', positions: ['SG'] }]),
  ];
}
function duelCatalog(): ClassicDraftCatalog {
  const franchises = ['bulls', 'celtics', 'heat', 'lakers', 'spurs', 'suns'];
  const eras = ['1990s', '2010s'];
  const catalog: ClassicDraftCatalog = [];
  let n = 0;
  for (const franchiseId of franchises) {
    for (const eraId of eras) {
      n += 1;
      catalog.push({
        franchiseId: fid(franchiseId),
        eraId: eid(eraId),
        players: [
          { playerId: pid(`d-g-${String(n)}`), positions: ['PG'] },
          { playerId: pid(`d-f-${String(n)}`), positions: ['SF'] },
          { playerId: pid(`d-c-${String(n)}`), positions: ['C'] },
          { playerId: pid(`d-g2-${String(n)}`), positions: ['SG'] },
          { playerId: pid(`d-f2-${String(n)}`), positions: ['PF'] },
        ],
      });
    }
  }
  return catalog;
}
function duelPool(): {
  pool: FixedFiveCandidate[];
  byId: Map<string, FixedFiveCandidate>;
} {
  const pool: FixedFiveCandidate[] = [];
  for (let n = 1; n <= 12; n += 1) {
    pool.push(
      {
        playerId: pid(`d-g-${String(n)}`),
        playerVersionId: `pv-d-g-${String(n)}`,
        positions: ['PG'],
        selectionScore: 80 + (n % 5),
        franchiseId: 'x',
        eraId: 'y',
      },
      {
        playerId: pid(`d-f-${String(n)}`),
        playerVersionId: `pv-d-f-${String(n)}`,
        positions: ['SF'],
        selectionScore: 79 + (n % 5),
        franchiseId: 'x',
        eraId: 'y',
      },
      {
        playerId: pid(`d-c-${String(n)}`),
        playerVersionId: `pv-d-c-${String(n)}`,
        positions: ['C'],
        selectionScore: 78 + (n % 5),
        franchiseId: 'x',
        eraId: 'y',
      },
      {
        playerId: pid(`d-g2-${String(n)}`),
        playerVersionId: `pv-d-g2-${String(n)}`,
        positions: ['SG'],
        selectionScore: 77 + (n % 5),
        franchiseId: 'x',
        eraId: 'y',
      },
      {
        playerId: pid(`d-f2-${String(n)}`),
        playerVersionId: `pv-d-f2-${String(n)}`,
        positions: ['PF'],
        selectionScore: 76 + (n % 5),
        franchiseId: 'x',
        eraId: 'y',
      },
    );
  }
  return { pool, byId: new Map(pool.map((c) => [c.playerId, c])) };
}
function slotForPosition(
  positions: FixedFiveCandidate['positions'],
  used: Set<number>,
): 0 | 1 | 2 | 3 | 4 {
  for (const s of [0, 1, 2, 3, 4] as const) {
    if (used.has(s)) continue;
    const req = s <= 1 ? 'G' : s <= 3 ? 'F' : 'C';
    const groups = positions.map((pos) =>
      pos === 'PG' || pos === 'SG' ? 'G' : pos === 'C' ? 'C' : 'F',
    );
    if (groups.includes(req)) return s;
  }
  throw new Error('no legal slot');
}
function poolById(pool: FixedFiveCandidate[]): Map<string, FixedFiveCandidate> {
  return new Map(pool.map((c) => [c.playerId, c]));
}
describe('fixed-five seeds', () => {
  it('derives distinct participant seeds deterministically', () => {
    expect(fixedFiveParticipantSeed(ROOT, 'p1')).toBe(fixedFiveParticipantSeed(ROOT, 'p1'));
    expect(fixedFiveParticipantSeed(ROOT, 'p1')).not.toBe(fixedFiveParticipantSeed(ROOT, 'p2'));
    expect(fixedFiveDraftSeed(ROOT, 'p1')).not.toBe(fixedFiveDraftSeed(ROOT, 'p2'));
  });
  it('derives a stable first picker', () => {
    expect(fixedFiveFirstPicker(ROOT)).toBe(fixedFiveFirstPicker(ROOT));
    expect(['p1', 'p2']).toContain(fixedFiveFirstPicker(ROOT));
  });
  it('derives duel, shared, h2h, autopick, and tiebreak seeds on named paths', () => {
    expect(fixedFiveDuelGameSeed(ROOT, 1)).not.toBe(fixedFiveDuelGameSeed(ROOT, 2));
    expect(fixedFiveSharedGameSeed(ROOT, 'p1', 1)).not.toBe(fixedFiveSharedGameSeed(ROOT, 'p2', 1));
    expect(fixedFiveH2HSeed(ROOT, 17)).toBe(fixedFiveH2HSeed(ROOT, 17));
    expect(fixedFiveAutopickSeed(ROOT, 'duel', 'p1', 0)).toContain('/timeout-autopick/duel/p1/0');
    expect(FIXED_FIVE_TIEBREAK_PATH).toBe('rootSeed/tiebreak/participant-order');
    expect(['p1', 'p2']).toContain(fixedFiveTiebreakWinner(ROOT));
  });
});
describe('sandbox builder', () => {
  it('places five through the pure G/G/F/F/C path and locks', () => {
    const pool = candidatePool();
    let state = createSandboxBuilder();
    state = applySandboxBuilderCommand(state, pool, {
      kind: 'sandbox-place',
      playerId: pid(`p-g1`),
      slotIndex: 0,
    });
    state = applySandboxBuilderCommand(state, pool, {
      kind: 'sandbox-place',
      playerId: pid(`p-g2`),
      slotIndex: 1,
    });
    state = applySandboxBuilderCommand(state, pool, {
      kind: 'sandbox-place',
      playerId: pid(`p-f1`),
      slotIndex: 2,
    });
    state = applySandboxBuilderCommand(state, pool, {
      kind: 'sandbox-place',
      playerId: pid(`p-f2`),
      slotIndex: 3,
    });
    state = applySandboxBuilderCommand(state, pool, {
      kind: 'sandbox-place',
      playerId: pid(`p-c1`),
      slotIndex: 4,
    });
    state = applySandboxBuilderCommand(state, pool, { kind: 'sandbox-lock' });
    expect(state.locked).toBe(true);
  });
  it('rejects illegal slot assignments on the same path solo and multiplayer share', () => {
    const pool = candidatePool();
    const state = createSandboxBuilder();
    expect(() =>
      applySandboxBuilderCommand(state, pool, {
        kind: 'sandbox-place',
        playerId: pid(`p-c1`),
        slotIndex: 0,
      }),
    ).toThrow();
  });
  it('enumerates only feasible safe moves', () => {
    const pool = candidatePool();
    const state = createSandboxBuilder();
    const moves = enumerateSandboxSafeMoves(pool, state);
    expect(moves.length).toBeGreaterThan(0);
    for (const move of moves) {
      expect(move.selectionScore).toBeGreaterThan(0);
    }
  });
});
describe('classic reducer', () => {
  it('wraps solo draft functions without changing default behavior', () => {
    const catalog = classicCatalog();
    const seed = fixedFiveDraftSeed(ROOT, 'p1');
    const solo = createParticipantClassicDraft(
      'draft-p1',
      'ratings',
      seed,
      'data-v1',
      catalog,
      context,
    );
    expect(solo.roll).not.toBeNull();
    expect(solo.seed).toBe(seed);
  });
  it('supports an optional eligibility policy', () => {
    const catalog = classicCatalog();
    const seed = fixedFiveDraftSeed(ROOT, 'p1');
    const state = createParticipantClassicDraft(
      'draft-p1',
      'ratings',
      seed,
      'data-v1',
      catalog,
      context,
    );
    const rerolled = applyClassicBuilderCommand(
      state,
      catalog,
      { kind: 'reroll', axis: 'franchise' },
      context,
      (entry) => entry.franchiseId !== 'xxx',
    );
    expect(rerolled.rerolls.franchiseSpent).toBe(true);
  });
  it('derives independent participant seeds', () => {
    const catalog = classicCatalog();
    const p1 = createParticipantClassicDraft(
      'd1',
      'ratings',
      fixedFiveDraftSeed(ROOT, 'p1'),
      'data-v1',
      catalog,
      context,
    );
    const p2 = createParticipantClassicDraft(
      'd2',
      'ratings',
      fixedFiveDraftSeed(ROOT, 'p2'),
      'data-v1',
      catalog,
      context,
    );
    expect(p1.seed).not.toBe(p2.seed);
  });
});
describe('duel draft', () => {
  it('alternates ten picks with mutual exclusivity', () => {
    const catalog = duelCatalog();
    const { byId } = duelPool();
    let state = createDuelDraft(ROOT, catalog, byId, context, 'p1');
    expect(duelCurrentPicker(state)).toBe('p1');
    for (let i = 0; i < 10; i += 1) {
      const picker = duelCurrentPicker(state);
      const roll = state.currentRoll;
      if (!roll) throw new Error('duel draft is missing its roll');
      const entry = catalog.find(
        (e) => e.franchiseId === roll.franchiseId && e.eraId === roll.eraId,
      );
      expect(entry).toBeDefined();
      const used = new Set<number>(
        state.picks.filter((p) => p.participantId === picker).map((p) => p.slotIndex),
      );
      const claimed = new Set(state.claimedVersionIds);
      const option = entry?.players.find((p) => {
        const candidate = byId.get(p.playerId);
        const versionId = candidate?.playerVersionId ?? p.playerId;
        if (claimed.has(versionId) || claimed.has(p.playerId)) return false;
        const positions = candidate?.positions ?? p.positions;
        try {
          slotForPosition(positions, used);
          return true;
        } catch {
          return false;
        }
      });
      expect(option).toBeDefined();
      if (!option) throw new Error('duel test found no claimable player');
      const candidate = byId.get(option.playerId);
      const positions = candidate?.positions ?? option.positions;
      const slot = slotForPosition(positions, used);
      state = claimDuelPlayer(
        state,
        catalog,
        byId,
        { playerId: option.playerId, slotIndex: slot, actor: picker },
        context,
      );
    }
    expect(isDuelComplete(state)).toBe(true);
    expect(duelAlternationHolds(state)).toBe(true);
    const pairs = state.picks.map((p) => `${p.franchiseId}|${p.eraId}`);
    expect(new Set(pairs).size).toBe(10);
    const versions = state.picks.map((p) => p.playerVersionId);
    expect(new Set(versions).size).toBe(10);
  });
  it('enforces one reroll per axis per participant', () => {
    const catalog = duelCatalog();
    const { byId } = duelPool();
    let state = createDuelDraft(ROOT, catalog, byId, context, 'p1');
    const picker = duelCurrentPicker(state);
    state = rerollDuel(state, catalog, byId, 'franchise', picker, context);
    expect(() =>
      rerollDuel(state, catalog, byId, 'franchise', duelCurrentPicker(state), context),
    ).toThrow();
  });
});
describe('timeout autopick', () => {
  it('ranks by selectionScore desc, versionId asc, slot asc and draws from top eight', () => {
    const single = [
      { playerId: pid('c'), playerVersionId: 'pv-c', slotIndex: 0 as const, selectionScore: 90 },
    ];
    expect(chooseAutopick(ROOT, 'duel', 'p1', 0, single).playerId).toBe('c');
    const candidates = [
      { playerId: pid('a'), playerVersionId: 'pv-b', slotIndex: 1 as const, selectionScore: 80 },
      { playerId: pid('b'), playerVersionId: 'pv-a', slotIndex: 0 as const, selectionScore: 80 },
      { playerId: pid('c'), playerVersionId: 'pv-c', slotIndex: 0 as const, selectionScore: 90 },
    ];
    const first = chooseAutopick(ROOT, 'duel', 'p1', 0, candidates);
    const second = chooseAutopick(ROOT, 'duel', 'p1', 0, candidates);
    expect(first).toEqual(second);
    expect(['a', 'b', 'c']).toContain(first.playerId);
    const many = Array.from({ length: 10 }, (_, i) => ({
      playerId: pid(`p-${String(i)}`),
      playerVersionId: `pv-${String(i).padStart(2, '0')}`,
      slotIndex: 0 as const,
      selectionScore: 100 - i,
    }));
    for (let ordinal = 0; ordinal < 20; ordinal += 1) {
      const picked = chooseAutopick(ROOT, 'duel', 'p1', ordinal, many);
      expect(picked.playerId).not.toBe('p-9');
      expect(picked.playerId).not.toBe('p-8');
    }
  });
  it('repeats sandbox autopicks until full then locks', () => {
    const pool = candidatePool();
    const picks = chooseSandboxAutopicksUntilFull(
      ROOT,
      'sandbox-shared-82',
      'p1',
      0,
      pool,
      createSandboxBuilder(),
    );
    expect(picks.length).toBe(5);
    let state = createSandboxBuilder();
    for (const pick of picks) {
      state = applySandboxBuilderCommand(state, pool, {
        kind: 'sandbox-place',
        playerId: pick.playerId,
        slotIndex: pick.slotIndex,
      });
    }
    state = applySandboxBuilderCommand(state, pool, { kind: 'sandbox-lock' });
    expect(state.locked).toBe(true);
  });
  it('uses the rootSeed/timeout-autopick/mode/participant/pickOrdinal path', () => {
    const candidates = [
      {
        playerId: pid('p-g1'),
        playerVersionId: 'pv-p-g1',
        slotIndex: 0 as const,
        selectionScore: 90,
      },
    ];
    const pick = chooseAutopick(ROOT, 'classic-shared-82', 'p2', 3, candidates);
    expect(pick.seedPath).toBe('rootSeed/timeout-autopick/classic-shared-82/p2/3');
  });
});
describe('shared82 linked gauntlets', () => {
  it('plays 82 per participant with one shared H2H result and unchanged opponents', () => {
    const bracket = buildFixtureBracket();
    const weakest = findWeakestOpponent(bracket);
    const h2h = h2hGameNumbersFor(bracket, weakest.opponentId);
    expect(h2h.length).toBeGreaterThanOrEqual(2);
    const p1Team = buildLegalSimulationTeam({ teamId: 'p1', displayName: 'P1' });
    const p2Team = buildLegalSimulationTeam({ teamId: 'p2', displayName: 'P2' });
    const profile: EraSimulationProfile = DEFAULT_ERA_SIM_PROFILE;
    const out = simulateShared82(
      { p1Team, p2Team, bracket, profile, rootSeed: ROOT, dataVersion: 'data-v1' },
      context,
    );
    expect(out.p1Games.length).toBe(82);
    expect(out.p2Games.length).toBe(82);
    expect(out.result.gamesPerParticipant).toBe(82);
    expect(out.uniqueSimulations).toBe(82 + 82 - h2h.length);
    expect(out.result.h2hGameNumbers).toEqual(h2h);
    expect(out.result.weakestReplacedOpponentId).toBe(weakest.opponentId);
    const remaining = bracket.opponents
      .map((o) => o.opponentId)
      .filter((id) => id !== weakest.opponentId);
    expect(remaining.length).toBe(29);
    for (const game of out.p1Games) {
      if (h2h.includes(game.gameNumber)) {
        expect(game.home.teamId).toBe('p1');
      }
    }
    expect(out.result.ranking.length).toBe(2);
    expect(out.result.tiebreakPath).toBe(FIXED_FIVE_TIEBREAK_PATH);
    const [a, b] = out.result.participants;
    expect((a?.wins ?? 0) + (a?.losses ?? 0)).toBe(82);
    expect((b?.wins ?? 0) + (b?.losses ?? 0)).toBe(82);
  });
  it('is byte-identical for the same seed and versions', () => {
    const bracket = buildFixtureBracket();
    const p1Team = buildLegalSimulationTeam({ teamId: 'p1', displayName: 'P1' });
    const p2Team = buildLegalSimulationTeam({ teamId: 'p2', displayName: 'P2' });
    const profile: EraSimulationProfile = DEFAULT_ERA_SIM_PROFILE;
    const first = simulateShared82(
      { p1Team, p2Team, bracket, profile, rootSeed: ROOT, dataVersion: 'data-v1' },
      context,
    );
    const second = simulateShared82(
      { p1Team, p2Team, bracket, profile, rootSeed: ROOT, dataVersion: 'data-v1' },
      context,
    );
    expect(JSON.stringify(first.result)).toBe(JSON.stringify(second.result));
  });
});
describe('duel series', () => {
  it('stops immediately at four wins and derives seeds per game', () => {
    const p1Team = buildLegalSimulationTeam({ teamId: 'p1', displayName: 'P1' });
    const p2Team = buildLegalSimulationTeam({ teamId: 'p2', displayName: 'P2' });
    const out = simulateDuelSeries(
      { p1Team, p2Team, profile: DEFAULT_ERA_SIM_PROFILE, rootSeed: ROOT, dataVersion: 'data-v1' },
      context,
    );
    expect(out.result.games.length).toBeGreaterThanOrEqual(4);
    expect(out.result.games.length).toBeLessThanOrEqual(7);
    expect([out.result.p1Wins, out.result.p2Wins].includes(4)).toBe(true);
    expect(out.result.stoppedAtGame).toBe(out.result.games.length);
    for (const game of out.result.games) {
      expect(game.seed).toBe(fixedFiveDuelGameSeed(ROOT, game.gameNumber));
    }
    const again = simulateDuelSeries(
      { p1Team, p2Team, profile: DEFAULT_ERA_SIM_PROFILE, rootSeed: ROOT, dataVersion: 'data-v1' },
      context,
    );
    expect(JSON.stringify(out.result)).toBe(JSON.stringify(again.result));
  });
});
describe('result digest', () => {
  it('reproduces byte-identical digests from the same inputs', () => {
    const p1Players = buildLegalSimulationTeam({ teamId: 'p1', displayName: 'P1' }).players;
    const p2Players = buildLegalSimulationTeam({ teamId: 'p2', displayName: 'P2' }).players;
    const lineups = {
      p1: {
        lineup: {
          structure: ['G', 'G', 'F', 'F', 'C'] as ['G', 'G', 'F', 'F', 'C'],
          assignments: p1Players.map((p, slotIndex) => ({
            slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
            playerId: p.playerId,
            positions: p.positions,
          })),
        },
        players: p1Players,
      },
      p2: {
        lineup: {
          structure: ['G', 'G', 'F', 'F', 'C'] as ['G', 'G', 'F', 'F', 'C'],
          assignments: p2Players.map((p, slotIndex) => ({
            slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
            playerId: p.playerId,
            positions: p.positions,
          })),
        },
        players: p2Players,
      },
    };
    const versions = {
      dataVersion: 'data-v1',
      ratingVersion: 'ratings-v1',
      positionNormalizationVersion: 'position-v3',
      engineVersion: 'engine-v1',
      bracketVersion: 'bracket-v1',
      scheduleVersion: 'schedule-v1',
      seedDerivationVersion: 'seed-v1',
      classicRollVersion: 'classic-roll-v1',
      profileVersion: 'profile-v1',
      multiplayerVersion: 'fixed-five-multiplayer-v1',
      autopickVersion: 'fixed-five-autopick-v1',
    };
    const bracket = buildFixtureBracket();
    const weakest = findWeakestOpponent(bracket);
    const payload = {
      rootSeed: ROOT,
      versions,
      lineups,
      acceptedCommands: [],
      result: {
        competition: 'shared-82' as const,
        gamesPerParticipant: 82 as const,
        uniqueSimulations: 161,
        weakestReplacedOpponentId: weakest.opponentId,
        h2hGameNumbers: [17, 72, 82],
        participants: [
          { participantId: 'p1' as const, wins: 60, losses: 22, differential: 100, h2hWins: 2 },
          { participantId: 'p2' as const, wins: 55, losses: 27, differential: 50, h2hWins: 1 },
        ],
        ranking: ['p1', 'p2'] as ['p1', 'p2'],
        tiebreakPath: FIXED_FIVE_TIEBREAK_PATH,
      },
    };
    expect(fixedFiveResultDigest(payload)).toBe(fixedFiveResultDigest(payload));
  });
  it('ignores governance commands so a late proposer still agrees (room d71f)', () => {
    const roomId = idSchema.parse('room-d71f');
    const draft: FixedFiveCommand[] = [
      {
        schemaVersion: 1,
        roomId,
        commandId: commandIdSchema.parse('cmd-start'),
        ordinal: 0,
        actorParticipantId: 'p2',
        payload: { kind: 'start' },
      },
      {
        schemaVersion: 1,
        roomId,
        commandId: commandIdSchema.parse('cmd-p1'),
        ordinal: 1,
        actorParticipantId: 'p2',
        payload: { kind: 'classic-pick', playerId: pid('p-g1'), slotIndex: 0 },
      },
      {
        schemaVersion: 1,
        roomId,
        commandId: commandIdSchema.parse('cmd-p2'),
        ordinal: 2,
        actorParticipantId: 'p2',
        payload: {
          kind: 'timeout-autopick',
          playerId: pid('p-g2'),
          slotIndex: 1,
          pickOrdinal: 1,
          seedPath: 'rootSeed/timeout-autopick/classic-shared-82/p2/1',
        },
      },
      {
        schemaVersion: 1,
        roomId,
        commandId: commandIdSchema.parse('cmd-p3'),
        ordinal: 3,
        actorParticipantId: 'p1',
        payload: { kind: 'reroll', axis: 'franchise' },
      },
      {
        schemaVersion: 1,
        roomId,
        commandId: commandIdSchema.parse('cmd-p4'),
        ordinal: 4,
        actorParticipantId: 'p1',
        payload: { kind: 'classic-pick', playerId: pid('p-f1'), slotIndex: 2 },
      },
    ];
    const governance: FixedFiveCommand[] = [
      {
        schemaVersion: 1,
        roomId,
        commandId: commandIdSchema.parse('cmd-ready'),
        ordinal: 5,
        actorParticipantId: 'p1',
        payload: { kind: 'ready', ready: true },
      },
      {
        schemaVersion: 1,
        roomId,
        commandId: commandIdSchema.parse('cmd-propose'),
        ordinal: 6,
        actorParticipantId: 'p2',
        payload: { kind: 'propose-result', resultDigest: contentHashSchema.parse('0'.repeat(64)) },
      },
      {
        schemaVersion: 1,
        roomId,
        commandId: commandIdSchema.parse('cmd-confirm'),
        ordinal: 7,
        actorParticipantId: 'p1',
        payload: {
          kind: 'confirm-result',
          resultDigest: contentHashSchema.parse('0'.repeat(64)),
          verified: true,
        },
      },
      {
        schemaVersion: 1,
        roomId,
        commandId: commandIdSchema.parse('cmd-rematch'),
        ordinal: 8,
        actorParticipantId: 'p1',
        payload: { kind: 'rematch-request' },
      },
      {
        schemaVersion: 1,
        roomId,
        commandId: commandIdSchema.parse('cmd-leave'),
        ordinal: 9,
        actorParticipantId: 'p2',
        payload: { kind: 'leave' },
      },
      {
        schemaVersion: 1,
        roomId,
        commandId: commandIdSchema.parse('cmd-remove'),
        ordinal: 10,
        actorParticipantId: 'p1',
        payload: { kind: 'remove-guest', targetParticipantId: 'p2' },
      },
    ];
    const p1Players = buildLegalSimulationTeam({ teamId: 'p1', displayName: 'P1' }).players;
    const digestOf = (acceptedCommands: FixedFiveCommand[]) =>
      fixedFiveResultDigest({
        rootSeed: ROOT,
        versions: {
          dataVersion: 'data-v1',
          ratingVersion: 'ratings-v1',
          positionNormalizationVersion: 'position-v3',
          engineVersion: 'engine-v1',
          bracketVersion: 'bracket-v1',
          scheduleVersion: 'schedule-v1',
          seedDerivationVersion: 'seed-v1',
          classicRollVersion: 'classic-roll-v1',
          profileVersion: 'profile-v1',
          multiplayerVersion: 'fixed-five-multiplayer-v1',
          autopickVersion: 'fixed-five-autopick-v1',
        },
        lineups: {
          p1: {
            lineup: {
              structure: ['G', 'G', 'F', 'F', 'C'] as ['G', 'G', 'F', 'F', 'C'],
              assignments: p1Players.map((p, slotIndex) => ({
                slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
                playerId: p.playerId,
                positions: p.positions,
              })),
            },
            players: p1Players,
          },
          p2: {
            lineup: {
              structure: ['G', 'G', 'F', 'F', 'C'] as ['G', 'G', 'F', 'F', 'C'],
              assignments: p1Players.map((p, slotIndex) => ({
                slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
                playerId: p.playerId,
                positions: p.positions,
              })),
            },
            players: p1Players,
          },
        },
        acceptedCommands,
        result: {
          competition: 'shared-82' as const,
          gamesPerParticipant: 82 as const,
          uniqueSimulations: 161,
          weakestReplacedOpponentId: 'bracket-magic',
          h2hGameNumbers: [17, 72, 82],
          participants: [
            { participantId: 'p1' as const, wins: 60, losses: 22, differential: 100, h2hWins: 2 },
            { participantId: 'p2' as const, wins: 55, losses: 27, differential: 50, h2hWins: 1 },
          ],
          ranking: ['p1', 'p2'] as ['p1', 'p2'],
          tiebreakPath: FIXED_FIVE_TIEBREAK_PATH,
        },
      });
    expect(digestOf(draft)).toBe(digestOf([...draft, ...governance]));
    const tampered: FixedFiveCommand[] = draft.map((command) =>
      command.ordinal === 4
        ? {
            schemaVersion: 1 as const,
            roomId,
            commandId: commandIdSchema.parse('cmd-p4'),
            ordinal: 4,
            actorParticipantId: 'p1' as const,
            payload: { kind: 'classic-pick' as const, playerId: pid('p-c1'), slotIndex: 2 },
          }
        : command,
    );
    expect(digestOf(draft)).not.toBe(digestOf(tampered));
  });
});
describe('classic safe moves', () => {
  it('enumerates feasible classic picks', () => {
    const catalog = classicCatalog();
    const byId = poolById(candidatePool());
    const seed = seedSchema.parse(seedFromString('classic-safe'));
    const state = createClassicDraft(
      { draftId: 'd', variant: 'ratings', seed, dataVersion: 'data-v1', catalog },
      context,
    );
    const moves = enumerateClassicSafeMoves(catalog, byId, state);
    expect(moves.length).toBeGreaterThan(0);
  });
});
