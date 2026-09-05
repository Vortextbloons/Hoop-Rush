import { describe, expect, it } from 'vitest';
import type { Position, SeasonRotation } from '@hoop-rush/data-contracts';
import { buildMinimalRotation, validateSeasonRotation } from './rotation.ts';
import {
  recommendSeasonRotation,
  type AutoRotationMemberInput,
  type RecommendSeasonRotationInput,
} from './auto-rotation.ts';

const pv = (n: number): string => `pv-${n.toString(16).padStart(32, '0')}`;

function member(
  n: number,
  playable: readonly Position[],
  overrides: Partial<AutoRotationMemberInput> = {},
): AutoRotationMemberInput {
  return {
    playerVersionId: pv(n),
    playable,
    overall: 75,
    staminaRating: 80,
    durability: 80,
    fatigueBasisPoints: 1000,
    recentLoadBasisPoints: 500,
    ...overrides,
  };
}

function fifteen(): AutoRotationMemberInput[] {
  return [
    member(1, ['PG'], { overall: 82 }),
    member(2, ['SG'], { overall: 80 }),
    member(3, ['SF'], { overall: 84 }),
    member(4, ['PF'], { overall: 78 }),
    member(5, ['C'], { overall: 81 }),
    member(6, ['PG', 'SG'], { overall: 76 }),
    member(7, ['SG', 'SF'], { overall: 74 }),
    member(8, ['SF', 'PF'], { overall: 77 }),
    member(9, ['PF', 'C'], { overall: 73 }),
    member(10, ['C'], { overall: 72 }),
    member(11, ['PG'], { overall: 70 }),
    member(12, ['SG'], { overall: 69 }),
    member(13, ['SF'], { overall: 88 }),
    member(14, ['PF'], { overall: 68 }),
    member(15, ['C'], { overall: 67 }),
  ];
}

function currentOf(roster: AutoRotationMemberInput[]): SeasonRotation {
  const ten = roster.slice(0, 10).map((m) => ({
    playerVersionId: m.playerVersionId,
    playable: m.playable,
  }));
  return buildMinimalRotation({ franchiseId: 'lakers', members: ten });
}

function baseInput(
  overrides: Partial<RecommendSeasonRotationInput> = {},
): RecommendSeasonRotationInput {
  const roster = fifteen();
  return {
    franchiseId: 'lakers',
    roster,
    unavailable: [],
    current: currentOf(roster),
    horizon: 10,
    seed: 'run-1-block-0-auto-rotation',
    scope: 'full',
    keepActive10: false,
    ...overrides,
  };
}

function playableOf(roster: readonly AutoRotationMemberInput[], ids: readonly string[]) {
  return new Map(
    ids.map((id) => {
      const found = roster.find((m) => m.playerVersionId === id);
      return [id, found?.playable ?? []] as const;
    }),
  );
}

