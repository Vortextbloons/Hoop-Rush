import type {
  CollectionCardDefinition,
  CollectionFamily,
  CollectionRarity,
} from '@hoop-rush/data-contracts';

export const COLLECTION_SPECIALS_VERSION: string = 'collection-specials-v6';

export type AuthoredSpecial = {
  family: Exclude<CollectionFamily, 'Base'>;
  rarity: CollectionRarity;
  sourcePlayerVersionId: string;
  source: { playerId: string; franchiseId: string; eraId: string; seasonKey: string };
} & Partial<
  Pick<CollectionCardDefinition, 'ratingOverlay' | 'tendencyOverlay' | 'eligibilityOverlay'>
>;

export const COLLECTION_SPECIALS: readonly AuthoredSpecial[] = [
  {
    family: 'Arm Guard',
    rarity: 'Immortal',
    sourcePlayerVersionId: 'pv-f4d00dd58ebad5097f4e5ba3307a9085',
    source: {
      playerId: 'p-1629029',
      franchiseId: 'mavericks',
      eraId: '2020s',
      seasonKey: '2023-24',
    },
    ratingOverlay: {
      perimeterDefense: 30,
      defensiveIq: 25,
      steal: 16,
      interiorDefense: 45,
      block: 10,
      defensiveRebound: 8,
    },
  },
  {
    family: 'Arm Guard',
    rarity: 'Immortal',
    sourcePlayerVersionId: 'pv-4f9bfe1ff8fb4b3bed084899071a304f',
    source: { playerId: 'p-77142', franchiseId: 'lakers', eraId: '1980s', seasonKey: '1989-90' },
    ratingOverlay: {
      perimeterDefense: 29,
      defensiveIq: 29,
      steal: 15,
      interiorDefense: 36,
      block: 17,
      defensiveRebound: 17,
    },
  },
  {
    family: 'Arm Guard',
    rarity: 'Immortal',
    sourcePlayerVersionId: 'pv-3f5b52ec3a1798b0bad644defdb7c47c',
    source: { playerId: 'p-1629027', franchiseId: 'hawks', eraId: '2020s', seasonKey: '2021-22' },
    ratingOverlay: {
      perimeterDefense: 34,
      defensiveIq: 26,
      steal: 25,
      interiorDefense: 38,
      block: 7,
      defensiveRebound: 12,
    },
  },
  {
    family: 'Arm Guard',
    rarity: 'Immortal',
    sourcePlayerVersionId: 'pv-d6f09fada4f8f7c1d26258b3b045611d',
    source: { playerId: 'p-201935', franchiseId: 'rockets', eraId: '2010s', seasonKey: '2018-19' },
    ratingOverlay: {
      perimeterDefense: 25,
      defensiveIq: 21,
      steal: 12,
      interiorDefense: 47,
      block: 10,
      defensiveRebound: 12,
    },
  },
  {
    family: 'Arm Guard',
    rarity: 'Eclipse',
    sourcePlayerVersionId: 'pv-e672c0d85044e49475d29e2691a16bc8',
    source: { playerId: 'p-1626156', franchiseId: 'lakers', eraId: '2020s', seasonKey: '2023-24' },
    ratingOverlay: {
      perimeterDefense: 27,
      defensiveIq: 20,
      steal: 18,
      interiorDefense: 40,
      block: 10,
      defensiveRebound: 14,
    },
  },
  {
    family: 'Arm Guard',
    rarity: 'Titan',
    sourcePlayerVersionId: 'pv-91b01c4775957fb343db81099c6d7d37',
    source: { playerId: 'p-203903', franchiseId: 'jazz', eraId: '2020s', seasonKey: '2020-21' },
    ratingOverlay: {
      perimeterDefense: 28,
      defensiveIq: 20,
      steal: 17,
      interiorDefense: 37,
      block: 9,
      defensiveRebound: 15,
    },
  },
  {
    family: 'Arm Guard',
    rarity: 'Immortal',
    sourcePlayerVersionId: 'pv-4efd0118ae40c6f4ed7689ee95d6e728',
    source: { playerId: 'p-203992', franchiseId: 'hawks', eraId: '2020s', seasonKey: '2020-21' },
    ratingOverlay: {
      perimeterDefense: 25,
      defensiveIq: 22,
      steal: 19,
      interiorDefense: 39,
      block: 16,
      defensiveRebound: 14,
    },
  },
  {
    family: 'Heat Check',
    rarity: 'Immortal',
    sourcePlayerVersionId: 'pv-7cade7ffd36dd1fbc109dd0d6587b34f',
    source: { playerId: 'p-201939', franchiseId: 'warriors', eraId: '2010s', seasonKey: '2014-15' },
    ratingOverlay: { threePoint: 10, midrange: 5, offensiveIq: 3, ballHandling: 2 },
  },
  {
    family: 'Heat Check',
    rarity: 'Eclipse',
    sourcePlayerVersionId: 'pv-95878fdf2e3c464375ca2d492b1e8c2f',
    source: { playerId: 'p-202691', franchiseId: 'warriors', eraId: '2010s', seasonKey: '2014-15' },
    ratingOverlay: { threePoint: 10, midrange: 5, offensiveIq: 3, ballHandling: 2 },
  },
  {
    family: 'Heat Check',
    rarity: 'Eclipse',
    sourcePlayerVersionId: 'pv-e232bb54fc4d64987c28ee7280b2e544',
    source: { playerId: 'p-203081', franchiseId: 'blazers', eraId: '2010s', seasonKey: '2019-20' },
    ratingOverlay: { threePoint: 10, midrange: 5, offensiveIq: 3, ballHandling: 2 },
  },
  {
    family: 'Heat Check',
    rarity: 'Titan',
    sourcePlayerVersionId: 'pv-3403aab8d9062e9499e652cefe30bcc8',
    source: { playerId: 'p-1626164', franchiseId: 'suns', eraId: '2020s', seasonKey: '2023-24' },
    ratingOverlay: { threePoint: 10, midrange: 5, offensiveIq: 3, ballHandling: 2 },
  },
  {
    family: 'Heat Check',
    rarity: 'Titan',
    sourcePlayerVersionId: 'pv-df08d554ee506d60278c77225edb0b44',
    source: { playerId: 'p-1627750', franchiseId: 'nuggets', eraId: '2020s', seasonKey: '2025-26' },
    ratingOverlay: { threePoint: 10, midrange: 5, offensiveIq: 3, ballHandling: 2 },
  },
  {
    family: 'Heat Check',
    rarity: 'Apex',
    sourcePlayerVersionId: 'pv-861bb119df8ca81d3c77b327ee6c55e9',
    source: { playerId: 'p-397', franchiseId: 'pacers', eraId: '1980s', seasonKey: '1989-90' },
    ratingOverlay: { threePoint: 10, midrange: 5, offensiveIq: 3, ballHandling: 2 },
  },
];
