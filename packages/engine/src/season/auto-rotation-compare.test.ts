import { describe, expect, it } from 'vitest';
import type { Position } from '@hoop-rush/data-contracts';
import { buildMinimalRotation } from './rotation.ts';
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

function balancedFifteen(): AutoRotationMemberInput[] {
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

function anchorTen(): AutoRotationMemberInput[] {
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

function tiredTen(): AutoRotationMemberInput[] {
  return anchorTen().map((m, index) =>
    index < 5
      ? { ...m, fatigueBasisPoints: 4500, staminaRating: 62, recentLoadBasisPoints: 6000 }
      : m,
  );
}

function inputFor(
  roster: AutoRotationMemberInput[],
  seed: string,
  extra: Partial<RecommendSeasonRotationInput> = {},
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
    seed,
    scope: 'full',
    keepActive10: false,
    ...extra,
  };
}

describe('auto-rotation old vs new comparison', () => {
  it('quantifies allowDnp improvement across rosters and seeds', () => {
    const rosters: Array<{ name: string; roster: AutoRotationMemberInput[] }> = [
      { name: 'balanced-15', roster: balancedFifteen() },
      { name: 'anchor-10', roster: anchorTen() },
      { name: 'tired-10', roster: tiredTen() },
    ];
    let total = 0;
    let dnpApplied = 0;
    let qualityWins = 0;
    let qualityDeltaSum = 0;
    let riskDeltaSum = 0;
    let strainDeltaSum = 0;
    const perRoster = new Map<string, { n: number; dnp: number; qDelta: number }>();
    for (const { name, roster } of rosters) {
      perRoster.set(name, { n: 0, dnp: 0, qDelta: 0 });
      for (let i = 0; i < 40; i += 1) {
        const seed = `compare-${name}-${String(i).padStart(3, '0')}`;
        const oldResult = recommendSeasonRotation(inputFor(roster, seed));
        const newResult = recommendSeasonRotation(inputFor(roster, seed, { allowDnp: true }));
        expect(oldResult.status).toBe('recommended');
        expect(newResult.status).toBe('recommended');
        if (oldResult.status !== 'recommended' || newResult.status !== 'recommended') continue;
        const stats = perRoster.get(name);
        if (stats === undefined) throw new Error(`missing stats for ${name}`);
        total += 1;
        stats.n += 1;
        const qDelta = newResult.metrics.quality - oldResult.metrics.quality;
        qualityDeltaSum += qDelta;
        stats.qDelta += qDelta;
        riskDeltaSum += newResult.metrics.riskScore - oldResult.metrics.riskScore;
        strainDeltaSum +=
          newResult.metrics.maxStarterStrainBp - oldResult.metrics.maxStarterStrainBp;
        if (qDelta > 0) qualityWins += 1;
        const hasDnp = newResult.candidate.targetMinutes.some((row) => row.minutes === 0);
        if (hasDnp) {
          dnpApplied += 1;
          stats.dnp += 1;
        }
        expect(
          newResult.candidate.targetMinutes.reduce((sum, row) => sum + row.minutes, 0),
        ).toBe(240);
      }
    }
    const avgQ = qualityDeltaSum / Math.max(1, total);
    const avgR = riskDeltaSum / Math.max(1, total);
    const avgS = strainDeltaSum / Math.max(1, total);
    console.log(
      JSON.stringify(
        {
          total,
          dnpApplied,
          dnpRate: dnpApplied / Math.max(1, total),
          qualityWins,
          avgQualityDelta: avgQ,
          avgRiskDelta: avgR,
          avgStrainDeltaBp: avgS,
          perRoster: Object.fromEntries(
            [...perRoster.entries()].map(([name, stats]) => [
              name,
              {
                ...stats,
                dnpRate: stats.dnp / Math.max(1, stats.n),
                avgQDelta: stats.qDelta / Math.max(1, stats.n),
              },
            ]),
          ),
        },
        null,
        2,
      ),
    );
    expect(avgQ).toBeGreaterThanOrEqual(0);
    expect(avgS).toBeLessThanOrEqual(50);
    expect(dnpApplied).toBeGreaterThan(0);
  });
});
