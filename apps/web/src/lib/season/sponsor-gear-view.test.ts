import { describe, expect, it } from 'vitest';
import {
  REQUIRED_RATING_KEYS,
  commandIdSchema,
  type SeasonRun,
  type SimulationRatings,
} from '@hoop-rush/data-contracts';
import { createInitialSponsorGearState } from '@hoop-rush/engine';
import {
  SPONSOR_RATING_GROUPS,
  boostedOverallDeltaOf,
  boostedOverallDeltaForPlayer,
  boostedOverallForPlayer,
  boostedOverallOf,
  boostedRatingRows,
  boostedRatingsOf,
  formatBoostLine,
  gearPointsOf,
  playerSponsorCardOf,
  previewBoostedOverallOf,
  previewGearDeltas,
  sponsorBoardHistoryOf,
  sponsorHistorySummary,
  sponsorShopOf,
  sponsorSlotsOf,
  sponsorVaultOf,
  SPONSOR_RATING_SHORT_LABELS,
} from './sponsor-gear-view.ts';

const SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a0';

function testRun(): SeasonRun {
  return { sponsors: createInitialSponsorGearState(SEED) } as SeasonRun;
}

function baseRatings(): SimulationRatings {
  return Object.fromEntries(REQUIRED_RATING_KEYS.map((key) => [key, 70])) as SimulationRatings;
}

describe('sponsorShopOf', () => {
  it('deals five affordable cards with every slot covered', () => {
    const offers = sponsorShopOf(testRun(), 0, 8);
    expect(offers).toHaveLength(5);
    const slots = new Set(offers?.map((offer) => offer.slot));
    expect(slots).toEqual(new Set(['shoe', 'apparel', 'fuel']));
    for (const offer of offers ?? []) {
      expect(offer.state).toBe('available');
      expect(offer.affordable).toBe(true);
      expect(offer.boostLine).toMatch(/\+\d+ [A-Z]+/);
    }
  });

  it('marks unaffordable offers and returns null past block 7', () => {
    const offers = sponsorShopOf(testRun(), 0, 0);
    expect(offers?.some((offer) => !offer.affordable)).toBe(true);
    expect(sponsorShopOf(testRun(), 8, 8)).toBeNull();
    expect(sponsorShopOf(null, 0, 8)).toBeNull();
  });
});

describe('sponsorVaultOf', () => {
  it('starts empty and joins offers for display', () => {
    expect(sponsorVaultOf(testRun())).toEqual([]);
    expect(sponsorVaultOf(null)).toEqual([]);
  });
});

