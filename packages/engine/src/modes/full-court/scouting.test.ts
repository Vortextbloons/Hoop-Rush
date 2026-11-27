import { describe, expect, it } from 'bun:test';
import type {
  CapRushSourcePlayer,
  Position,
  SimulationRatings,
  SimulationTendencies,
} from '@hoop-rush/data-contracts';
import {
  SIMULATION_RATINGS,
  SIMULATION_TENDENCIES,
  capRushSourcePlayerSchema,
  playerVersionId,
} from '@hoop-rush/data-contracts';
import {
  fullCourtFreePlayerReport,
  fullCourtLineupFitReport,
  fullCourtScoutPlayer,
  fullCourtUsageTier,
} from './scouting.ts';

function testPlayer(input: {
  readonly name: string;
  readonly overall?: number;
  readonly positions?: readonly Position[];
  readonly ratings?: Partial<SimulationRatings>;
  readonly tendencies?: Partial<SimulationTendencies>;
}): CapRushSourcePlayer {
  const playerId = `p-${input.name}`;
  return capRushSourcePlayerSchema.parse({
    playerId,
    playerVersionId: playerVersionId(playerId, 'lakers', '1990s', '1995-96'),
    displayName: input.name,
    franchiseId: 'lakers',
    eraId: '1990s',
    seasonKey: '1995-96',
    positions: input.positions ?? ['PG'],
    originalOverall: input.overall ?? 80,
    profile: {
      ratings: { ...SIMULATION_RATINGS, ...input.ratings },
      tendencies: { ...SIMULATION_TENDENCIES, ...input.tendencies },
    },
    physical: { heightInches: 78, weightLbs: 210 },
  });
}

describe('full court player scouting', () => {
  it('keeps free information separate from paid reads', () => {
    const player = testPlayer({ name: 'free-look', overall: 84 });
    const free = fullCourtFreePlayerReport(player);
    expect(free.tier).toBe('free');
    expect(free.displayName).toBe('free-look');
    expect(free.overall).toBe(84);
    expect(free.positions).toEqual(['PG']);
    expect(free.salaryDollars).toBeGreaterThan(0);
    expect(free).not.toHaveProperty('usage');
    expect(free).not.toHaveProperty('role');
    expect(free).not.toHaveProperty('limitations');
  });

  it('reads usage, complementary role, and limitations from catalog traits', () => {
    const creator = testPlayer({
      name: 'lead-guard',
      ratings: { threePoint: 42, insideScoring: 72 },
      tendencies: {
        usageRate: 31,
        passRate: 5,
        pickAndRollBallHandlerRate: 30,
        isolationRate: 6,
        threePointRate: 3,
        rimFrequency: 40,
        turnoverRate: 19,
      },
    });
    const report = fullCourtScoutPlayer(creator);
    expect(report.tier).toBe('paid');
    expect(report.usage.tier).toBe('heavy');
    expect(report.usage.onBallRate).toBe(36);
    expect(report.role.role).toBe('primary-creator');
    expect(report.role.complementaryRole).toBe('rim-runner');
    expect(report.role.evidence).toContainEqual({ field: 'usageRate', value: 31 });
    expect(report.strengths.map((finding) => finding.code)).toContain('rim-pressure');
    expect(report.limitations.map((finding) => finding.code)).toContain('no-three-point-range');
    expect(report.limitations.map((finding) => finding.code)).toContain('turnover-risk');
    expect(report.limitations.map((finding) => finding.code)).toContain('limited-playmaking');
    expect(report.shotProfile.find((zone) => zone.zone === 'rim')?.frequency).toBe(40);
  });

  it('identifies an off-ball spacer and its complementary fit', () => {
    const spacer = testPlayer({
      name: 'corner-spacer',
      ratings: { threePoint: 78 },
      tendencies: { usageRate: 10, passRate: 6, threePointRate: 45, spotUpRate: 30 },
    });
    const report = fullCourtScoutPlayer(spacer);
    expect(report.role.role).toBe('floor-spacer');
    expect(report.role.complementaryRole).toBe('floor-spacer');
    expect(report.strengths.map((finding) => finding.code)).toContain('elite-spacing');
    expect(report.limitations.map((finding) => finding.code)).toContain('low-usage');
  });

  it('keeps usage tiers on catalog-scale boundaries', () => {
    expect(fullCourtUsageTier(13.9)).toBe('low');
    expect(fullCourtUsageTier(14)).toBe('balanced');
    expect(fullCourtUsageTier(21)).toBe('high');
    expect(fullCourtUsageTier(26)).toBe('heavy');
  });
});

