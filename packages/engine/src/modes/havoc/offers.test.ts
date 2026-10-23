import { describe, expect, it } from 'bun:test';
import type {
  Position,
  SeasonDraftCandidate,
  SeasonDraftCatalog,
  Seed,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_OFFER_TARGET_RADIUS,
  PLAYER_VERSION_ID_VERSION,
  POSITION_NORMALIZATION_VERSION,
  RATINGS_VERSION,
  SEASON_DRAFT_CATALOG_VERSION,
  SEASON_DURABILITY_VERSION,
  SEASON_STAMINA_VERSION,
  havocClaimKeyOf,
  havocDraftCardSeed,
  havocDraftOfferSchema,
  playerIdSchema,
  playerVersionId,
  seasonDraftCatalogSchema,
  seasonDraftCandidateSchema,
  seasonKeySchema,
  seedFromString,
  seedSchema,
} from '@hoop-rush/data-contracts';
import { buildSeasonDraftCandidate } from '@hoop-rush/test-fixtures';
import { createRng } from '../../sim/rng.ts';
import { HavocCatalogCoverageError } from './api.ts';
import { AdaptHavocCatalog } from './catalog.ts';
import {
  HAVOC_TEST_RUN_SEED,
  buildHavocCatalogFixture,
  buildHavocCatalogSource,
  buildHavocEnvironmentFixture,
} from './havoc-test-support.ts';
import { havocMutationDefinitionOf } from './mutations.ts';
import { GenerateHavocOffer, drawHavocCardTier, enumerateHavocOverallWindows } from './offers.ts';

const fixture = buildHavocCatalogFixture();
const environment = buildHavocEnvironmentFixture(fixture.adapted);

const SLOT_ORDER: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

function testSeed(value: string): Seed {
  return seedSchema.parse(seedFromString(value));
}

function customCandidate(input: {
  readonly playerId: string;
  readonly seasonKey: string;
  readonly franchiseId: string;
  readonly index: number;
  readonly playable: readonly [Position, ...Position[]];
  readonly overall: number;
}): SeasonDraftCandidate {
  const base = buildSeasonDraftCandidate({
    franchiseId: input.franchiseId,
    eraId: '1990s',
    index: input.index,
  });
  return seasonDraftCandidateSchema.parse({
    ...base,
    playerId: playerIdSchema.parse(input.playerId),
    playerVersionId: playerVersionId(input.playerId, input.franchiseId, '1990s', input.seasonKey),
    seasonKey: seasonKeySchema.parse(input.seasonKey),
    displayName: input.playerId,
    positions: {
      primary: input.playable[0],
      secondary: [],
      playable: [...input.playable],
      normalizationVersion: base.positions.normalizationVersion,
    },
    summaryRatings: {
      overallRating: input.overall,
      offenseRating: input.overall,
      defenseRating: input.overall,
    },
  });
}

function customCatalog(candidates: readonly SeasonDraftCandidate[]): SeasonDraftCatalog {
  const first = candidates[0];
  if (first === undefined) throw new Error('custom catalog requires a candidate');
  return seasonDraftCatalogSchema.parse({
    schemaVersion: 1,
    catalogVersion: SEASON_DRAFT_CATALOG_VERSION,
    dataVersion: `m10-${RATINGS_VERSION}`,
    ratingsVersion: RATINGS_VERSION,
    positionNormalizationVersion: POSITION_NORMALIZATION_VERSION,
    playerVersionIdVersion: PLAYER_VERSION_ID_VERSION,
    staminaVersion: SEASON_STAMINA_VERSION,
    durabilityVersion: SEASON_DURABILITY_VERSION,
    pools: [
      {
        franchiseId: first.franchiseId,
        eraId: first.eraId,
        playerVersionIds: candidates.map((candidate) => candidate.playerVersionId),
      },
    ],
    candidates: [...candidates],
  });
}

