import { describe, expect, it } from 'vitest';
import type { PlayersIndex, PlayersIndexEntry, PoolIndexEntry } from '@hoop-rush/data-contracts';
import { classicDraftCatalogSchema } from '@hoop-rush/data-contracts';
import { buildClassicCatalog, buildFranchiseEraBuckets, classicPoolRows } from './classic-draft';
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
    positionsPlayable: ['PG'],
    overall: 70,
    offense: 70,
    defense: 70,
    selectionScore: 50,
    ...partial,
  };
}

function indexOf(rows: PlayersIndexEntry[]): PlayersIndex {
  return { schemaVersion: 4, dataVersion: 'data-v1', players: rows };
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
        positionsPlayable: ['SF'],
      }),
      row({
        playerId: 'p-lal-g',
        franchiseId: 'lakers',
        eraId: '1990s',
        positionsPlayable: ['PG'],
      }),
      row({
        playerId: 'p-lal-c',
        franchiseId: 'lakers',
        eraId: '1990s',
        positionsPlayable: ['C'],
      }),
      row({
        playerId: 'p-bos-c',
        franchiseId: 'celtics',
        eraId: '1980s',
        positionsPlayable: ['C'],
      }),

      row({
        playerId: 'p-lal-80',
        franchiseId: 'lakers',
        eraId: '1980s',
        positionsPlayable: ['PG'],
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
      { playerId: 'p-lal-g', positions: ['PG'] },
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
        positionsPlayable: ['SF'],
      }),
      row({ playerId: 'p-mia-g', franchiseId: 'heat', eraId: '2000s', positionsPlayable: ['PG'] }),
    ]);
    const catalog = buildClassicCatalog(manifest, index);
    expect(catalog.map((e) => e.franchiseId)).toEqual(['heat', 'knicks']);
  });
});

describe('buildFranchiseEraBuckets', () => {
  it('groups every index player by franchise/era key in index order', () => {
    const index = indexOf([
      row({ playerId: 'p-lal-1', franchiseId: 'lakers', eraId: '1990s' }),
      row({ playerId: 'p-chi-f', franchiseId: 'bulls', eraId: '1990s' }),
      row({ playerId: 'p-lal-2', franchiseId: 'lakers', eraId: '1990s' }),
      row({ playerId: 'p-lal-3', franchiseId: 'lakers', eraId: '2000s' }),
    ]);
    const buckets = buildFranchiseEraBuckets(index);

    expect(buckets.get('lakers/1990s')?.map((p) => p.playerId)).toEqual(['p-lal-1', 'p-lal-2']);
    expect(buckets.get('bulls/1990s')?.map((p) => p.playerId)).toEqual(['p-chi-f']);
    expect(buckets.get('lakers/2000s')?.map((p) => p.playerId)).toEqual(['p-lal-3']);
    expect(buckets.get('celtics/1980s')).toBeUndefined();
    expect(buckets.size).toBe(3);
  });

  it('memoizes the bucket map per index instance', () => {
    const index = indexOf([row({ playerId: 'a' })]);

    expect(buildFranchiseEraBuckets(index)).toBe(buildFranchiseEraBuckets(index));

    const other = indexOf([row({ playerId: 'b' })]);
    expect(buildFranchiseEraBuckets(other)).not.toBe(buildFranchiseEraBuckets(index));
  });

  it('builds equal catalogs on repeated calls', () => {
    const manifest = buildManifest({
      pools: [poolEntry('bulls', '1990s'), poolEntry('lakers', '1990s')],
    });
    const index = indexOf([
      row({ playerId: 'p-chi-f', franchiseId: 'bulls', eraId: '1990s', positionsPlayable: ['SF'] }),
      row({
        playerId: 'p-lal-g',
        franchiseId: 'lakers',
        eraId: '1990s',
        positionsPlayable: ['PG'],
      }),
    ]);

    expect(buildClassicCatalog(manifest, index)).toEqual(buildClassicCatalog(manifest, index));
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