describe('slots, boosts, and gear points', () => {
  it('has no slots before anything is applied', () => {
    expect(sponsorSlotsOf(testRun(), 'pv-1')).toBeNull();
    expect(gearPointsOf(null)).toBe(0);
    expect(boostedRatingsOf(baseRatings(), testRun(), 'pv-1')).toEqual(baseRatings());
  });

  it('builds boosted rows with source lines', () => {
    const rows = boostedRatingRows(baseRatings(), {
      shoe: {
        instanceId: 'sponsor-0-0',
        entryId: 'nike-icon',
        brandFamily: 'nike',
        slot: 'shoe',
        tier: 'ICON',
        boosts: [{ key: 'speed', points: 4 }],
        appliedBlock: 0,
        appliedByCommandId: commandIdSchema.parse('cmd-1'),
      },
      apparel: null,
      fuel: null,
    });
    expect(rows).toHaveLength(13);
    const speed = rows.find((row) => row.key === 'speed');
    expect(speed?.boosted).toBe(74);
    expect(speed?.source).toBe('+4 nike ICON');
    expect(rows.find((row) => row.key === 'threePoint')?.source).toBeNull();
    expect(formatBoostLine([{ label: 'SPD', points: 4 }])).toBe('+4 SPD');
  });

  it('labels all thirteen boostable keys', () => {
    expect(Object.keys(SPONSOR_RATING_SHORT_LABELS)).toHaveLength(13);
  });

  it('groups all thirteen keys without overlap', () => {
    const grouped = SPONSOR_RATING_GROUPS.flatMap((group) => group.keys);
    expect(grouped).toHaveLength(13);
    expect(new Set(grouped).size).toBe(13);
  });

  it('previews before/after deltas for a vault candidate', () => {
    const deltas = previewGearDeltas(baseRatings(), null, {
      slot: 'shoe',
      boosts: [{ key: 'speed', points: 4 }],
    });
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ label: 'SPD', from: 70, to: 74, points: 4 });
  });

  it('returns the base overall when nothing is equipped', () => {
    expect(boostedOverallOf(82, baseRatings(), null, null)).toBe(82);
    expect(boostedOverallDeltaOf(82, baseRatings(), null, null)).toBeNull();
    expect(boostedOverallOf(null, baseRatings(), null, null)).toBeNull();
  });

  it('shifts the catalog overall by the formula delta once gear is on', () => {
    const slots = {
      shoe: {
        instanceId: 'sponsor-0-0',
        entryId: 'nike-icon',
        brandFamily: 'nike',
        slot: 'shoe' as const,
        tier: 'ICON' as const,
        boosts: [{ key: 'midrange' as const, points: 8 }],
        appliedBlock: 0,
        appliedByCommandId: commandIdSchema.parse('cmd-1'),
      },
      apparel: null,
      fuel: null,
    };
    expect(boostedOverallOf(82, baseRatings(), null, slots)).toBe(83);
    expect(boostedOverallDeltaOf(82, baseRatings(), null, slots)).toBe(1);
    expect(
      previewBoostedOverallOf(82, baseRatings(), null, null, {
        slot: 'shoe',
        boosts: [{ key: 'midrange', points: 8 }],
      }),
    ).toBe(83);
  });

  it('hides zero-deltas for boosts the overall formula ignores', () => {
    const slots = {
      shoe: {
        instanceId: 'sponsor-0-0',
        entryId: 'nike-icon',
        brandFamily: 'nike',
        slot: 'shoe' as const,
        tier: 'BUZZ' as const,
        boosts: [{ key: 'speed' as const, points: 2 }],
        appliedBlock: 0,
        appliedByCommandId: commandIdSchema.parse('cmd-1'),
      },
      apparel: null,
      fuel: null,
    };
    expect(boostedOverallDeltaOf(82, baseRatings(), null, slots)).toBeNull();
  });

  it('resolves per-player deltas from a run', () => {
    expect(
      boostedOverallDeltaForPlayer(testRun(), 'pv-1', {
        overall: 82,
        baseRatings: baseRatings(),
        tendencies: null,
      }),
    ).toBeNull();
    expect(
      boostedOverallForPlayer(testRun(), 'pv-1', {
        overall: null,
        baseRatings: baseRatings(),
        tendencies: null,
      }),
    ).toBeNull();
  });
});

describe('playerSponsorCardOf', () => {
  it('carries identity, ratings base, and empty slots', () => {
    const card = playerSponsorCardOf(testRun(), {
      playerVersionId: 'pv-1',
      displayName: 'Test Player',
      seasonKey: '1995-96',
      franchiseId: 'lakers',
      eraId: '1990s',
      playable: ['PG'],
      overall: 82,
      baseRatings: baseRatings(),
      tendencies: null,
      role: 'Starter',
      minutes: 34,
      fatigueLabel: null,
      fatiguePercent: null,
      lastMinutes: 33,
    });
    expect(card.displayName).toBe('Test Player');
    expect(card.slots).toBeNull();
    expect(card.gearPoints).toBe(0);
  });
});

describe('sponsorBoardHistoryOf', () => {
  it('summarizes bought and expired counts per block', () => {
    expect(sponsorBoardHistoryOf(testRun())).toEqual([{ blockIndex: 0, bought: 0, expired: 5 }]);
    expect(sponsorBoardHistoryOf(null)).toEqual([]);
  });

  it('compacts history into a one-line summary', () => {
    expect(sponsorHistorySummary([])).toBeNull();
    expect(sponsorHistorySummary([{ blockIndex: 0, bought: 0, expired: 5 }])).toBe('5 expired');
    expect(
      sponsorHistorySummary([
        { blockIndex: 0, bought: 2, expired: 3 },
        { blockIndex: 1, bought: 1, expired: 0 },
      ]),
    ).toBe('3 purchased · 3 expired');
  });
});
