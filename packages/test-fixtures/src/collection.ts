import {
  SIMULATION_RATINGS,
  SIMULATION_TENDENCIES,
  collectionCatalogSchema,
  seasonDigestHex,
  type CollectionCatalog,
  type CollectionCatalogCard,
  type CollectionRarity,
} from '@hoop-rush/data-contracts';
import {
  COLLECTION_CATALOG_VERSION,
  COLLECTION_ECONOMY_VERSION,
  COLLECTION_OVERLAY_VERSION,
  COLLECTION_PACK_RULES_VERSION,
  COLLECTION_REPLAY_VERSION,
  COLLECTION_SCHEMA_VERSION,
  COLLECTION_VERSION,
} from '@hoop-rush/data-contracts';

const FIXTURE_POSITIONS: Record<string, Array<'PG' | 'SG' | 'SF' | 'PF' | 'C'>> = {
  'fixture-pg': ['PG'],
  'fixture-sg': ['SG'],
  'fixture-sf': ['SF'],
  'fixture-pf': ['PF'],
  'fixture-c': ['C'],
};

function fixtureCardId(playerId: string, family: string): `card-${string}` {
  return `card-${seasonDigestHex(`collection-fixture\u0000${playerId}\u0000${family}`)}`;
}

function fixtureSourceVersion(playerId: string): `pv-${string}` {
  return `pv-${seasonDigestHex(`collection-fixture-source\u0000${playerId}`)}`;
}

export function buildCollectionFixtureCard(
  playerId: string,
  overrides: Partial<CollectionCatalogCard> = {},
): CollectionCatalogCard {
  const positions = FIXTURE_POSITIONS[playerId] ?? ['PG'];
  const overall = overrides.summarySource?.overallRating ?? 60;
  const rarity: CollectionRarity =
    overrides.rarity ?? (overall < 72 ? 'Ember' : overall < 85 ? 'Eruption' : 'Apex');
  const pid = overrides.playerId ?? playerId;
  const cid = overrides.cardId ?? fixtureCardId(playerId, 'Base');
  return collectionCatalogSchema.shape.cards.element.parse({
    sourcePlayerVersionId: fixtureSourceVersion(pid),
    family: 'Base',
    rarity,
    seasonKey: '1996-97',
    franchiseId: 'lakers',
    eraId: '1990s',
    displayName: `Fixture ${playerId}`,
    positions,
    overlayVersion: COLLECTION_OVERLAY_VERSION,
    sourceProvenance: 'fixture',
    detailedRatings: { ...SIMULATION_RATINGS },
    tendencies: { ...SIMULATION_TENDENCIES },
    heightInches: 79,
    weightLbs: 215,
    playerExternalId: '101',
    summarySource: { overallRating: 60, offenseRating: 60, defenseRating: 60 },
    ...overrides,
    cardId: cid,
    playerId: pid,
  });
}

export function buildCollectionFixtureCatalog(
  overrides: Partial<CollectionCatalog> = {},
): CollectionCatalog {
  const cards = [
    buildCollectionFixtureCard('fixture-pg', {
      displayName: 'Fixture Guard One',
      summarySource: { overallRating: 60, offenseRating: 60, defenseRating: 60 },
    }),
    buildCollectionFixtureCard('fixture-sg', {
      displayName: 'Fixture Guard Two',
      summarySource: { overallRating: 61, offenseRating: 61, defenseRating: 60 },
    }),
    buildCollectionFixtureCard('fixture-sf', {
      displayName: 'Fixture Forward One',
      summarySource: { overallRating: 62, offenseRating: 62, defenseRating: 61 },
    }),
    buildCollectionFixtureCard('fixture-pf', {
      displayName: 'Fixture Forward Two',
      summarySource: { overallRating: 63, offenseRating: 62, defenseRating: 62 },
    }),
    buildCollectionFixtureCard('fixture-c', {
      displayName: 'Fixture Center',
      summarySource: { overallRating: 64, offenseRating: 62, defenseRating: 64 },
    }),
    buildCollectionFixtureCard('fixture-extra', {
      positions: ['PG', 'SG'],
      displayName: 'Fixture Extra',
      summarySource: { overallRating: 65, offenseRating: 65, defenseRating: 60 },
    }),
  ];
  return collectionCatalogSchema.parse({
    schemaVersion: COLLECTION_SCHEMA_VERSION,
    catalogVersion: COLLECTION_CATALOG_VERSION,
    collectionVersion: COLLECTION_VERSION,
    overlayVersion: COLLECTION_OVERLAY_VERSION,
    dataVersion: 'fixture-data-v1',
    ratingsVersion: 'ratings-v3.9',
    positionNormalizationVersion: 'position-v3',
    playerVersionIdVersion: 'player-version-id-v1',
    sourceCatalogVersion: 'season-draft-catalog-v4',
    sourceCatalogHash: '0'.repeat(64),
    cards,
    sets: [
      {
        setId: 'sharpshooter-set',
        title: 'Fixture Sharpshooters',
        memberCardIds: [cards[0]?.cardId, cards[1]?.cardId],
      },
    ],
    packs: [
      {
        packId: 'tip-off',
        packRulesVersion: COLLECTION_PACK_RULES_VERSION,
        priceCurrency: 'Coins',
        priceAmount: 100,
        slots: [{ kind: 'ordinary' }],
        eligibleScope: 'full-catalog',
        rarityWeights: {
          Ember: 70,
          Eruption: 23,
          Apex: 5,
          Titan: 1.7,
          Eclipse: 0.29,
          Immortal: 0.01,
        },
        duplicateExchange: {
          Ember: 5,
          Eruption: 15,
          Apex: 50,
          Titan: 150,
          Eclipse: 500,
          Immortal: 1500,
        },
      },
    ],
    replayVersion: COLLECTION_REPLAY_VERSION,
    ...overrides,
  });
}

export function buildCollectionFixtureState(overrides = {}) {
  return {
    schemaVersion: COLLECTION_SCHEMA_VERSION,
    collectionVersion: COLLECTION_VERSION,
    catalogVersion: COLLECTION_CATALOG_VERSION,
    economyVersion: COLLECTION_ECONOMY_VERSION,
    collectionId: 'collection-1',
    rootSeed: '0'.repeat(32),
    revision: 0,
    digest: '0'.repeat(32),
    claimedWelcome: false,
    owned: [],
    balances: { Coins: 0, Exchange: 0 },
    nextPullSequence: 0,
    ...overrides,
  };
}
