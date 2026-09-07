import { describe, expect, it } from 'vitest';
import {
  REQUIRED_RATING_KEYS,
  commandIdSchema,
  type SeasonRun,
  type SimulationRatings,
} from '@hoop-rush/data-contracts';
import { createInitialSponsorGearState } from '@hoop-rush/engine';
import {
  boostedRatingRows,
  boostedRatingsOf,
  formatBoostLine,
  gearPointsOf,
  playerSponsorCardOf,
  sponsorBoardHistoryOf,
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
});
