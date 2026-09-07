import type { CollectionFamily, CollectionRarity } from '@hoop-rush/data-contracts';

export interface AuthoredSpecial {
  family: Exclude<CollectionFamily, 'Base'>;
  rarity: CollectionRarity;
  sourcePlayerVersionId: string;
  ratingOverlay: Record<string, number>;
}

export const COLLECTION_SPECIALS: readonly AuthoredSpecial[] = [
  {
    family: 'Sharpshooter',
    rarity: 'Apex',
    sourcePlayerVersionId: 'pv-00b6bcc86228d63418ad10f2008e4d78',
    ratingOverlay: { threePoint: 20, freeThrow: 10 },
  },
  {
    family: 'Sharpshooter',
    rarity: 'Titan',
    sourcePlayerVersionId: 'pv-c14b712a46d91df644424a84465446fa',
    ratingOverlay: { threePoint: 20, freeThrow: 10 },
  },
  {
    family: 'Sharpshooter',
    rarity: 'Eclipse',
    sourcePlayerVersionId: 'pv-1103923c15842b88bc8cecea562a0c8c',
    ratingOverlay: { threePoint: 20, freeThrow: 10 },
  },
  {
    family: 'Sharpshooter',
    rarity: 'Immortal',
    sourcePlayerVersionId: 'pv-b1ea0fc379982caf201e5ecde1170853',
    ratingOverlay: { threePoint: 20, freeThrow: 10 },
  },
  {
    family: 'Lockdown',
    rarity: 'Apex',
    sourcePlayerVersionId: 'pv-fdf9480106edeb1da95790b7443ce991',
    ratingOverlay: { perimeterDefense: 15, interiorDefense: 10, defensiveIq: 15, steal: 10 },
  },
  {
    family: 'Lockdown',
    rarity: 'Titan',
    sourcePlayerVersionId: 'pv-05566ef67aa3d2c2e95cfaa4e030e826',
    ratingOverlay: { perimeterDefense: 15, interiorDefense: 10, defensiveIq: 15, steal: 10 },
  },
  {
    family: 'Lockdown',
    rarity: 'Eclipse',
    sourcePlayerVersionId: 'pv-0677dab31eb51eef19f4a00946e66403',
    ratingOverlay: { perimeterDefense: 15, interiorDefense: 10, defensiveIq: 15, steal: 10 },
  },
  {
    family: 'Lockdown',
    rarity: 'Immortal',
    sourcePlayerVersionId: 'pv-a696e35b7419fb37efbb85cd3671f90b',
    ratingOverlay: { perimeterDefense: 15, interiorDefense: 10, defensiveIq: 15, steal: 10 },
  },
  {
    family: 'Floor General',
    rarity: 'Apex',
    sourcePlayerVersionId: 'pv-a16de3b614e2208264b74d4c5ba4c846',
    ratingOverlay: { passing: 15, ballHandling: 10, offensiveIq: 15 },
  },
  {
    family: 'Floor General',
    rarity: 'Titan',
    sourcePlayerVersionId: 'pv-614500160beaeab2e19d8b5c45afef06',
    ratingOverlay: { passing: 15, ballHandling: 10, offensiveIq: 15 },
  },
  {
    family: 'Floor General',
    rarity: 'Eclipse',
    sourcePlayerVersionId: 'pv-cd80b46d697f56b959869843737d4f7d',
    ratingOverlay: { passing: 15, ballHandling: 10, offensiveIq: 15 },
  },
  {
    family: 'Floor General',
    rarity: 'Immortal',
    sourcePlayerVersionId: 'pv-23a7fcd70d121adb6efbf9819cfb8307',
    ratingOverlay: { passing: 15, ballHandling: 10, offensiveIq: 15 },
  },
];

export const COLLECTION_SPECIAL_SOURCE_SEASONS: Record<string, string> = {
  'pv-00b6bcc86228d63418ad10f2008e4d78': 'Ben Simmons 2017-18',
  'pv-c14b712a46d91df644424a84465446fa': 'Kyle Korver 2014-15',
  'pv-1103923c15842b88bc8cecea562a0c8c': 'Ray Allen 2000-01',
  'pv-b1ea0fc379982caf201e5ecde1170853': 'Stephen Curry 2015-16',
  'pv-fdf9480106edeb1da95790b7443ce991': 'Dennis Rodman 1991-92',
  'pv-05566ef67aa3d2c2e95cfaa4e030e826': 'Gary Payton 1999-00',
  'pv-0677dab31eb51eef19f4a00946e66403': 'Scottie Pippen 1994-95',
  'pv-a696e35b7419fb37efbb85cd3671f90b': 'Kawhi Leonard 2019-20',
  'pv-a16de3b614e2208264b74d4c5ba4c846': 'Jason Kidd 1998-99',
  'pv-614500160beaeab2e19d8b5c45afef06': 'John Stockton 1991-92',
  'pv-cd80b46d697f56b959869843737d4f7d': 'Steve Nash 2006-07',
  'pv-23a7fcd70d121adb6efbf9819cfb8307': 'Chris Paul 2008-09',
};