function fillerClaims(): SeasonDraftCandidate[] {
  const slots: readonly [Position, ...Position[]][] = [
    ['SG', 'SF', 'PF', 'C'],
    ['SF', 'PF', 'C'],
    ['PF', 'C'],
    ['C'],
  ];
  return slots.map((playable, index) =>
    customCandidate({
      playerId: `p-fill-${String(index)}`,
      seasonKey: '1995-96',
      franchiseId: 'lakers',
      index: index + 10,
      playable,
      overall: 70,
    }),
  );
}

function generateOffer(overrides: {
  readonly runSeed?: Seed;
  readonly round?: number;
  readonly slot?: Position;
  readonly offerIndex?: number;
  readonly draftedClaimKeys?: readonly string[];
  readonly rerollUsed?: boolean;
  readonly catalog?: SeasonDraftCatalog;
}) {
  const adapted =
    overrides.catalog === undefined
      ? fixture.adapted
      : AdaptHavocCatalog(overrides.catalog, buildHavocCatalogSource(overrides.catalog));
  const offerEnvironment =
    overrides.catalog === undefined ? environment : buildHavocEnvironmentFixture(adapted);
  return GenerateHavocOffer(
    {
      catalog: adapted,
      runSeed: overrides.runSeed ?? HAVOC_TEST_RUN_SEED,
      round: overrides.round ?? 1,
      slot: overrides.slot ?? 'PG',
      offerIndex: overrides.offerIndex ?? 0,
      draftedClaimKeys: overrides.draftedClaimKeys ?? [],
      rerollUsed: overrides.rerollUsed ?? false,
    },
    offerEnvironment,
  );
}

function allTierClaims(): SeasonDraftCandidate[] {
  return Array.from({ length: 6 }, (_value, index) =>
    customCandidate({
      playerId: `p-weak-${String(index)}`,
      seasonKey: '1995-96',
      franchiseId: 'lakers',
      index: index + 20,
      playable: ['PG', 'SG', 'SF', 'PF', 'C'],
      overall: 1,
    }),
  );
}

