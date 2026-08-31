import { join } from 'node:path';
import { NBA_ROOT, fieldAvailableFrom } from '../config.ts';
import { readJson, safeFloat } from '../json.ts';
export interface LeagueAggregates {
  teamGames: number;
  possessions: number | null;
  points: number;
  fga: number;
  fgm: number;
  tpa: number | null;
  tpm: number | null;
  fta: number;
  ftm: number;
  oreb: number | null;
  dreb: number | null;
  ast: number;
  stl: number | null;
  tov: number | null;
  pf: number;
  coverage: Record<string, number>;
  rows: number;
  pairs: {
    stealShare: {
      stl: number;
      tov: number;
      seasons: number;
    } | null;
    reboundSplit: {
      oreb: number;
      dreb: number;
      seasons: number;
    } | null;
    turnoverPerPossession: {
      tov: number;
      possessions: number;
      seasons: number;
    } | null;
  };
}
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
function fin(sum: Sum): number | null {
  if (sum.rows === 0) return null;
  return sum.total;
}
const FAMILY_KEY: Record<string, string> = {
  tpa: 'tpa',
  tpm: 'tpm',
  oreb: 'offensiveRebounds',
  dreb: 'defensiveRebounds',
  stl: 'steals',
  tov: 'turnovers',
};
export function deriveSeasonAggregatesFromStints(
  season: string,
  stints: readonly StintRow[],
): LeagueAggregates {
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
  const teamGames = Math.max(1.0, playerGames / 10.0);
  const fga = sums['fga']?.total ?? 0;
  const fta = sums['fta']?.total ?? 0;
  const family = (name: string): number | null => {
    if (!fieldAvailableFrom(FAMILY_KEY[name] ?? name, season)) return null;
    return fin(sums[name] ?? { total: 0, rows: 0 });
  };
  const oreb = family('oreb');
  const tov = family('tov');
  const possessions = oreb === null || tov === null ? null : fga + 0.44 * fta - oreb + tov;
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
    tpa: family('tpa'),
    tpm: family('tpm'),
    fta,
    ftm: sums['ftm']?.total ?? 0,
    oreb,
    dreb: family('dreb'),
    ast: sums['ast']?.total ?? 0,
    stl: family('stl'),
    tov,
    pf: sums['pf']?.total ?? 0,
    coverage,
    rows: stints.length,
    pairs: {
      stealShare: null,
      reboundSplit: null,
      turnoverPerPossession: null,
    },
  };
}
export function deriveLeagueAggregates(seasons: readonly string[]): LeagueAggregates {
  const combined: LeagueAggregates = {
    teamGames: 0,
    possessions: 0,
    points: 0,
    fga: 0,
    fgm: 0,
    tpa: 0,
    tpm: 0,
    fta: 0,
    ftm: 0,
    oreb: 0,
    dreb: 0,
    ast: 0,
    stl: 0,
    tov: 0,
    pf: 0,
    coverage: {},
    rows: 0,
    pairs: {
      stealShare: null,
      reboundSplit: null,
      turnoverPerPossession: null,
    },
  };
  let first: LeagueAggregates | null = null;
  const pairSeasons = {
    stealShare: { stl: 0, tov: 0, count: 0 },
    reboundSplit: { oreb: 0, dreb: 0, count: 0 },
    turnoverPerPossession: { tov: 0, possessions: 0, count: 0 },
  };
  for (const season of seasons) {
    const stints = readJson(join(NBA_ROOT, season, 'stints.json')) as StintRow[];
    const a = deriveSeasonAggregatesFromStints(season, stints);
    if (first === null) first = a;
    for (const key of [
      'points',
      'fga',
      'fgm',
      'tpa',
      'tpm',
      'fta',
      'ftm',
      'oreb',
      'dreb',
      'ast',
      'stl',
      'tov',
      'pf',
    ] as const) {
      const value = a[key];
      combined[key] += value ?? 0;
    }
    combined.teamGames += a.teamGames;
    combined.rows += a.rows;
    for (const [name, count] of Object.entries(a.coverage)) {
      combined.coverage[name] = (combined.coverage[name] ?? 0) + count;
    }
    if (a.stl !== null && a.tov !== null) {
      pairSeasons.stealShare.stl += a.stl;
      pairSeasons.stealShare.tov += a.tov;
      pairSeasons.stealShare.count += 1;
    }
    if (a.oreb !== null && a.dreb !== null) {
      pairSeasons.reboundSplit.oreb += a.oreb;
      pairSeasons.reboundSplit.dreb += a.dreb;
      pairSeasons.reboundSplit.count += 1;
    }
    if (a.tov !== null && a.possessions !== null) {
      pairSeasons.turnoverPerPossession.tov += a.tov;
      pairSeasons.turnoverPerPossession.possessions += a.possessions;
      pairSeasons.turnoverPerPossession.count += 1;
    }
  }
  const family = (key: keyof LeagueAggregates): number | null => {
    const value = first === null ? null : (first[key] as number | null);
    if (value === null) return null;
    return combined[key] as number;
  };
  combined.tpa = family('tpa');
  combined.tpm = family('tpm');
  combined.oreb = family('oreb');
  combined.dreb = family('dreb');
  combined.stl = family('stl');
  combined.tov = family('tov');
  const oreb = combined.oreb;
  const tov = combined.tov;
  combined.possessions =
    oreb === null || tov === null ? null : combined.fga + 0.44 * combined.fta - oreb + tov;
  combined.pairs = {
    stealShare:
      pairSeasons.stealShare.count > 0
        ? {
            stl: pairSeasons.stealShare.stl,
            tov: pairSeasons.stealShare.tov,
            seasons: pairSeasons.stealShare.count,
          }
        : null,
    reboundSplit:
      pairSeasons.reboundSplit.count > 0
        ? {
            oreb: pairSeasons.reboundSplit.oreb,
            dreb: pairSeasons.reboundSplit.dreb,
            seasons: pairSeasons.reboundSplit.count,
          }
        : null,
    turnoverPerPossession:
      pairSeasons.turnoverPerPossession.count > 0
        ? {
            tov: pairSeasons.turnoverPerPossession.tov,
            possessions: pairSeasons.turnoverPerPossession.possessions,
            seasons: pairSeasons.turnoverPerPossession.count,
          }
        : null,
  };
  return combined;
}
export function deriveLeagueAggregatesFromStints(stints: readonly StintRow[]): LeagueAggregates {
  return deriveSeasonAggregatesFromStints('2099-00', stints);
}
