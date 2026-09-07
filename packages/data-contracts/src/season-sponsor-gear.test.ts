import { describe, expect, it } from 'vitest';
import {
  buildEmptyPlayerSponsors,
  buildEmptySponsorBoards,
  buildEmptySponsorGearState,
  buildEmptySponsorVault,
  commandIdSchema,
  normalizeSponsorGearState,
  SEASON_SPONSOR_GEAR_CATALOG,
  SEASON_SPONSOR_GEAR_TIERS,
  SEASON_SPONSOR_SLOTS,
  seasonSponsorGearStateSchema,
  seasonSponsorsIndexSchema,
  sponsorGearEntriesFor,
  sponsorGearEntryOf,
  sponsorGearPriceOf,
  sponsorGearTierConfigOf,
  SEASON_SPONSOR_GEAR_VERSION,
  seasonInfluenceSourceSchema,
} from './index.ts';

describe('sponsor gear tiers', () => {
  it('prices 1/2/3 with weights summing to 100', () => {
    expect(sponsorGearPriceOf('BUZZ')).toBe(1);
    expect(sponsorGearPriceOf('PRIME')).toBe(2);
    expect(sponsorGearPriceOf('ICON')).toBe(3);
    const total =
      SEASON_SPONSOR_GEAR_TIERS.BUZZ.weight +
      SEASON_SPONSOR_GEAR_TIERS.PRIME.weight +
      SEASON_SPONSOR_GEAR_TIERS.ICON.weight;
    expect(total).toBe(100);
  });

  it('pool ranges widen and caps rise with tier', () => {
    const buzz = sponsorGearTierConfigOf('BUZZ');
    const prime = sponsorGearTierConfigOf('PRIME');
    const icon = sponsorGearTierConfigOf('ICON');
    expect([buzz.poolMin, buzz.poolMax]).toEqual([5, 8]);
    expect([prime.poolMin, prime.poolMax]).toEqual([9, 13]);
    expect([icon.poolMin, icon.poolMax]).toEqual([14, 18]);
    expect(buzz.singleKeyCap).toBeLessThan(prime.singleKeyCap);
    expect(prime.singleKeyCap).toBeLessThan(icon.singleKeyCap);
    for (const tier of [buzz, prime, icon]) {
      expect(tier.poolMin).toBeLessThanOrEqual(tier.poolMax);
      expect(tier.statMin).toBeGreaterThanOrEqual(1);
      expect(tier.statMax).toBeLessThanOrEqual(3);
    }
  });
});

describe('sponsor gear catalog', () => {
  it('ships 30 entries versioned as season-sponsor-gear-v1', () => {
    expect(SEASON_SPONSOR_GEAR_CATALOG).toHaveLength(30);
    for (const entry of SEASON_SPONSOR_GEAR_CATALOG) {
      expect(entry.version).toBe(SEASON_SPONSOR_GEAR_VERSION);
    }
  });

  it('covers every slot with 4 BUZZ / 3 PRIME / 3 ICON', () => {
    for (const slot of SEASON_SPONSOR_SLOTS) {
      expect(sponsorGearEntriesFor(slot, 'BUZZ')).toHaveLength(4);
      expect(sponsorGearEntriesFor(slot, 'PRIME')).toHaveLength(3);
      expect(sponsorGearEntriesFor(slot, 'ICON')).toHaveLength(3);
    }
  });

  it('keeps brand families unique across the whole catalog', () => {
    const families = SEASON_SPONSOR_GEAR_CATALOG.map((entry) => entry.brandFamily);
    expect(new Set(families).size).toBe(30);
    const ids = SEASON_SPONSOR_GEAR_CATALOG.map((entry) => entry.entryId);
    expect(new Set(ids).size).toBe(30);
  });

  it('gives every entry a non-empty weighted eligible set', () => {
    for (const entry of SEASON_SPONSOR_GEAR_CATALOG) {
      expect(entry.eligible.length).toBeGreaterThanOrEqual(1);
      const keys = entry.eligible.map((weight) => weight.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const weight of entry.eligible) {
        expect(weight.weight).toBeGreaterThan(0);
      }
    }
  });

  it('resolves entries by id and rejects unknowns', () => {
    expect(sponsorGearEntryOf('nike-icon').brandFamily).toBe('nike');
    expect(() => sponsorGearEntryOf('no-such-brand')).toThrow();
  });

  it('returns slot-tier entries in stable id order', () => {
    const entries = sponsorGearEntriesFor('fuel', 'ICON');
    const ids = entries.map((entry) => entry.entryId);
    expect(ids).toEqual([...ids].sort());
  });
});

describe('sponsor gear state', () => {
  it('builds empty vault, boards, and slots that parse', () => {
    expect(seasonSponsorGearStateSchema.parse(buildEmptySponsorGearState())).toEqual(
      buildEmptySponsorGearState(),
    );
    expect(buildEmptySponsorVault().items).toEqual([]);
    expect(buildEmptySponsorBoards().boards).toEqual([]);
    expect(buildEmptyPlayerSponsors().slots).toEqual({});
  });

  it('backfills missing state for old runs', () => {
    expect(normalizeSponsorGearState(undefined)).toEqual(buildEmptySponsorGearState());
    expect(normalizeSponsorGearState(null)).toEqual(buildEmptySponsorGearState());
    expect(normalizeSponsorGearState({ bogus: true })).toEqual(buildEmptySponsorGearState());
  });

  it('round-trips a populated state', () => {
    const state = buildEmptySponsorGearState();
    state.vault.items.push({
      instanceId: 'sponsor-0-0',
      entryId: 'nike-icon',
      acquiredBlock: 0,
      acquiredByCommandId: commandIdSchema.parse('cmd-00000000000000000000000000000001'),
    });
    expect(seasonSponsorGearStateSchema.parse(state)).toEqual(state);
  });

  it('caps the vault at 40 items', () => {
    const state = buildEmptySponsorGearState();
    for (let i = 0; i < 41; i += 1) {
      state.vault.items.push({
        instanceId: `vault-item-${String(i).padStart(2, '0')}`,
        entryId: 'nike-icon',
        acquiredBlock: 0,
        acquiredByCommandId: commandIdSchema.parse('cmd-00000000000000000000000000000001'),
      });
    }
    expect(seasonSponsorGearStateSchema.safeParse(state).success).toBe(false);
  });
});

describe('sponsor gear ledger and assets', () => {
  it('adds sponsor-purchase to the influence ledger sources', () => {
    expect(seasonInfluenceSourceSchema.parse('sponsor-purchase')).toBe('sponsor-purchase');
  });

  it('requires 30 logos in a packaged sponsors index', () => {
    const parsed = seasonSponsorsIndexSchema.safeParse({
      schemaVersion: 1,
      gearVersion: SEASON_SPONSOR_GEAR_VERSION,
      logos: [],
    });
    expect(parsed.success).toBe(false);
  });
});
