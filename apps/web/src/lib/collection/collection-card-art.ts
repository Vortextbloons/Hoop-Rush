import type { CollectionIndexEntry } from '@hoop-rush/data-contracts';

const heatCheckArt: Readonly<Record<string, string>> = {
  'p-202691': 'klay-thompson',
  'p-201939': 'stephen-curry',
  'p-1626164': 'devin-booker',
  'p-1627750': 'jamal-murray',
  'p-203081': 'damian-lillard',
  'p-397': 'reggie-miller',
};

export function collectionCardArtOf(
  card: Pick<CollectionIndexEntry, 'family' | 'playerId'> | null,
): string | null {
  const artwork = card?.family === 'Heat Check' ? heatCheckArt[card.playerId] : null;
  return artwork ? `/ultimate/cards/heat-check/${artwork}.png` : null;
}
