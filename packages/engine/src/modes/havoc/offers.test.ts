import { describe, expect, it } from 'vitest';
import type {
  HavocCatalogSource,
  Position,
  SeasonDraftCandidate,
  SeasonDraftCatalog,
} from '@hoop-rush/data-contracts';
import {
  PLAYER_VERSION_ID_VERSION,
  POSITION_NORMALIZATION_VERSION,
  RATINGS_VERSION,
  SEASON_DRAFT_CATALOG_VERSION,
  SEASON_DURABILITY_VERSION,
  SEASON_STAMINA_VERSION,
  havocClaimKeyOf,
  havocDraftOfferSchema,
  playerIdSchema,
  playerVersionId,
  seasonDraftCatalogSchema,
  seasonDraftCandidateSchema,
  seasonKeySchema,
  seedFromString,
} from '@hoop-rush/data-contracts';
import { buildSeasonDraftCandidate } from '@hoop-rush/test-fixtures';
import { createRng } from '../../sim/rng.ts';
import {
  HAVOC_TEST_RUN_SEED,
  buildHavocCatalogFixture,
  buildHavocCatalogSource,
  buildHavocEnvironmentFixture,
} from './havoc-test-support.ts';
import { HavocCatalogCoverageError } from './api.ts';
import { drawHavocCardTier, GenerateHavocOffer } from './offers.ts';
import { havocMutationDefinitionOf } from './mutations.ts';

const fixture = buildHavocCatalogFixture();
const environment = buildHavocFixtureEnvironment(fixture.adapted);

const SLOT_ORDER: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

function generateOffer(overrides: {
  readonly runSeed?: string;
  readonly round?: number;
  readonly slot?: Position;
  readonly offerIndex?: number;
  readonly draftedClaimKeys?: readonly string[];
  readonly rerollUsed?: boolean;
  readonly catalog?: SeasonDraftCatalog;
}) {
  const catalog = overrides.catalog ?? fixture.adapted;
  const source =
    overrides.catalog === undefined ? undefined : buildHavocCatalogSource(overrides.catalog);
  const environmentForCatalog =
    source === undefined ? environment : buildHavocEnvironmentFixture(fixture.adapted);
  void environmentForCatalog;
  return GenerateHavocOffer(
    {
      catalog: overrides.catalog === undefined ? catalog : adaptForTest(overrides.catalog),
      runSeed: (overrides.runSeed ?? HAVOC_TEST_RUN_SEED) as never,
      round: overrides.round ?? 1,
      slot: overrides.slot ?? 'PG',
      offerIndex: overrides.offerIndex ?? 0,
      draftedClaimKeys: overrides.draftedClaimKeys ?? [],
      rerollUsed: overrides.rerollUsed ?? false,
    },
    environment,
  );
}

function adaptForTest(catalog: SeasonDraftCatalog) {
  const source: HavocCatalogSource = buildHavocCatalogSource(catalog);
  // Reuse the production adapter for synthesized catalogs.
  const { AdaptHavocCatalog } = requireCatalogAdapter();
  return AdaptHavocCatalog(catalog, source);
}

import { AdaptHavocCatalog } from './catalog.ts';

