import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  computeForSeason,
  deriveEraConfig,
  fallbackConfig,
  run,
  type SeasonStatRow,
} from './index.js';
import { writeJson } from '../json.js';

const tempRoots: string[] = [];
function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'hoop-rush-era-config-'));
  tempRoots.push(root);
  return root;
}

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

describe('deriveEraConfig', () => {
  it('computes league aggregates with the Python rounding', () => {
    const rows: SeasonStatRow[] = [
      { gamesPlayed: 82, fga: 1200, tpa: 180, points: 1600, tsPct: 0.5512 },
      { gamesPlayed: 80, fga: 1100, tpa: 150, points: 1500, tsPct: 0.5388 },
      { gamesPlayed: 0, fga: 9999, tpa: 9999, points: 9999, tsPct: 0.9 },
    ];

    const cfg = deriveEraConfig('1995-96', rows);

    // The 0-game row is excluded from every aggregate.
    expect(cfg.playerCount).toBe(2);
    expect(cfg.league3PARate).toBe(Math.round((330 / 2300) * 1000) / 1000);
    expect(cfg.league3PARate).toBeCloseTo(0.143, 5);
    expect(cfg.leagueTsPct).toBe(Math.round(((0.5512 + 0.5388) / 2) * 1000) / 1000);
    expect(cfg.leaguePpg).toBeCloseTo(Math.round((3100 / 16.2) * 10) / 10, 5);
    expect(cfg.pace).toBe(100.0);
    expect(cfg.possessionCoefficient).toBe(1.0);
    // team_games = 162/10 = 16.2 -> 16.2/82 = 0.1975... -> truncated to 1 team.
    expect(cfg.teamCount).toBe(1);
  });

  it('falls back when no row has games played', () => {
    const cfg = deriveEraConfig('1995-96', [{ gamesPlayed: 0, fga: 5 }]);
    expect(cfg).toEqual(fallbackConfig('1995-96'));
  });

  it('derives a larger team count from a full league sample', () => {
    const rows: SeasonStatRow[] = Array.from({ length: 400 }, () => ({
      gamesPlayed: 82,
      fga: 1000,
      tpa: 150,
      points: 1300,
      tsPct: 0.53,
    }));
    const cfg = deriveEraConfig('1995-96', rows);
    // 400 * 82 / 10 = 3280 team-games -> 40 teams.
    expect(cfg.teamCount).toBe(40);
  });
});

describe('computeForSeason', () => {
  it('returns the fallback config when season-stats.json is missing', () => {
    const root = makeTempRoot();
    const cfg = computeForSeason('1900-01', root);
    expect(cfg).toEqual(fallbackConfig('1900-01'));
  });

  it('returns the fallback config when season-stats.json is an empty list', () => {
    const root = makeTempRoot();
    writeJson(join(root, '1995-96', 'season-stats.json'), []);
    const cfg = computeForSeason('1995-96', root);
    expect(cfg).toEqual(fallbackConfig('1995-96'));
  });

  it('reads and derives a real fixture file', () => {
    const root = makeTempRoot();
    writeJson(join(root, '1995-96', 'season-stats.json'), [
      { gamesPlayed: 82, fga: 1200, tpa: 180, points: 1600, tsPct: 0.5512 },
    ]);
    const cfg = computeForSeason('1995-96', root);
    expect(cfg.playerCount).toBe(1);
    expect(cfg.season).toBe('1995-96');
  });
});

describe('run', () => {
  it('writes era-config.json without a trailing newline', () => {
    const root = makeTempRoot();
    run(['1995-96'], root);
    const out = join(root, '1995-96', 'era-config.json');
    const content = readFileSync(out, 'utf8');
    expect(content.endsWith('\n')).toBe(false);
    expect((JSON.parse(content) as { season: string }).season).toBe('1995-96');
  });
});
