/**
 * League stint aggregates for era simulation profiles (port of
 * `derive_league_aggregates` from scripts/import-nba/compute_era_sim_profile.py).
 */
import { join } from 'node:path';
import { NBA_ROOT } from '../config.js';
import { readJson, safeFloat } from '../json.js';

export interface LeagueAggregates {
  teamGames: number;
  possessions: number;
  points: number;
  fga: number;
  fgm: number;
  tpa: number;
  tpm: number;
  fta: number;
  ftm: number;
  oreb: number;
  dreb: number;
  ast: number;
  stl: number;
  tov: number;
  pf: number;
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

/** Pure derivation over stint rows (exposed for tests; `deriveLeagueAggregates` loads them). */
export function deriveLeagueAggregatesFromStints(stints: readonly StintRow[]): LeagueAggregates {
  let fga = 0.0;
  let fgm = 0.0;
  let tpa = 0.0;
  let tpm = 0.0;
  let fta = 0.0;
  let ftm = 0.0;
  let oreb = 0.0;
  let dreb = 0.0;
  let ast = 0.0;
  let stl = 0.0;
  let tov = 0.0;
  let pf = 0.0;
  let pts = 0.0;
  let playerGames = 0.0;
  for (const stint of stints) {
    fga += safeFloat(stint.fga);
    fgm += safeFloat(stint.fgm);
    tpa += safeFloat(stint.tpa);
    tpm += safeFloat(stint.tpm);
    fta += safeFloat(stint.fta);
    ftm += safeFloat(stint.ftm);
    oreb += safeFloat(stint.offensiveRebounds);
    dreb += safeFloat(stint.defensiveRebounds);
    ast += safeFloat(stint.assists);
    stl += safeFloat(stint.steals);
    tov += safeFloat(stint.turnovers);
    pf += safeFloat(stint.fouls);
    pts += safeFloat(stint.points);
    playerGames += safeFloat(stint.gamesPlayed);
  }

  // Each game contributes ~20 player-games (ten players per team), so
  // player_games / 10 approximates the number of NBA team-games. Total
  // possessions per team-game is the league pace; per-game totals use the
  // same denominator.
  const teamGames = Math.max(1.0, playerGames / 10.0);
  const possessions = fga + 0.44 * fta - oreb + tov;
  return {
    teamGames,
    possessions,
    points: pts,
    fga,
    fgm,
    tpa,
    tpm,
    fta,
    ftm,
    oreb,
    dreb,
    ast,
    stl,
    tov,
    pf,
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
