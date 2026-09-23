import type {
  CollectionCardDefinition,
  CollectionFamily,
  CollectionRarity,
} from '@hoop-rush/data-contracts';

export const COLLECTION_SPECIALS_VERSION = 'collection-specials-v3';

export type AuthoredSpecial = {
  family: Exclude<CollectionFamily, 'Base'>;
  rarity: CollectionRarity;
  sourcePlayerVersionId: string;
} & Partial<
  Pick<CollectionCardDefinition, 'ratingOverlay' | 'tendencyOverlay' | 'eligibilityOverlay'>
>;

export const COLLECTION_SPECIALS: readonly AuthoredSpecial[] = [
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
  'pv-b1ea0fc379982caf201e5ecde1170853': 'Stephen Curry 2015-16',
  'pv-95878fdf2e3c464375ca2d492b1e8c2f': 'Klay Thompson 2014-15',
  'pv-e232bb54fc4d64987c28ee7280b2e544': 'Damian Lillard 2019-20',
  'pv-3403aab8d9062e9499e652cefe30bcc8': 'Devin Booker 2023-24',
  'pv-df08d554ee506d60278c77225edb0b44': 'Jamal Murray 2025-26',
  'pv-861bb119df8ca81d3c77b327ee6c55e9': 'Reggie Miller 1989-90',
};