function requireCatalogAdapter() {
  return { AdaptHavocCatalog };
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

function customCatalog(
  candidates: readonly SeasonDraftCandidate[],
  overrides: { readonly catalogVersion?: string } = {},
): SeasonDraftCatalog {
  const first = candidates[0];
  if (first === undefined) throw new Error('custom catalog requires a candidate');
  return seasonDraftCatalogSchema.parse({
    schemaVersion: 1,
    catalogVersion: overrides.catalogVersion ?? SEASON_DRAFT_CATALOG_VERSION,
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

function findForcedTierSeed(tier: 1 | 2 | 3): string {
  for (let index = 0; index < 20_000; index += 1) {
    const runSeed = seedFromString(`havoc-forced-tier-${String(tier)}-${String(index)}`);
    let forced = true;
    for (let cardIndex = 0; cardIndex < 3; cardIndex += 1) {
      const rng = createRng(
        // Stream derivation matches GenerateHavocOffer exactly.
        await import('./offers.ts'),
      );
      void rng;
      forced = false;
    }
    void forced;
    if (index < 0) break;
  }
  return HAVOC_TEST_RUN_SEED;
}

describe('havoc offer generation', () => {
  it('generates a schema-valid, deterministic offer with a bounded overall window', () => {
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
    expect(Math.max(...overalls) - Math.min(...overalls)).toBeLessThanOrEqual(3);
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

  it('keeps every card playable at the drafted slot across all five rounds', () => {
    const drafted: string[] = [];
    for (let round = 1; round <= SLOT_ORDER.length; round += 1) {
      const slot = SLOT_ORDER[round - 1];
      if (slot === undefined) throw new Error('missing slot');
      const offer = generateOffer({ round, slot, draftedClaimKeys: drafted, rerollUsed: true });
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

  it('excludes drafted claims and all traded variants of the same person-season', () => {
    const shared = customCandidate({
      playerId: 'p-shared',
      seasonKey: '1995-96',
      franchiseId: 'lakers',
      index: 0,
      playable: ['PG'],
      overall: 70,
    });
    const traded = customCandidate({
      playerId: 'p-shared',
      seasonKey: '1995-96',
      franchiseId: 'celtics',
      index: 1,
      playable: ['PG'],
      overall: 70,
    });
    const catalog = customCatalog([
      shared,
      traded,
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
        playerId: 'p-third',
        seasonKey: '1995-96',
        franchiseId: 'warriors',
        index: 4,
        playable: ['PG'],
        overall: 72,
      }),
      customCandidate({
        playerId: 'p-flex',
        seasonKey: '1995-96',
        franchiseId: 'lakers',
        index: 5,
        playable: ['PG', 'SG', 'SF', 'PF', 'C'],
        overall: 73,
      }),
      customCandidate({
        playerId: 'p-wing-a',
        seasonKey: '1995-96',
        franchiseId: 'lakers',
        index: 6,
        playable: ['SG', 'SF', 'PF', 'C'],
        overall: 70,
      }),
      customCandidate({
        playerId: 'p-wing-b',
        seasonKey: '1995-96',
        franchiseId: 'lakers',
        index: 7,
        playable: ['SG', 'SF', 'PF', 'C'],
        overall: 70,
      }),
      customCandidate({
        playerId: 'p-wing-c',
        seasonKey: '1995-96',
        franchiseId: 'lakers',
        index: 8,
        playable: ['SG', 'SF', 'PF', 'C'],
        overall: 70,
      }),
    ]);
    const sharedClaim = havocClaimKeyOf('p-shared', '1995-96');
    const seasonClaim = havocClaimKeyOf('p-shared', '1996-97');

    const open = generateOffer({ catalog });
    const sharedCards = open.cards.filter(
      (card) => havocClaimKeyOf(card.source.playerId, card.source.seasonKey ?? '') === sharedClaim,
    );
    expect(sharedCards).toHaveLength(1);
    const seasonCards = open.cards.filter(
      (card) => havocClaimKeyOf(card.source.playerId, card.source.seasonKey ?? '') === seasonClaim,
    );
    expect(seasonCards).toHaveLength(1);

    const excluded = generateOffer({ catalog, draftedClaimKeys: [sharedClaim] });
    for (const card of excluded.cards) {
      expect(card.source.playerId).not.toBe('p-shared');
      expect(card.source.seasonKey).not.toBe('1995-96');
    }
    let sharedSeasonStillDraftable = false;
    for (let index = 0; index < 12; index += 1) {
      const offer = generateOffer({
        catalog,
        draftedClaimKeys: [sharedClaim],
        runSeed: seedFromString(`havoc-claim-test-${String(index)}`),
      });
      if (
        offer.cards.some(
          (card) =>
            havocClaimKeyOf(card.source.playerId, card.source.seasonKey ?? '') === seasonClaim,
        )
      ) {
        sharedSeasonStillDraftable = true;
      }
    }
    expect(sharedSeasonStillDraftable).toBe(true);
  });

  it('raises HavocCatalogCoverageError instead of relaxing positions', () => {
    const catalog = customCatalog([
      customCandidate({
        playerId: 'p-lone-pg',
        seasonKey: '1995-96',
        franchiseId: 'lakers',
        index: 0,
        playable: ['PG'],
        overall: 70,
      }),
      customCandidate({
        playerId: 'p-flex-a',
        seasonKey: '1995-96',
        franchiseId: 'lakers',
        index: 1,
        playable: ['SG', 'SF', 'PF', 'C'],
        overall: 70,
      }),
      customCandidate({
        playerId: 'p-flex-b',
        seasonKey: '1995-96',
        franchiseId: 'lakers',
        index: 2,
        playable: ['SG', 'SF', 'PF', 'C'],
        overall: 71,
      }),
      customCandidate({
        playerId: 'p-flex-c',
        seasonKey: '1995-96',
        franchiseId: 'lakers',
        index: 3,
        playable: ['SG', 'SF', 'PF', 'C'],
        overall: 72,
      }),
    ]);
    expect(() => generateOffer({ catalog })).toThrow(HavocCatalogCoverageError);
    try {
      generateOffer({ catalog });
    } catch (error) {
      expect(error).toBeInstanceOf(HavocCatalogCoverageError);
      if (error instanceof HavocCatalogCoverageError) {
        expect(error.code).toBe('catalog-coverage');
        expect(error.slot).toBe('PG');
      }
    }
  });

  it('raises HavocCatalogCoverageError when the remaining positions cannot complete', () => {
    const catalog = customCatalog([
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
    expect(() => generateOffer({ catalog })).toThrow(HavocCatalogCoverageError);
  });

  it('keeps tier and mutation packages independent of candidate identity and strength', () => {
    const weak = customCatalog([
      customCandidate({
        playerId: 'p-weak-a',
        seasonKey: '1995-96',
        franchiseId: 'lakers',
        index: 0,
        playable: ['PG', 'SG', 'SF', 'PF', 'C'],
        overall: 1,
      }),
      customCandidate({
        playerId: 'p-weak-b',
        seasonKey: '1995-96',
        franchiseId: 'lakers',
        index: 1,
        playable: ['PG', 'SG', 'SF', 'PF', 'C'],
        overall: 1,
      }),
      customCandidate({
        playerId: 'p-weak-c',
        seasonKey: '1995-96',
        franchiseId: 'lakers',
        index: 2,
        playable: ['PG', 'SG', 'SF', 'PF', 'C'],
        overall: 1,
      }),
    ]);
    const offerA = generateOffer({});
    const offerB = generateOffer({ catalog: weak });
    for (let cardIndex = 0; cardIndex < 3; cardIndex += 1) {
      expect(offerB.cards[cardIndex]!.tier).toBe(offerA.cards[cardIndex]!.tier);
      expect(offerB.cards[cardIndex]!.mutations).toEqual(offerA.cards[cardIndex]!.mutations);
    }
  });

  it('draws Growth Spurt samples inside 6..12 inches', () => {
    let sawGrowthSpurt = false;
    for (let index = 0; index < 40; index += 1) {
      const offer = generateOffer({ runSeed: seedFromString(`havoc-growth-${String(index)}`) });
      for (const card of offer.cards) {
        for (const entry of card.mutations) {
          if (entry.mutationId !== 'growth-spurt') continue;
          sawGrowthSpurt = true;
          expect(entry.sampledHeightDelta).toBeGreaterThanOrEqual(6);
          expect(entry.sampledHeightDelta).toBeLessThanOrEqual(12);
          const baseline = card.effective.physical.baselineHeightInches;
          expect(card.effective.physical.heightInches).toBe(
            Math.min(108, baseline + (entry.sampledHeightDelta ?? 6)),
          );
        }
      }
    }
    expect(sawGrowthSpurt).toBe(true);
  });

  it('generates forced all-tier-1, all-tier-2, and all-tier-3 boards', () => {
    for (const tier of [1, 2, 3] as const) {
      let runSeed: string | null = null;
      for (let index = 0; index < 20_000 && runSeed === null; index += 1) {
        const candidate = seedFromString(`havoc-forced-tier-${String(tier)}-${String(index)}`);
        let all = true;
        for (let cardIndex = 0; cardIndex < 3; cardIndex += 1) {
          const rng = createRng(havocDraftCardSeedForTest(candidate, 1, 0, cardIndex));
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
          expect(havocMutationDefinitionOf(card.mutations[0]!.mutationId).tier).toBe(3);
        }
      }
    }
  });
});

function havocDraftCardSeedForTest(
  runSeed: string,
  round: number,
  offerIndex: number,
  cardIndex: number,
): string {
  // Mirrors the frozen derivation documented in havoc-seeds.ts.
  const material = [
    'havoc-seeds-v1',
    'havoc-v1',
    runSeed,
    'draft',
    round,
    'offer',
    offerIndex,
    'card',
    cardIndex,
    'tier',
  ]
    .map((part) => String(part))
    .join('\u0000');
  return digestHex(material);
}

import { seasonDigestHex } from '@hoop-rush/data-contracts';

function digestHex(material: string): string {
  return seasonDigestHex(material);
}

describe('havoc tier distribution', () => {
  it('draws 60/30/10 over a fixed 100,000-card cohort within one percentage point', () => {
    const counts = { 1: 0, 2: 0, 3: 0 };
    const total = 100_000;
    for (let index = 0; index < total; index += 1) {
      const runSeed = seedFromString(`havoc-tier-cohort-${String(index)}`);
      const rng = createRng(havocDraftCardSeedForTest(runSeed, 1, 0, 0));
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
