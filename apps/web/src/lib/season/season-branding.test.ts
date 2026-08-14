import { describe, expect, it } from 'vitest';
import type { PlayersIndexEntry } from '@hoop-rush/data-contracts';
import {
  buildVersionFaceIndex,
  catalogCandidateOfFreeAgency,
  freeAgencyVersionTuples,
  mergeFreeAgencyFaces,
  versionTupleOfRosterEntry,
} from './season-branding';

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

describe('freeAgencyVersionTuples', () => {
  it('joins market candidates through catalogRef.candidateIndex', () => {
    const catalog = {
      catalogVersion: 'season-draft-catalog-v4',
      dataVersion: 'm10-ratings-v3.6',
      candidates: [
        {
          playerVersionId: 'pv-fa-1',
          playerId: 'p-fa-1',
          franchiseId: 'knicks',
          eraId: '2010s',
          seasonKey: '2012-13',
          displayName: 'Test Player',
        },
      ],
    };
    const freeAgency = {
      windows: [
        {
          candidates: [
            {
              playerVersionId: 'pv-fa-1',
              playerId: 'p-fa-1',
              catalogRef: {
                catalogVersion: 'season-draft-catalog-v4',
                dataVersion: 'm10-ratings-v3.6',
                candidateIndex: 0,
              },
            },
          ],
        },
      ],
    };
    const tuples = freeAgencyVersionTuples(freeAgency as never, catalog as never);
    expect(tuples).toEqual([
      {
        playerVersionId: 'pv-fa-1',
        playerId: 'p-fa-1',
        franchiseId: 'knicks',
        eraId: '2010s',
        seasonKey: '2012-13',
        displayName: 'Test Player',
      },
    ]);
  });

  it('falls back to playerVersionId when catalogRef index is stale', () => {
    const catalog = {
      catalogVersion: 'season-draft-catalog-v4',
      dataVersion: 'm10-ratings-v3.6',
      candidates: [
        {
          playerVersionId: 'pv-fa-1',
          playerId: 'p-fa-1',
          franchiseId: 'knicks',
          eraId: '2010s',
          seasonKey: '2012-13',
          displayName: 'Test Player',
        },
      ],
    };
    const freeAgency = {
      windows: [
        {
          candidates: [
            {
              playerVersionId: 'pv-fa-1',
              playerId: 'p-fa-1',
              catalogRef: {
                catalogVersion: 'season-draft-catalog-v4',
                dataVersion: 'm10-ratings-v3.6',
                candidateIndex: 99,
              },
            },
          ],
        },
      ],
    };
    expect(
      catalogCandidateOfFreeAgency(catalog as never, freeAgency.windows[0].candidates[0] as never)
        ?.playerVersionId,
    ).toBe('pv-fa-1');
  });
});

describe('mergeFreeAgencyFaces', () => {
  const playersIndex: PlayersIndexEntry[] = [
    {
      playerId: 'p-fa-1',
      franchiseId: 'knicks',
      eraId: '2010s',
      seasonKey: '2012-13',
      firstName: 'Test',
      lastName: 'Player',
      displayName: 'Test Player',
      positionsPlayable: ['PG'],
      overall: 80,
      offense: 82,
      defense: 78,
      selectionScore: 80,
      playerExternalId: 'fa-headshot',
      altIds: { bbref: 'testpl01', nbaHeadshotAvailable: true, photoUrl: null },
    },
  ];

  it('adds market faces without dropping roster faces', () => {
    const rosterFaces = new Map([
      [
        'pv-roster',
        {
          playerId: 'p-roster',
          playerExternalId: 'roster-headshot',
          altIds: null,
          initials: 'RR',
        },
      ],
    ]);
    const catalog = {
      catalogVersion: 'season-draft-catalog-v4',
      dataVersion: 'm10-ratings-v3.6',
      candidates: [
        {
          playerVersionId: 'pv-fa-1',
          playerId: 'p-fa-1',
          franchiseId: 'knicks',
          eraId: '2010s',
          seasonKey: '2012-13',
          displayName: 'Test Player',
        },
      ],
    };
    const freeAgency = {
      windows: [
        {
          candidates: [
            {
              playerVersionId: 'pv-fa-1',
              playerId: 'p-fa-1',
              catalogRef: {
                catalogVersion: 'season-draft-catalog-v4',
                dataVersion: 'm10-ratings-v3.6',
                candidateIndex: 0,
              },
            },
          ],
        },
      ],
    };
    const merged = mergeFreeAgencyFaces(
      playersIndex,
      catalog as never,
      freeAgency as never,
      rosterFaces,
    );
    expect(merged.get('pv-roster')?.playerExternalId).toBe('roster-headshot');
    expect(merged.get('pv-fa-1')?.playerExternalId).toBe('fa-headshot');
  });
});