describe('full court lineup fit', () => {
  it('reports roster strengths and gaps with evidence', () => {
    const creators = [
      testPlayer({
        name: 'creator-a',
        tendencies: { usageRate: 30 },
        ratings: { threePoint: 70 },
      }),
      testPlayer({
        name: 'creator-b',
        tendencies: { usageRate: 26, threePointRate: 30 },
        ratings: { threePoint: 66, perimeterDefense: 70 },
      }),
    ];
    const support = [
      testPlayer({
        name: 'spacer-a',
        positions: ['SG'],
        ratings: { threePoint: 72, perimeterDefense: 70 },
        tendencies: { usageRate: 15, threePointRate: 32 },
      }),
      testPlayer({
        name: 'spacer-b',
        positions: ['SF'],
        ratings: { threePoint: 68, perimeterDefense: 68, defensiveRebound: 66 },
        tendencies: { usageRate: 16, threePointRate: 25 },
      }),
      testPlayer({
        name: 'anchor',
        positions: ['C'],
        ratings: { interiorDefense: 80, block: 78, defensiveRebound: 76 },
        tendencies: { usageRate: 12, threePointRate: 1, turnoverRate: 18 },
      }),
      testPlayer({
        name: 'bench',
        positions: ['PF'],
        ratings: { defensiveRebound: 70 },
        tendencies: { usageRate: 13, passRate: 14, turnoverRate: 18 },
      }),
    ];
    const report = fullCourtLineupFitReport([...support, ...creators]);
    expect(report.tier).toBe('paid');
    expect(report.rosterSize).toBe(6);
    expect(report.usageHierarchy[0]?.displayName).toBe('creator-a');
    expect(report.strengths.map((finding) => finding.code)).toContain('multiple-creators');
    expect(report.strengths.map((finding) => finding.code)).toContain('spacing-volume');
    expect(report.strengths.map((finding) => finding.code)).toContain('rim-protection');
    expect(report.gaps.map((finding) => finding.code)).toContain('thin-depth');
    expect(report.gaps.map((finding) => finding.code)).toContain('turnover-risk');
    expect(report.gaps.map((finding) => finding.code)).not.toContain('no-spacing');
  });

  it('flags an empty or one-dimensional roster without inventing results', () => {
    const empty = fullCourtLineupFitReport([]);
    expect(empty.gaps.map((finding) => finding.code)).toContain('no-primary-creator');
    expect(empty.gaps.map((finding) => finding.code)).toContain('no-spacing');
    expect(empty.gaps.map((finding) => finding.code)).toContain('no-rim-protection');
    expect(empty.gaps.map((finding) => finding.code)).toContain('no-perimeter-stopper');
    expect(empty.gaps.map((finding) => finding.code)).toContain('weak-defensive-glass');
    expect(empty.gaps.map((finding) => finding.code)).not.toContain('thin-depth');
    const one = fullCourtLineupFitReport([
      testPlayer({ name: 'only-player', ratings: { threePoint: 65 } }),
    ]);
    expect(one.gaps.map((finding) => finding.code)).toContain('thin-spacing');
  });

  it('sorts evidence by value and version id for a stable read', () => {
    const first = testPlayer({ name: 'a-creator', tendencies: { usageRate: 27 } });
    const second = testPlayer({ name: 'b-creator', tendencies: { usageRate: 31 } });
    const forward = fullCourtLineupFitReport([first, second]);
    const reversed = fullCourtLineupFitReport([second, first]);
    const forwardFinding = forward.strengths.find((entry) => entry.code === 'multiple-creators');
    const reversedFinding = reversed.strengths.find((entry) => entry.code === 'multiple-creators');
    expect(forwardFinding?.evidence.map((entry) => entry.value)).toEqual([31, 27]);
    expect(forwardFinding?.evidence).toEqual(reversedFinding?.evidence);
  });
});