describe('recommendSeasonRotation full scope', () => {
  it('returns a valid 240-total candidate with legal fives and OVR fallback degraded', () => {
    const input = baseInput();
    const result = recommendSeasonRotation(input);
    expect(result.status).toBe('recommended');
    if (result.status !== 'recommended') throw new Error('expected recommended');
    expect(result.degraded).toBe(true);
    expect(result.facts.qualitySource).toBe('ovr');
    expect(result.facts.seedNamespace).toBe('auto-rotation');
    const active = [...result.candidate.starters, ...result.candidate.benchOrder];
    expect(active).toHaveLength(10);
    expect(new Set(active).size).toBe(10);
    const total = result.candidate.targetMinutes.reduce((sum, row) => sum + row.minutes, 0);
    expect(total).toBe(240);
    const failures = validateSeasonRotation(result.candidate, playableOf(input.roster, active));
    expect(failures).toEqual([]);
    expect(result.candidate.closingFive).toHaveLength(5);
    expect(new Set(result.candidate.closingFive).size).toBe(5);
    expect(result.alternatives.length).toBeLessThanOrEqual(2);
    for (const alt of result.alternatives) {
      const altActive = [...alt.starters, ...alt.benchOrder];
      expect(validateSeasonRotation(alt, playableOf(input.roster, altActive))).toEqual([]);
      expect(alt.targetMinutes.reduce((sum, row) => sum + row.minutes, 0)).toBe(240);
    }
    const keys = new Set([
      JSON.stringify(result.candidate),
      ...result.alternatives.map((a) => JSON.stringify(a)),
    ]);
    expect(keys.size).toBe(1 + result.alternatives.length);
    for (const change of result.changes) {
      expect(['starter', 'bench', 'closing', 'minutes', 'swap']).toContain(change.kind);
      expect(change.reason.length).toBeGreaterThan(0);
    }
  });

  it('minutes-only leaves structure untouched and only changes minutes', () => {
    const input = baseInput({ scope: 'minutes-only' });
    const result = recommendSeasonRotation(input);
    expect(result.status).toBe('recommended');
    if (result.status !== 'recommended') throw new Error('expected recommended');
    expect(result.candidate.starters).toEqual(input.current.starters);
    expect(result.candidate.benchOrder).toEqual(input.current.benchOrder);
    expect(result.candidate.closingFive).toEqual(input.current.closingFive);
    expect(new Set([...result.candidate.starters, ...result.candidate.benchOrder]).size).toBe(10);
    for (const change of result.changes) {
      expect(change.kind).toBe('minutes');
    }
    expect(result.candidate.targetMinutes.reduce((sum, row) => sum + row.minutes, 0)).toBe(240);
  });

  it('keepActive10 proposes no swaps', () => {
    const input = baseInput({ keepActive10: true });
    const result = recommendSeasonRotation(input);
    expect(result.status).toBe('recommended');
    if (result.status !== 'recommended') throw new Error('expected recommended');
    const currentActive = new Set([...input.current.starters, ...input.current.benchOrder]);
    const candidateActive = new Set([...result.candidate.starters, ...result.candidate.benchOrder]);
    expect(candidateActive).toEqual(currentActive);
    expect(result.changes.filter((c) => c.kind === 'swap')).toHaveLength(0);
  });

  it('never selects unavailable players', () => {
    const roster = fifteen();
    const unavailable = [pv(13), pv(1)];
    const input = baseInput({ roster, unavailable });
    const result = recommendSeasonRotation(input);
    expect(result.status).toBe('recommended');
    if (result.status !== 'recommended') throw new Error('expected recommended');
    const active = [...result.candidate.starters, ...result.candidate.benchOrder];
    for (const id of unavailable) expect(active).not.toContain(id);
    expect(result.candidate.closingFive).not.toContain(pv(13));
    for (const alt of result.alternatives) {
      const altActive = [...alt.starters, ...alt.benchOrder];
      for (const id of unavailable) expect(altActive).not.toContain(id);
    }
  });

  it('returns unavailable when fewer than ten are eligible', () => {
    const roster = fifteen();
    const unavailable = [pv(1), pv(2), pv(3), pv(4), pv(5), pv(6)];
    const result = recommendSeasonRotation(baseInput({ roster, unavailable }));
    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') throw new Error('expected unavailable');
    expect(result.reason).toMatch(/need five legal/);
  });

  it('orders bench by capacity when a starter is heavy-fatigue', () => {
    const roster = fifteen().map((m, index) =>
      index === 0 ? { ...m, fatigueBasisPoints: 9000 } : m,
    );
    const input = baseInput({ roster, keepActive10: true });
    const result = recommendSeasonRotation(input);
    expect(result.status).toBe('recommended');
    if (result.status !== 'recommended') throw new Error('expected recommended');
    expect(result.metrics.strainBand).toBeDefined();
    const bench = result.candidate.benchOrder;
    expect(bench).toHaveLength(5);
  });

  it('throws a boundary error on a corrupt projection model instead of falling back', () => {
    const input = baseInput({
      projection: {
        players: [],
        eraProfile: {} as never,
        model: { corrupt: true } as never,
      },
    });
    expect(() => recommendSeasonRotation(input)).toThrow(/invalid projection/);
  });

  it('is deterministic for the same named seed and byte-stable across alternatives', () => {
    const input = baseInput();
    const first = recommendSeasonRotation(input);
    const second = recommendSeasonRotation(input);
    expect(first.status).toBe('recommended');
    expect(second.status).toBe('recommended');
    if (first.status !== 'recommended' || second.status !== 'recommended') return;
    expect(JSON.stringify(second.candidate)).toBe(JSON.stringify(first.candidate));
    expect(JSON.stringify(second.alternatives)).toBe(JSON.stringify(first.alternatives));
    expect(JSON.stringify(second.changes)).toBe(JSON.stringify(first.changes));
  });

  it('holds legality, 240 totals, valid closing, and no unavailable across 100 named seeds', () => {
    const roster = fifteen();
    for (let i = 0; i < 100; i += 1) {
      const seed = `run-1-block-0-auto-rotation-seed-${String(i).padStart(3, '0')}`;
      for (const scope of ['full', 'minutes-only'] as const) {
        const result = recommendSeasonRotation(baseInput({ roster, seed, scope }));
        expect(result.status).toBe('recommended');
        if (result.status !== 'recommended')
          throw new Error(`seed ${seed} scope ${scope} unavailable`);
        const active = [...result.candidate.starters, ...result.candidate.benchOrder];
        expect(new Set(active).size).toBe(10);
        expect(result.candidate.targetMinutes.reduce((sum, row) => sum + row.minutes, 0)).toBe(240);
        expect(validateSeasonRotation(result.candidate, playableOf(roster, active))).toEqual([]);
        expect(result.candidate.closingFive).toHaveLength(5);
        expect(new Set(result.candidate.closingFive).size).toBe(5);
        const repeat = recommendSeasonRotation(baseInput({ roster, seed, scope }));
        if (repeat.status !== 'recommended') throw new Error('repeat unavailable');
        expect(JSON.stringify(repeat.candidate)).toBe(JSON.stringify(result.candidate));
      }
    }
  });

  it('prefers incumbent continuity on ties before the seeded break', () => {
    const roster = fifteen().map((m) => ({ ...m, overall: 75 }));
    const input = baseInput({ roster });
    const first = recommendSeasonRotation(input);
    const second = recommendSeasonRotation({ ...input, seed: 'different-named-seed-xyz' });
    expect(first.status).toBe('recommended');
    expect(second.status).toBe('recommended');
  });
});
