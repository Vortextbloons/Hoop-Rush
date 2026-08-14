import { describe, expect, it } from 'vitest';
import type { PlayersIndexEntry } from '@hoop-rush/data-contracts';
import { buildVersionFaceIndex, versionTupleOfRosterEntry } from './season-branding';

describe('versionTupleOfRosterEntry', () => {
  it('prefers catalog version identity over a post-trade roster entry', () => {
    const tuple = versionTupleOfRosterEntry(
      {
        playerVersionId: 'pv-lebron',
        playerId: 'p-lebron',
        franchiseId: 'lakers',
        eraId: '2000s',
        seasonKey: '2009-10',
        displayName: 'LeBron James',
      },
      {
        franchiseId: 'cavaliers',
        eraId: '2000s',
        seasonKey: '2009-10',
      },
    );
    expect(tuple.franchiseId).toBe('cavaliers');
  });
});

describe('buildVersionFaceIndex', () => {
  const playersIndex: PlayersIndexEntry[] = [
    {
      playerId: 'p-lebron',
      franchiseId: 'cavaliers',
      eraId: '2000s',
      seasonKey: '2009-10',
      firstName: 'LeBron',
      lastName: 'James',
      displayName: 'LeBron James',
      positionsPlayable: ['SF', 'PF'],
      overall: 95,
      offense: 94,
      defense: 90,
      selectionScore: 95,
      playerExternalId: 'jamesle01',
      altIds: null,
    },
  ];

  it('resolves headshots from catalog-corrected version tuples', () => {
    const faces = buildVersionFaceIndex(playersIndex, [
      versionTupleOfRosterEntry(
        {
          playerVersionId: 'pv-lebron',
          playerId: 'p-lebron',
          franchiseId: 'lakers',
          eraId: '2000s',
          seasonKey: '2009-10',
          displayName: 'LeBron James',
        },
        {
          franchiseId: 'cavaliers',
          eraId: '2000s',
          seasonKey: '2009-10',
        },
      ),
    ]);
    expect(faces.get('pv-lebron')?.playerExternalId).toBe('jamesle01');
  });

  it('falls back to initials when the roster tuple does not match the index', () => {
    const faces = buildVersionFaceIndex(playersIndex, [
      {
        playerVersionId: 'pv-lebron',
        playerId: 'p-lebron',
        franchiseId: 'lakers',
        eraId: '2000s',
        seasonKey: '2009-10',
        displayName: 'LeBron James',
      },
    ]);
    expect(faces.get('pv-lebron')?.playerExternalId).toBe('');
    expect(faces.get('pv-lebron')?.initials).toBe('LJ');
  });
});