describe('havoc offer generation', () => {
  it('generates a schema-valid, deterministic offer inside a target ±3 window', () => {
    const first = generateOffer({});
    const second = generateOffer({});
    expect(first).toEqual(second);
    expect(havocDraftOfferSchema.safeParse(first).success).toBe(true);
    expect(first.offerId).toMatch(/^hvo-[0-9a-f]{32}$/);
    expect(first.offerIndex).toBe(0);
    expect(first.round).toBe(1);
    expect(first.slot).toBe('PG');
    expect(first.cards).toHaveLength(3);
    const claimKeys = first.cards.map(
      (card) => `${card.source.playerId}::${card.source.seasonKey ?? ''}`,
    );
    expect(new Set(claimKeys).size).toBe(3);
    const overalls = first.cards.map((card) => card.source.originalOverall);
    expect(Math.max(...overalls) - Math.min(...overalls)).toBeLessThanOrEqual(
      2 * HAVOC_OFFER_TARGET_RADIUS,
    );
    first.cards.forEach((card, index) => {
      expect(card.cardId).toMatch(/^hvc-[0-9a-f]{32}$/);
      expect(card.offerId).toBe(first.offerId);
      expect(card.cardIndex).toBe(index);
      expect(card.slot).toBe('PG');
      expect(card.source.positions).toContain('PG');
      expect(card.mutations.length).toBeGreaterThan(0);
      expect(card.nickname.length).toBeGreaterThan(0);
      expect(card.effective.physical.baselineHeightInches).toBeGreaterThanOrEqual(60);
      expect(card.effective.physical.heightInches).toBeGreaterThanOrEqual(50);
      expect(card.effective.physical.heightInches).toBeLessThanOrEqual(108);
    });
  });

  it('enumerates ±3 integer target windows with clamped edges', () => {
    const low = enumerateHavocOverallWindows([[0], [1], [2], [100]]);
    expect(low.length).toBeGreaterThan(0);
    for (const window of low) {
      expect(window.minOverall).toBe(0);
      expect(window.maxOverall - window.minOverall).toBeLessThanOrEqual(
        2 * HAVOC_OFFER_TARGET_RADIUS,
      );
      expect(window.target).toBeGreaterThanOrEqual(window.minOverall);
      expect(window.target).toBeLessThanOrEqual(window.maxOverall);
    }
    expect(low.some((window) => window.target === 0)).toBe(true);

    const high = enumerateHavocOverallWindows([[97], [98], [99]]);
    expect(high.length).toBeGreaterThan(0);
    expect(
      high.some(
        (window) => window.target === 100 && window.minOverall === 97 && window.maxOverall === 100,
      ),
    ).toBe(true);

    expect(enumerateHavocOverallWindows([[0], [100]])).toEqual([]);
  });

  it('keeps every card playable at the drafted slot across all five rounds', () => {
    const drafted: string[] = [];
    for (let round = 1; round <= SLOT_ORDER.length; round += 1) {
      const slot = SLOT_ORDER[round - 1];
      if (slot === undefined) throw new Error('missing slot');
      const offer = generateOffer({ round, slot, draftedClaimKeys: drafted });
      for (const card of offer.cards) {
        expect(card.slot).toBe(slot);
        expect(card.source.positions).toContain(slot);
      }
      const first = offer.cards[0];
      if (first === undefined) throw new Error('empty offer');
      drafted.push(havocClaimKeyOf(first.source.playerId, first.source.seasonKey ?? '1995-96'));
    }
  });

  it('rejects reroll offer indexes without the draft-wide reroll', () => {
    expect(() => generateOffer({ offerIndex: 1, rerollUsed: false })).toThrow(/reroll/);
    const rerolled = generateOffer({ offerIndex: 1, rerollUsed: true });
    expect(rerolled.offerIndex).toBe(1);
    expect(rerolled.cards).toHaveLength(3);
  });

  it('allows two seasons of one person but only one variant of one person-season', () => {
    const catalog = customCatalog([
      customCandidate({
        playerId: 'p-shared',
        seasonKey: '1995-96',
        franchiseId: 'lakers',
        index: 0,
        playable: ['PG'],
        overall: 70,
      }),
      customCandidate({
        playerId: 'p-shared',
        seasonKey: '1995-96',
        franchiseId: 'celtics',
        index: 1,
        playable: ['PG'],
        overall: 70,
      }),
      customCandidate({
        playerId: 'p-shared',
        seasonKey: '1996-97',
        franchiseId: 'lakers',
        index: 2,
        playable: ['PG'],
        overall: 70,
      }),
      customCandidate({
        playerId: 'p-other',
        seasonKey: '1995-96',
        franchiseId: 'bulls',
        index: 3,
        playable: ['PG'],
        overall: 71,
      }),
      customCandidate({
        playerId: 'p-extra',
        seasonKey: '1995-96',
        franchiseId: 'warriors',
        index: 4,
        playable: ['PG'],
        overall: 72,
      }),
      ...fillerClaims(),
    ]);
    const seasonClaim = havocClaimKeyOf('p-shared', '1995-96');
    const otherClaim = havocClaimKeyOf('p-shared', '1996-97');
    const offer = generateOffer({
      catalog,
      draftedClaimKeys: [havocClaimKeyOf('p-extra', '1995-96')],
    });
    const sharedCards = offer.cards.filter(
      (card) => havocClaimKeyOf(card.source.playerId, card.source.seasonKey ?? '') === seasonClaim,
    );
    const otherCards = offer.cards.filter(
      (card) => havocClaimKeyOf(card.source.playerId, card.source.seasonKey ?? '') === otherClaim,
    );
    expect(sharedCards).toHaveLength(1);
    expect(otherCards).toHaveLength(1);
    const versions = new Set(sharedCards.map((card) => card.source.playerVersionId));
    expect(versions.size).toBe(1);
    expect([...versions][0]).toBeDefined();
  });

  it('excludes every traded variant of a drafted person-season', () => {
    const catalog = customCatalog([
      customCandidate({
        playerId: 'p-shared',
        seasonKey: '1995-96',
        franchiseId: 'lakers',
        index: 0,
        playable: ['PG'],
        overall: 70,
      }),
      customCandidate({
        playerId: 'p-shared',
        seasonKey: '1995-96',
        franchiseId: 'celtics',
        index: 1,
        playable: ['PG'],
        overall: 70,
      }),
      customCandidate({
        playerId: 'p-shared',
        seasonKey: '1996-97',
        franchiseId: 'lakers',
        index: 2,
        playable: ['PG'],
        overall: 70,
      }),
      customCandidate({
        playerId: 'p-other',
        seasonKey: '1995-96',
        franchiseId: 'bulls',
        index: 3,
        playable: ['PG'],
        overall: 71,
      }),
      customCandidate({
        playerId: 'p-extra',
        seasonKey: '1995-96',
        franchiseId: 'warriors',
        index: 4,
        playable: ['PG'],
        overall: 72,
      }),
      ...fillerClaims(),
    ]);
    for (let index = 0; index < 12; index += 1) {
      const offer = generateOffer({
        catalog,
        draftedClaimKeys: [havocClaimKeyOf('p-shared', '1995-96')],
        runSeed: testSeed(`havoc-claim-test-${String(index)}`),
      });
      expect(offer.cards).toHaveLength(3);
      for (const card of offer.cards) {
        const claim = havocClaimKeyOf(card.source.playerId, card.source.seasonKey ?? '');
        expect(claim).not.toBe(havocClaimKeyOf('p-shared', '1995-96'));
      }
      expect(
        offer.cards.some(
          (card) =>
            havocClaimKeyOf(card.source.playerId, card.source.seasonKey ?? '') ===
            havocClaimKeyOf('p-shared', '1996-97'),
        ),
      ).toBe(true);
    }
  });

  it('raises HavocCatalogCoverageError instead of relaxing positions', () => {
    const lonePg = customCatalog([
      customCandidate({
        playerId: 'p-lone-pg',
        seasonKey: '1995-96',
        franchiseId: 'lakers',
        index: 0,
        playable: ['PG'],
        overall: 70,
      }),
      ...fillerClaims(),
    ]);
    let caught: unknown;
    try {
      generateOffer({ catalog: lonePg });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HavocCatalogCoverageError);
    if (caught instanceof HavocCatalogCoverageError) {
      expect(caught.code).toBe('catalog-coverage');
      expect(caught.slot).toBe('PG');
    }
  });

  it('raises HavocCatalogCoverageError when remaining positions cannot complete', () => {
    const pgOnly = customCatalog([
      customCandidate({
        playerId: 'p-pg-a',
        seasonKey: '1995-96',
        franchiseId: 'lakers',
        index: 0,
        playable: ['PG'],
        overall: 70,
      }),
      customCandidate({
        playerId: 'p-pg-b',
        seasonKey: '1995-96',
        franchiseId: 'lakers',
        index: 1,
        playable: ['PG'],
        overall: 71,
      }),
      customCandidate({
        playerId: 'p-pg-c',
        seasonKey: '1995-96',
        franchiseId: 'lakers',
        index: 2,
        playable: ['PG'],
        overall: 72,
      }),
    ]);
    expect(() => generateOffer({ catalog: pgOnly })).toThrow(HavocCatalogCoverageError);
  });

  it('keeps tier and mutation packages independent of candidate identity and strength', () => {
    const weak = customCatalog(allTierClaims());
    const offerA = generateOffer({});
    const offerB = generateOffer({ catalog: weak });
    for (let cardIndex = 0; cardIndex < 3; cardIndex += 1) {
      const cardA = offerA.cards[cardIndex];
      const cardB = offerB.cards[cardIndex];
      if (cardA === undefined || cardB === undefined) throw new Error('missing card');
      expect(cardB.tier).toBe(cardA.tier);
      expect(cardB.mutations).toEqual(cardA.mutations);
    }
  });

  it('draws Growth Spurt samples inside 6..12 inches', () => {
    let sawGrowthSpurt = false;
    for (let index = 0; index < 40; index += 1) {
      const offer = generateOffer({ runSeed: testSeed(`havoc-growth-${String(index)}`) });
      for (const card of offer.cards) {
        for (const entry of card.mutations) {
          if (entry.mutationId !== 'growth-spurt') continue;
          sawGrowthSpurt = true;
          const delta = entry.sampledHeightDelta ?? 0;
          expect(delta).toBeGreaterThanOrEqual(6);
          expect(delta).toBeLessThanOrEqual(12);
          expect(card.effective.physical.heightInches).toBe(
            Math.min(108, card.effective.physical.baselineHeightInches + delta),
          );
        }
      }
    }
    expect(sawGrowthSpurt).toBe(true);
  });

  it('generates forced all-tier-1, all-tier-2, and all-tier-3 boards', () => {
    for (const tier of [1, 2, 3] as const) {
      let runSeed: Seed | null = null;
      for (let index = 0; index < 20_000 && runSeed === null; index += 1) {
        const candidate = testSeed(`havoc-forced-tier-${String(tier)}-${String(index)}`);
        let all = true;
        for (let cardIndex = 0; cardIndex < 3; cardIndex += 1) {
          const rng = createRng(havocDraftCardSeed(candidate, 1, 0, cardIndex, 'tier'));
          if (drawHavocCardTier(rng) !== tier) {
            all = false;
            break;
          }
        }
        if (all) runSeed = candidate;
      }
      expect(runSeed).not.toBeNull();
      const offer = generateOffer({ runSeed: runSeed ?? HAVOC_TEST_RUN_SEED });
      for (const card of offer.cards) {
        expect(card.tier).toBe(tier);
        if (tier === 1) {
          expect(card.mutations).toHaveLength(3);
          for (const entry of card.mutations) {
            expect(havocMutationDefinitionOf(entry.mutationId).tier).toBe(1);
          }
        } else if (tier === 2) {
          expect(card.mutations).toHaveLength(2);
          const tiers = card.mutations.map(
            (entry) => havocMutationDefinitionOf(entry.mutationId).tier,
          );
          expect(tiers.filter((value) => value === 2)).toHaveLength(1);
          expect(tiers.filter((value) => value === 1)).toHaveLength(1);
        } else {
          expect(card.mutations).toHaveLength(1);
          const single = card.mutations[0];
          if (single === undefined) throw new Error('missing tier-3 mutation');
          expect(havocMutationDefinitionOf(single.mutationId).tier).toBe(3);
        }
      }
    }
  });
});

describe('havoc tier distribution', () => {
  it('draws 60/30/10 over a fixed 100,000-card cohort within one percentage point', () => {
    const counts = { 1: 0, 2: 0, 3: 0 };
    const total = 100_000;
    for (let index = 0; index < total; index += 1) {
      const runSeed = testSeed(`havoc-tier-cohort-${String(index)}`);
      const rng = createRng(havocDraftCardSeed(runSeed, 1, 0, 0, 'tier'));
      counts[drawHavocCardTier(rng)] += 1;
    }
    expect(counts[1] / total).toBeGreaterThan(0.59);
    expect(counts[1] / total).toBeLessThan(0.61);
    expect(counts[2] / total).toBeGreaterThan(0.29);
    expect(counts[2] / total).toBeLessThan(0.31);
    expect(counts[3] / total).toBeGreaterThan(0.09);
    expect(counts[3] / total).toBeLessThan(0.11);
    expect(counts[1] + counts[2] + counts[3]).toBe(total);
  });
});
