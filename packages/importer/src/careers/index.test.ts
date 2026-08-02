import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { computeCareerStats } from './index.js';
import { fileExists, readJson, writeJson } from '../json.js';

const tempRoots: string[] = [];
function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'hoop-rush-careers-'));
  tempRoots.push(root);
  return root;
}

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

describe('computeCareerStats', () => {
  it('groups season stats by player and writes per-season career files for roster players', () => {
    const root = makeTempRoot();

    // Two seasons of stats: player 100 appears in both, 101 only in the first,
    // 102 only in the second.
    writeJson(join(root, '1995-96', 'season-stats.json'), [
      { playerExternalId: '100', points: 100 },
      { playerExternalId: '101', points: 50 },
    ]);
    writeJson(join(root, '1996-97', 'season-stats.json'), [
      { playerExternalId: '100', points: 120 },
      { playerExternalId: '102', points: 30 },
    ]);

    // Roster keyed by externalId; 1996-97 also carries a player (103) with no stats.
    writeJson(join(root, '1995-96', 'roster.json'), [{ externalId: '100' }, { externalId: '101' }]);
    writeJson(join(root, '1996-97', 'roster.json'), [{ externalId: '100' }, { externalId: '103' }]);

    computeCareerStats(['1995-96', '1996-97'], root);

    const first = readJson(join(root, '1995-96', 'career-stats.json')) as {
      playerExternalId: string;
      seasons: { points: number }[];
    }[];
    expect(first).toHaveLength(2);
    expect(first[0]?.playerExternalId).toBe('100');
    expect(first[0]?.seasons).toHaveLength(2);
    expect(first[1]?.playerExternalId).toBe('101');
    expect(first[1]?.seasons).toHaveLength(1);

    const second = readJson(join(root, '1996-97', 'career-stats.json')) as {
      playerExternalId: string;
      seasons: { points: number }[];
    }[];
    expect(second).toHaveLength(1);
    expect(second[0]?.playerExternalId).toBe('100');
    expect(second[0]?.seasons).toHaveLength(2);
  });

  it('falls back to the playerId key when playerExternalId is missing', () => {
    const root = makeTempRoot();
    writeJson(join(root, '1995-96', 'season-stats.json'), [{ playerId: '999', points: 5 }]);
    writeJson(join(root, '1995-96', 'roster.json'), [{ id: '999' }]);

    computeCareerStats(['1995-96'], root);

    const careers = readJson(join(root, '1995-96', 'career-stats.json')) as {
      playerExternalId: string;
    }[];
    expect(careers).toHaveLength(1);
    expect(careers[0]?.playerExternalId).toBe('999');
  });

  it('skips seasons with no stats file', () => {
    const root = makeTempRoot();
    writeJson(join(root, '1995-96', 'season-stats.json'), [
      { playerExternalId: '100', points: 10 },
    ]);
    writeJson(join(root, '1995-96', 'roster.json'), [{ externalId: '100' }]);
    computeCareerStats(['2099-00', '1995-96'], root);
    expect(fileExists(join(root, '2099-00', 'career-stats.json'))).toBe(false);
    expect(fileExists(join(root, '1995-96', 'career-stats.json'))).toBe(true);
  });
});
