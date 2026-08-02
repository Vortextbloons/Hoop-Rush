/**
 * Configuration for the import pipeline (port of scripts/import-nba/config.py).
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

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
];

/**
 * Earliest NBA season key in which each current franchise existed, by NBA team
 * external id. Rosters are only fetched for teams that existed in the season.
 */
export const TEAM_FOUNDING_SEASON: Record<string, string> = {
  '1610612737': '1946-47', // Hawks
  '1610612738': '1946-47', // Celtics
  '1610612751': '1976-77', // Nets (ABA before)
  '1610612766': '2004-05', // Hornets (Bobcats expansion)
  '1610612741': '1966-67', // Bulls
  '1610612739': '1970-71', // Cavaliers
  '1610612742': '1980-81', // Mavericks
  '1610612743': '1976-77', // Nuggets (ABA before)
  '1610612765': '1948-49', // Pistons
  '1610612744': '1946-47', // Warriors
  '1610612745': '1967-68', // Rockets
  '1610612754': '1976-77', // Pacers (ABA before)
  '1610612746': '1970-71', // Clippers (Braves)
  '1610612747': '1948-49', // Lakers
  '1610612763': '1995-96', // Grizzlies
  '1610612748': '1988-89', // Heat
  '1610612749': '1968-69', // Bucks
  '1610612750': '1989-90', // Timberwolves
  '1610612740': '1988-89', // Pelicans (Hornets lineage)
  '1610612752': '1946-47', // Knicks
  '1610612760': '1967-68', // Thunder (SuperSonics)
  '1610612753': '1989-90', // Magic
  '1610612755': '1949-50', // 76ers
  '1610612756': '1968-69', // Suns
  '1610612757': '1970-71', // Trail Blazers
  '1610612758': '1948-49', // Kings
  '1610612759': '1976-77', // Spurs (ABA before)
  '1610612761': '1995-96', // Raptors
  '1610612762': '1974-75', // Jazz
  '1610612764': '1961-62', // Wizards
};

export function teamExistsInSeason(teamExternalId: string, season: string): boolean {
  const founding = TEAM_FOUNDING_SEASON[teamExternalId];
  if (founding === undefined) return true;
  return season >= founding;
}

export function outputDir(season: string): string {
  return join(NBA_ROOT, season);
}

export function ensureOutputDir(season: string): string {
  const out = outputDir(season);
  mkdirSync(out, { recursive: true });
  return out;
}
