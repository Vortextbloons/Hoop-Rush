import { describe, expect, it } from 'vitest';
import type { PlayersIndex, PlayersIndexEntry, PoolIndexEntry } from '@hoop-rush/data-contracts';
import { classicDraftCatalogSchema } from '@hoop-rush/data-contracts';
import { buildClassicCatalog, classicPoolRows } from './classic-draft';
import { buildManifest } from '@hoop-rush/test-fixtures';

function poolEntry(franchiseId: string, eraId: string): PoolIndexEntry {
  return {
    franchiseId,
    eraId,
    url: `pools/${franchiseId}-${eraId}.json`,
    contentHash: 'a'.repeat(64),
  };
}

function row(partial: Partial<PlayersIndexEntry> & { playerId: string }): PlayersIndexEntry {
  return {
    franchiseId: 'lakers',
    eraId: '1990s',
    seasonKey: '1996-97',
    firstName: 'Test',
    lastName: 'Player',
    displayName: 'Test Player',
    playerExternalId: '1',
    altIds: null,
    positionsCanonical: ['G'],
    overall: 70,
    offense: 70,
    defense: 70,
    selectionScore: 50,
    heightInches: 78,
    weightLbs: 200,
    stats: {
      gamesPlayed: 80,
      minutes: 2400,
      points: 1600,
      rebounds: 800,
      offensiveRebounds: null,
      defensiveRebounds: null,
      assists: 400,
      steals: 80,
      blocks: 40,
      turnovers: 200,
      fieldGoalsMade: 600,
      fieldGoalsAttempted: 1200,
      threesMade: 100,
      threesAttempted: 250,
      freeThrowsMade: 300,
      freeThrowsAttempted: 360,
      per: 20,
      boxPlusMinus: 2,
      usageRate: 25,
      tsPct: 0.6,
      efgPct: 0.54,
    },
    ...partial,
  };
}

function indexOf(rows: PlayersIndexEntry[]): PlayersIndex {
  return { schemaVersion: 2, dataVersion: 'data-v1', players: rows };
}

describe('buildClassicCatalog', () => {
  it('creates one entry per manifest pool pair with the pair players mapped from the index', () => {
    const manifest = buildManifest({
      pools: [
        poolEntry('bulls', '1990s'),
        poolEntry('lakers', '1990s'),
        poolEntry('celtics', '1980s'),
      ],
    });
    const index = indexOf([
      row({
        playerId: 'p-chi-f',
        franchiseId: 'bulls',
        eraId: '1990s',
        positionsCanonical: ['F'],
      }),
      row({
        playerId: 'p-lal-g',
        franchiseId: 'lakers',
        eraId: '1990s',
        positionsCanonical: ['G'],
      }),
      row({
        playerId: 'p-lal-c',
        franchiseId: 'lakers',
        eraId: '1990s',
        positionsCanonical: ['C'],
      }),
      row({
        playerId: 'p-bos-c',
        franchiseId: 'celtics',
        eraId: '1980s',
        positionsCanonical: ['C'],
      }),
      // Decoy outside every manifest pool pair: must never appear.
      row({
        playerId: 'p-lal-80',
        franchiseId: 'lakers',
        eraId: '1980s',
        positionsCanonical: ['G'],
      }),
    ]);

    const catalog = buildClassicCatalog(manifest, index);

    expect(catalog).toHaveLength(3);
    expect(catalog.map((e) => `${e.franchiseId}/${e.eraId}`)).toEqual([
      'bulls/1990s',
      'lakers/1990s',
      'celtics/1980s',
    ]);
    expect(catalog[1]?.players).toEqual([
      { playerId: 'p-lal-g', positions: ['G'] },
      { playerId: 'p-lal-c', positions: ['C'] },
    ]);
    expect(classicDraftCatalogSchema.safeParse(catalog).success).toBe(true);
  });

  it('keeps manifest.pools order even when the index order differs', () => {
    const manifest = buildManifest({
      pools: [poolEntry('heat', '2000s'), poolEntry('knicks', '2010s')],
    });
    const index = indexOf([
      row({
        playerId: 'p-nyk-f',
        franchiseId: 'knicks',
        eraId: '2010s',
        positionsCanonical: ['F'],
      }),
      row({ playerId: 'p-mia-g', franchiseId: 'heat', eraId: '2000s', positionsCanonical: ['G'] }),
    ]);
    const catalog = buildClassicCatalog(manifest, index);
    expect(catalog.map((e) => e.franchiseId)).toEqual(['heat', 'knicks']);
  });
});

describe('classicPoolRows', () => {
  const pair = { franchiseId: 'lakers', eraId: '1990s' };

  it('returns only the pair rows', () => {
    const index = indexOf([
      row({ playerId: 'a', franchiseId: 'lakers', eraId: '1990s' }),
      row({ playerId: 'b', franchiseId: 'celtics', eraId: '1990s' }),
      row({ playerId: 'c', franchiseId: 'lakers', eraId: '1980s' }),
    ]);
    const rows = classicPoolRows(index, pair, 'ratings');
    expect(rows.map((r) => r.playerId)).toEqual(['a']);
  });

  it('sorts ball-knowledge pools alphabetically by display name with stable ties', () => {
    const index = indexOf([
      row({ playerId: 'z', displayName: 'Zed Zoster', overall: 99 }),
      row({ playerId: 'dup', displayName: 'Dup Name' }),
      row({ playerId: 'a', displayName: 'Aaron Aardvark', overall: 1 }),
      row({ playerId: 'dup2', displayName: 'Dup Name' }),
    ]);
    const rows = classicPoolRows(index, pair, 'ball-knowledge');
    expect(rows.map((r) => r.playerId)).toEqual(['a', 'dup', 'dup2', 'z']);
  });

  it('sorts ratings pools by overall descending then display name ascending', () => {
    const index = indexOf([
      row({ playerId: 'low', displayName: 'Aaron Low', overall: 60 }),
      row({ playerId: 'high', displayName: 'Zed High', overall: 92 }),
      row({ playerId: 'tie-a', displayName: 'Anna Tie', overall: 80 }),
      row({ playerId: 'tie-b', displayName: 'Bob Tie', overall: 80 }),
    ]);
    const rows = classicPoolRows(index, pair, 'ratings');
    expect(rows.map((r) => r.playerId)).toEqual(['high', 'tie-a', 'tie-b', 'low']);
  });

  it('never mutates the players index', () => {
    const index = indexOf([row({ playerId: 'b' }), row({ playerId: 'a' })]);
    const before = index.players.map((r) => r.playerId);
    classicPoolRows(index, pair, 'ball-knowledge');
    classicPoolRows(index, pair, 'ratings');
    expect(index.players.map((r) => r.playerId)).toEqual(before);
  });
});
