import { describe, expect, it } from 'vitest';
import type { Position } from '@hoop-rush/data-contracts';
import { validateSeasonRotation } from './rotation.ts';
import {
  recommendSeasonRotation,
  type AutoRotationMemberInput,
  type RecommendSeasonRotationInput,
} from './auto-rotation.ts';
import { buildMinimalRotation } from './rotation.ts';

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

function tenWithAnchor(): AutoRotationMemberInput[] {
  return [
    member(1, ['PG'], { overall: 84 }),
    member(2, ['SG'], { overall: 82 }),
    member(3, ['SF'], { overall: 83 }),
    member(4, ['PF'], { overall: 81 }),
    member(5, ['C'], { overall: 82 }),
    member(6, ['PG', 'SG'], { overall: 78 }),
    member(7, ['SG', 'SF'], { overall: 77 }),
    member(8, ['SF', 'PF'], { overall: 76 }),
    member(9, ['PF', 'C'], { overall: 75 }),
    member(10, ['C'], { overall: 55, foulRate: 85, usageRate: 32 }),
  ];
}

function baseInput(
  roster: AutoRotationMemberInput[],
  overrides: Partial<RecommendSeasonRotationInput> = {},
): RecommendSeasonRotationInput {
  const ten = roster.slice(0, 10).map((m) => ({
    playerVersionId: m.playerVersionId,
    playable: m.playable,
  }));
  return {
    franchiseId: 'lakers',
    roster,
    unavailable: [],
    current: buildMinimalRotation({ franchiseId: 'lakers', members: ten }),
    horizon: 6,
    seed: 'run-1-block-0-auto-rotation-dnp',
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

describe('auto-rotation allowDnp', () => {
  it('keeps legacy output byte-stable when allowDnp is off', () => {
    const roster = tenWithAnchor();
    const first = recommendSeasonRotation(baseInput(roster));
    const second = recommendSeasonRotation(baseInput(roster, { allowDnp: false }));
    expect(second.status).toBe('recommended');
    if (first.status !== 'recommended' || second.status !== 'recommended') return;
    expect(JSON.stringify(second.candidate)).toBe(JSON.stringify(first.candidate));
  });

  it('DNPs a weak high-foul bench anchor to 0 when better', () => {
    const roster = tenWithAnchor();
    const result = recommendSeasonRotation(baseInput(roster, { allowDnp: true }));
    expect(result.status).toBe('recommended');
    if (result.status !== 'recommended') throw new Error('expected recommended');
    const minutes = new Map(
      result.candidate.targetMinutes.map((row) => [row.playerVersionId, row.minutes]),
    );
    expect(minutes.get(pv(10))).toBe(0);
    const total = result.candidate.targetMinutes.reduce((sum, row) => sum + row.minutes, 0);
    expect(total).toBe(240);
    const active = [...result.candidate.starters, ...result.candidate.benchOrder];
    expect(validateSeasonRotation(result.candidate, playableOf(roster, active))).toEqual([]);
    expect(result.candidate.closingFive).not.toContain(pv(10));
    const dnpChange = result.changes.find(
      (change) => change.kind === 'minutes' && change.playerVersionId === pv(10),
    );
    expect(dnpChange?.kind).toBe('minutes');
    if (dnpChange === undefined || dnpChange.kind !== 'minutes') {
      throw new Error('expected minutes change');
    }
    expect(dnpChange.to).toBe(0);
    expect(dnpChange.reason).toMatch(/DNP-CD/);
  });

  it('improves quality without adding strain when DNP applies', () => {
    const roster = tenWithAnchor();
    const oldResult = recommendSeasonRotation(baseInput(roster));
    const newResult = recommendSeasonRotation(baseInput(roster, { allowDnp: true }));
    expect(oldResult.status).toBe('recommended');
    expect(newResult.status).toBe('recommended');
    if (oldResult.status !== 'recommended' || newResult.status !== 'recommended') return;
    expect(newResult.metrics.quality).toBeGreaterThan(oldResult.metrics.quality);
    expect(newResult.metrics.maxStarterStrainBp).toBeLessThanOrEqual(
      oldResult.metrics.maxStarterStrainBp,
    );
  });

  it('honours coach-excluded players as healthy scratches', () => {
    const roster = tenWithAnchor();
    const fifteen = [
      ...roster,
      member(11, ['PG'], { overall: 79 }),
      member(12, ['SG'], { overall: 78 }),
      member(13, ['SF'], { overall: 80 }),
      member(14, ['PF'], { overall: 77 }),
      member(15, ['C'], { overall: 78 }),
    ];
    const result = recommendSeasonRotation(
      baseInput(fifteen, { allowDnp: true, excluded: [pv(10)] }),
    );
    expect(result.status).toBe('recommended');
    if (result.status !== 'recommended') throw new Error('expected recommended');
    const active = [...result.candidate.starters, ...result.candidate.benchOrder];
    expect(active).not.toContain(pv(10));
    expect(result.facts.excludedCount).toBe(1);
  });

  it('never DNPs a closer and stays legal across seeds', () => {
    const roster = tenWithAnchor();
    for (let i = 0; i < 25; i += 1) {
      const seed = `run-1-block-0-dnp-seed-${String(i).padStart(3, '0')}`;
      const result = recommendSeasonRotation(baseInput(roster, { allowDnp: true, seed }));
      expect(result.status).toBe('recommended');
      if (result.status !== 'recommended') throw new Error(`seed ${seed} unavailable`);
      const active = [...result.candidate.starters, ...result.candidate.benchOrder];
      expect(validateSeasonRotation(result.candidate, playableOf(roster, active))).toEqual([]);
      for (const row of result.candidate.targetMinutes) {
        if (row.minutes === 0) {
          expect(result.candidate.closingFive).not.toContain(row.playerVersionId);
        }
      }
    }
  });
});
