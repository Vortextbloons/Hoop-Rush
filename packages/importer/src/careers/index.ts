/**
 * Career stats by grouping all season-stats.json files (port of
 * scripts/import-nba/fetch_career_stats.py).
 *
 * Output: raw-data/nba/{season}/career-stats.json — one record per player on
 * that season's roster, with the player's full career across every packaged
 * season. This replaces the per-player API loop with instant computation.
 */
import { join } from 'node:path';
import { DEFAULT_SEASONS, NBA_ROOT } from '../config.js';
import { ensureDir, fileExists, readJson, writeJsonRetry } from '../json.js';

export interface CareerRecord {
  playerExternalId: string;
  seasons: Record<string, unknown>[];
}

/** The subset of a season-stats row used for grouping. */
export interface SeasonStatRow {
  playerExternalId?: unknown;
  playerId?: unknown;
}

/** Coerce an id field like Python's `x or ""`: only strings/numbers are meaningful. */
function toKey(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function playerKey(row: Record<string, unknown>): string {
  // Python: `player_stat.get("playerExternalId") or player_stat.get("playerId", "")`.
  return toKey(row['playerExternalId']) || toKey(row['playerId']);
}

/**
 * Read all season-stats.json files, group by player, write career stats for
 * every player on each season's roster. `root` is the data root (NBA_ROOT by
 * default; tests pass a temporary fixture root).
 */
export function computeCareerStats(
  seasons: readonly string[] = DEFAULT_SEASONS,
  root = NBA_ROOT,
): void {
  const careerMap = new Map<string, CareerRecord>();

  // Group first so a player's career record is complete even for seasons
  // where they no longer appear on a roster.
  for (const season of seasons) {
    const seasonPath = join(root, season, 'season-stats.json');
    if (!fileExists(seasonPath)) continue;
    const stats = readJson(seasonPath) as Record<string, unknown>[];
    for (const playerStat of stats) {
      const pid = playerKey(playerStat);
      if (!pid) continue;
      let career = careerMap.get(pid);
      if (career === undefined) {
        career = { playerExternalId: pid, seasons: [] };
        careerMap.set(pid, career);
      }
      career.seasons.push(playerStat);
    }
  }

  for (const season of seasons) {
    const rosterPath = join(root, season, 'roster.json');
    if (!fileExists(rosterPath)) continue;
    const roster = readJson(rosterPath) as Record<string, unknown>[];
    const playerIds = new Set<string>();
    for (const p of roster) {
      // Python: `p.get("externalId") or p.get("id", "")`.
      const pid = toKey(p['externalId']) || toKey(p['id']);
      if (pid) playerIds.add(pid);
    }
    const careers: CareerRecord[] = [];
    for (const pid of playerIds) {
      const career = careerMap.get(pid);
      if (career !== undefined) careers.push(career);
    }
    ensureDir(join(root, season));
    writeJsonRetry(join(root, season, 'career-stats.json'), careers);
    console.log(`  [OK] computed ${String(careers.length)} career stat files for ${season}`);
  }
}

/** Compatibility wrapper mirroring the Python `run` entry point. */
export function run(seasons?: readonly string[]): void {
  console.log('[careers] computing career stats from season data');
  computeCareerStats(seasons);
}
