import type {
  CollectionCardDefinition,
  CollectionFamily,
  CollectionRarity,
} from '@hoop-rush/data-contracts';

export const COLLECTION_SPECIALS_VERSION: string = 'collection-specials-v4';

export type AuthoredSpecial = {
  family: Exclude<CollectionFamily, 'Base'>;
  rarity: CollectionRarity;
  sourcePlayerVersionId: string;
} & Partial<
  Pick<CollectionCardDefinition, 'ratingOverlay' | 'tendencyOverlay' | 'eligibilityOverlay'>
>;

export const COLLECTION_SPECIALS: readonly AuthoredSpecial[] = [
  {
    family: 'Arm Guard',
    rarity: 'Immortal',
    sourcePlayerVersionId: 'pv-f4d00dd58ebad5097f4e5ba3307a9085',
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
    sourcePlayerVersionId: 'pv-b6f7c0f4a71f25601b18bd2634c856e4',
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
    sourcePlayerVersionId: 'pv-eff5d20d8eaa3de1f44664138e6155bd',
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
    sourcePlayerVersionId: 'pv-b1ea0fc379982caf201e5ecde1170853',
    ratingOverlay: { threePoint: 10, midrange: 5, offensiveIq: 3, ballHandling: 2 },
  },
  {
    family: 'Heat Check',
    rarity: 'Eclipse',
    sourcePlayerVersionId: 'pv-95878fdf2e3c464375ca2d492b1e8c2f',
    ratingOverlay: { threePoint: 10, midrange: 5, offensiveIq: 3, ballHandling: 2 },
  },
  {
    family: 'Heat Check',
    rarity: 'Eclipse',
    sourcePlayerVersionId: 'pv-e232bb54fc4d64987c28ee7280b2e544',
    ratingOverlay: { threePoint: 10, midrange: 5, offensiveIq: 3, ballHandling: 2 },
  },
  {
    family: 'Heat Check',
    rarity: 'Titan',
    sourcePlayerVersionId: 'pv-3403aab8d9062e9499e652cefe30bcc8',
    ratingOverlay: { threePoint: 10, midrange: 5, offensiveIq: 3, ballHandling: 2 },
  },
  {
    family: 'Heat Check',
    rarity: 'Titan',
    sourcePlayerVersionId: 'pv-df08d554ee506d60278c77225edb0b44',
    ratingOverlay: { threePoint: 10, midrange: 5, offensiveIq: 3, ballHandling: 2 },
  },
  {
    family: 'Heat Check',
    rarity: 'Apex',
    sourcePlayerVersionId: 'pv-861bb119df8ca81d3c77b327ee6c55e9',
    ratingOverlay: { threePoint: 10, midrange: 5, offensiveIq: 3, ballHandling: 2 },
  },
];

export const COLLECTION_SPECIAL_SOURCE_SEASONS: Record<string, string> = {
  'pv-f4d00dd58ebad5097f4e5ba3307a9085': 'Luka Dončić 2023-24',
  'pv-b6f7c0f4a71f25601b18bd2634c856e4': 'Magic Johnson 1988-89',
  'pv-3f5b52ec3a1798b0bad644defdb7c47c': 'Trae Young 2021-22',
  'pv-eff5d20d8eaa3de1f44664138e6155bd': 'James Harden 2018-19',
  'pv-e672c0d85044e49475d29e2691a16bc8': "D'Angelo Russell 2023-24",
  'pv-91b01c4775957fb343db81099c6d7d37': 'Jordan Clarkson 2020-21',
  'pv-4efd0118ae40c6f4ed7689ee95d6e728': 'Bogdan Bogdanović 2020-21',
  'pv-b1ea0fc379982caf201e5ecde1170853': 'Stephen Curry 2015-16',
  'pv-95878fdf2e3c464375ca2d492b1e8c2f': 'Klay Thompson 2014-15',
  'pv-e232bb54fc4d64987c28ee7280b2e544': 'Damian Lillard 2019-20',
  'pv-3403aab8d9062e9499e652cefe30bcc8': 'Devin Booker 2023-24',
  'pv-df08d554ee506d60278c77225edb0b44': 'Jamal Murray 2025-26',
  'pv-861bb119df8ca81d3c77b327ee6c55e9': 'Reggie Miller 1989-90',
};
