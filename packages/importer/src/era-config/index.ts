/**
 * League-average era config per season (port of
 * scripts/import-nba/compute_era_config.py).
 *
 * Reads season-stats.json (produced by fetch_season_stats) and writes a small
 * era-config.json next to it.
 */
import { join } from 'node:path';
import { DEFAULT_SEASONS, NBA_ROOT } from '../config.js';
import { fileExists, readJson, safeFloat, writeJsonRetry } from '../json.js';

export interface EraConfig {
  season: string;
  pace: number;
  league3PARate: number;
  leagueTsPct: number;
  leaguePpg: number;
  possessionCoefficient: number;
  playerCount?: number;
  teamCount?: number;
}

export interface SeasonStatRow {
  gamesPlayed?: unknown;
  fga?: unknown;
  tpa?: unknown;
  points?: unknown;
  tsPct?: unknown;
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;
const round1 = (value: number): number => Math.round(value * 10) / 10;

export function fallbackConfig(season: string): EraConfig {
  return {
    season,
    pace: 95,
    league3PARate: 0.25,
    leagueTsPct: 0.55,
    leaguePpg: 105,
    possessionCoefficient: 1.0,
  };
}

/**
 * Pure config derivation over season-stat rows (exposed for tests;
 * `computeForSeason` loads the file).
 */
export function deriveEraConfig(season: string, rows: readonly SeasonStatRow[]): EraConfig {
  const valid = rows.filter((row) => safeFloat(row.gamesPlayed) > 0);
  if (valid.length === 0) return fallbackConfig(season);

  let totalFga = 0;
  let total3pa = 0;
  let totalPts = 0;
  let totalGames = 0;
  for (const row of valid) {
    totalFga += safeFloat(row.fga);
    total3pa += safeFloat(row.tpa);
    totalPts += safeFloat(row.points);
    totalGames += safeFloat(row.gamesPlayed);
  }
  // ~10 players log minutes per team-game; player-games / 10 approximates
  // league team-games (and self-corrects for the 50-game 1998-99 season).
  const teamGames = totalGames ? Math.max(1, totalGames / 10) : 82 * 30;
  const totalTeams = teamGames ? Math.max(1, teamGames / 82) : 30;

  const league3paRate = totalFga ? total3pa / totalFga : 0.3;
  const leaguePpg = teamGames ? totalPts / teamGames : 100;
  const avgTs = valid.reduce((sum, row) => sum + safeFloat(row.tsPct), 0) / valid.length;

  return {
    season,
    pace: 100.0,
    league3PARate: round3(league3paRate),
    leagueTsPct: round3(avgTs),
    leaguePpg: round1(leaguePpg),
    possessionCoefficient: 1.0,
    playerCount: valid.length,
    teamCount: Math.trunc(totalTeams),
  };
}

export function computeForSeason(season: string, root = NBA_ROOT): EraConfig {
  const path = join(root, season, 'season-stats.json');
  if (!fileExists(path)) return fallbackConfig(season);
  const rows = readJson(path);
  // The Python source reads a JSON array; treat any other shape (including an
  // empty file / empty list) as "no data" and emit the fallback config.
  if (!Array.isArray(rows)) return fallbackConfig(season);
  return deriveEraConfig(season, rows as SeasonStatRow[]);
}

export function run(seasons: readonly string[] = DEFAULT_SEASONS, root = NBA_ROOT): void {
  for (const season of seasons) {
    const cfg = computeForSeason(season, root);
    writeJsonRetry(join(root, season, 'era-config.json'), cfg);
    console.log(`[${season}] wrote era-config.json`);
  }
}
