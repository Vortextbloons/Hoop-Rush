/**
 * Configuration for the import pipeline (port of scripts/import-nba/config.py).
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { foundingSeasonByTeamExternalId } from './lineage.js';

// …/packages/importer/src/ -> repo root is three levels up.
const SRC_DIR = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = resolve(SRC_DIR, '..');
export const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..');

export const PUBLIC_DATA =
  process.env.HOOP_RUSH_PUBLIC_DATA ?? join(REPO_ROOT, 'apps', 'web', 'static', 'data');
export const NBA_ROOT = process.env.HOOP_RUSH_NBA_ROOT ?? join(REPO_ROOT, 'raw-data', 'nba');
export const SHARED_ROOT = join(PUBLIC_DATA, 'shared');
export const RAW_CACHE = join(REPO_ROOT, '.raw_nba_cache');
mkdirSync(RAW_CACHE, { recursive: true });

export const CURRENT_SEASON_END_YEAR = 2026; // 2025-26 season

/**
 * Versioned supported-season configuration (spec/12): the 1960-61 through
 * 1989-90 historical band plus the existing 1990s-2020s coverage.
 */
export const DEFAULT_SEASONS = [
  '2025-26',
  '2024-25',
  '2023-24',
  '2022-23',
  '2021-22',
  '2020-21',
  '2019-20',
  '2018-19',
  '2017-18',
  '2016-17',
  '2015-16',
  '2014-15',
  '2013-14',
  '2012-13',
  '2011-12',
  '2010-11',
  '2009-10',
  '2008-09',
  '2007-08',
  '2006-07',
  '2005-06',
  '2004-05',
  '2003-04',
  '2002-03',
  '2001-02',
  '2000-01',
  '1999-00',
  '1998-99',
  '1997-98',
  '1996-97',
  '1995-96',
  '1994-95',
  '1993-94',
  '1992-93',
  '1991-92',
  '1990-91',
  '1989-90',
  '1988-89',
  '1987-88',
  '1986-87',
  '1985-86',
  '1984-85',
  '1983-84',
  '1982-83',
  '1981-82',
  '1980-81',
  '1979-80',
  '1978-79',
  '1977-78',
  '1976-77',
  '1975-76',
  '1974-75',
  '1973-74',
  '1972-73',
  '1971-72',
  '1970-71',
  '1969-70',
  '1968-69',
  '1967-68',
  '1966-67',
  '1965-66',
  '1964-65',
  '1963-64',
  '1962-63',
  '1961-62',
  '1960-61',
];

/**
 * Earliest NBA season per source team id, derived from the authoritative
 * lineage table (spec/12). Rosters are only fetched for teams that existed
 * in the season; ABA and predecessor-league rows are excluded.
 */
export const TEAM_FOUNDING_SEASON: Record<string, string> = foundingSeasonByTeamExternalId();

export function teamExistsInSeason(teamExternalId: string, season: string): boolean {
  const founding = TEAM_FOUNDING_SEASON[teamExternalId];
  if (founding === undefined) return true;
  return season >= founding;
}

/**
 * Source availability boundaries (spec/12): the first NBA season in which a
 * field family is a validated observation. Earlier values are `null` with
 * `not-applicable` or `unavailable` source status — never converted zeros.
 */
export const FIELD_AVAILABILITY: Record<string, string> = {
  steals: '1973-74',
  blocks: '1973-74',
  offensiveRebounds: '1973-74',
  defensiveRebounds: '1973-74',
  turnovers: '1977-78',
  threesMade: '1979-80',
  threesAttempted: '1979-80',
  gamesStarted: '1970-71',
  advanced: '1996-97',
};

export function fieldAvailableFrom(field: string, season: string): boolean {
  const boundary = FIELD_AVAILABILITY[field];
  if (boundary === undefined) return true;
  return season >= boundary;
}

export function outputDir(season: string): string {
  return join(NBA_ROOT, season);
}

export function ensureOutputDir(season: string): string {
  const out = outputDir(season);
  mkdirSync(out, { recursive: true });
  return out;
}
