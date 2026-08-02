/**
 * League stint aggregates for era simulation profiles (spec/12 provenance).
 *
 * Field families that are absent across an entire era stay `null`
 * (unavailable) instead of being converted to zero; a family with partial
 * per-row missingness sums the present rows and reports its sample coverage.
 */
import { join } from 'node:path';
import { NBA_ROOT } from '../config.js';
import { readJson, safeFloat } from '../json.js';

export interface LeagueAggregates {
  teamGames: number;
  /** Possessions estimate; null when rebound splits or turnovers are unavailable. */
  possessions: number | null;
  points: number;
  fga: number;
  fgm: number;
  /** Null when the league did not publish three-point attempts. */
  tpa: number | null;
  /** Null when the league did not publish three-point makes. */
  tpm: number | null;
  fta: number;
  ftm: number;
  oreb: number | null;
  dreb: number | null;
  ast: number;
  stl: number | null;
  tov: number | null;
  pf: number;
  /** Rows carrying each family (sample coverage diagnostic). */
  coverage: Record<string, number>;
  /** Total rows scanned. */
  rows: number;
}

/** One stint row; only the fields summed here are read (rest are ignored). */
export interface StintRow {
  fga?: unknown;
  fgm?: unknown;
  tpa?: unknown;
  tpm?: unknown;
  fta?: unknown;
  ftm?: unknown;
  offensiveRebounds?: unknown;
  defensiveRebounds?: unknown;
  assists?: unknown;
  steals?: unknown;
  turnovers?: unknown;
  fouls?: unknown;
  points?: unknown;
  gamesPlayed?: unknown;
}

interface Sum {
  total: number;
  rows: number;
}

function accumulate(sum: Sum, value: unknown): void {
  if (value === null || value === undefined) return;
  const n = safeFloat(value);
  if (!Number.isFinite(n)) return;
  sum.total += n;
  sum.rows += 1;
}

function fin(value: number | null, sum: Sum): number | null {
  if (sum.rows === 0) return null;
  return sum.total;
}

/** Pure derivation over stint rows (exposed for tests; `deriveLeagueAggregates` loads them). */
export function deriveLeagueAggregatesFromStints(stints: readonly StintRow[]): LeagueAggregates {
  const sums: Record<string, Sum> = {};
  const key = (name: string): Sum => {
    let sum = sums[name];
    if (!sum) {
      sum = { total: 0, rows: 0 };
      sums[name] = sum;
    }
    return sum;
  };
  let playerGames = 0;
  for (const stint of stints) {
    accumulate(key('fga'), stint.fga);
    accumulate(key('fgm'), stint.fgm);
    accumulate(key('tpa'), stint.tpa);
    accumulate(key('tpm'), stint.tpm);
    accumulate(key('fta'), stint.fta);
    accumulate(key('ftm'), stint.ftm);
    accumulate(key('oreb'), stint.offensiveRebounds);
    accumulate(key('dreb'), stint.defensiveRebounds);
    accumulate(key('ast'), stint.assists);
    accumulate(key('stl'), stint.steals);
    accumulate(key('tov'), stint.turnovers);
    accumulate(key('pf'), stint.fouls);
    accumulate(key('pts'), stint.points);
    accumulate(key('gp'), stint.gamesPlayed);
    playerGames += Math.max(0, Math.trunc(safeFloat(stint.gamesPlayed)));
  }

  // Each game contributes ~20 player-games (ten players per team), so
  // player_games / 10 approximates the number of NBA team-games. Total
  // possessions per team-game is the league pace; per-game totals use the
  // same denominator.
  const teamGames = Math.max(1.0, playerGames / 10.0);
  const fga = sums['fga']?.total ?? 0;
  const fta = sums['fta']?.total ?? 0;
  const oreb = fin(0, sums['oreb'] ?? { total: 0, rows: 0 });
  const tov = fin(0, sums['tov'] ?? { total: 0, rows: 0 });
  const possessions =
    oreb === null || tov === null ? null : fga + 0.44 * fta - oreb + tov;
  const coverage: Record<string, number> = {};
  for (const [name, sum] of Object.entries(sums)) {
    coverage[name] = sum.rows;
  }
  return {
    teamGames,
    possessions,
    points: sums['pts']?.total ?? 0,
    fga,
    fgm: sums['fgm']?.total ?? 0,
    tpa: fin(0, sums['tpa'] ?? { total: 0, rows: 0 }),
    tpm: fin(0, sums['tpm'] ?? { total: 0, rows: 0 }),
    fta,
    ftm: sums['ftm']?.total ?? 0,
    oreb,
    dreb: fin(0, sums['dreb'] ?? { total: 0, rows: 0 }),
    ast: sums['ast']?.total ?? 0,
    stl: fin(0, sums['stl'] ?? { total: 0, rows: 0 }),
    tov,
    pf: sums['pf']?.total ?? 0,
    coverage,
    rows: stints.length,
  };
}

/** Sum every packaged stints.json row across the given seasons. */
export function deriveLeagueAggregates(seasons: readonly string[]): LeagueAggregates {
  const rows: StintRow[] = [];
  for (const season of seasons) {
    const stints = readJson(join(NBA_ROOT, season, 'stints.json')) as StintRow[];
    rows.push(...stints);
  }
  return deriveLeagueAggregatesFromStints(rows);
}
