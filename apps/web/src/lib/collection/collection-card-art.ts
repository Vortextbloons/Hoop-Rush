import type { CollectionIndexEntry } from '@hoop-rush/data-contracts';

const heatCheckArt: Readonly<Record<string, string>> = {
  'p-202691': 'klay-thompson',
  'p-201939': 'stephen-curry',
  'p-1626164': 'devin-booker',
  'p-1627750': 'jamal-murray',
  'p-203081': 'damian-lillard',
  'p-397': 'reggie-miller',
};

const armGuardArt: Readonly<Record<string, string>> = {
  'p-1629029': 'luka-doncic',
  'p-77142': 'magic-johnson',
  'p-1629027': 'trae-young',
  'p-201935': 'james-harden',
  'p-1626156': 'dangelo-russell',
  'p-203903': 'jordan-clarkson',
  'p-203992': 'bogdan-bogdanovic',
};

export function collectionCardArtOf(
  card: Pick<CollectionIndexEntry, 'family' | 'playerId'> | null,
): string | null {
  if (card?.family === 'Arm Guard') {
    const artwork = armGuardArt[card.playerId];
    return artwork ? `/ultimate/cards/arm-guard/${artwork}.png` : null;
  }
  const artwork = card?.family === 'Heat Check' ? heatCheckArt[card.playerId] : null;
  return artwork ? `/ultimate/cards/heat-check/${artwork}.png` : null;
}
