/**
 * Era configs (port of compute_ratings.py ERA_CONFIGS / src/game/models/eraConfig.ts).
 */
export interface EraConfig {
  leaguePpg: number;
  league3PARate: number;
  pace: number;
}

export const MODERN_PPG = 114.7;
export const MODERN_3PA_RATE = 0.39;

export const ERA_CONFIGS: Record<string, EraConfig> = {
  '1990-91': { leaguePpg: 106.7, league3PARate: 0.1, pace: 96.4 },
  '1991-92': { leaguePpg: 106.5, league3PARate: 0.11, pace: 95.4 },
  '1992-93': { leaguePpg: 105.3, league3PARate: 0.12, pace: 94.7 },
  '1993-94': { leaguePpg: 101.5, league3PARate: 0.13, pace: 95.1 },
  '1994-95': { leaguePpg: 101.4, league3PARate: 0.15, pace: 94.7 },
  '1995-96': { leaguePpg: 99.5, league3PARate: 0.17, pace: 94.1 },
  '1996-97': { leaguePpg: 99.1, league3PARate: 0.18, pace: 91.1 },
  '1997-98': { leaguePpg: 95.6, league3PARate: 0.18, pace: 90.7 },
  '1998-99': { leaguePpg: 95.1, league3PARate: 0.18, pace: 91.1 },
  '1999-00': { leaguePpg: 97.5, league3PARate: 0.19, pace: 93.3 },
  '2000-01': { leaguePpg: 94.8, league3PARate: 0.19, pace: 92.4 },
  '2001-02': { leaguePpg: 95.1, league3PARate: 0.21, pace: 91.5 },
  '2002-03': { leaguePpg: 95.1, league3PARate: 0.22, pace: 91.5 },
  '2003-04': { leaguePpg: 93.4, league3PARate: 0.22, pace: 91.0 },
  '2004-05': { leaguePpg: 97.2, league3PARate: 0.23, pace: 90.9 },
  '2005-06': { leaguePpg: 97.0, league3PARate: 0.24, pace: 90.5 },
  '2006-07': { leaguePpg: 98.7, league3PARate: 0.25, pace: 90.4 },
  '2007-08': { leaguePpg: 99.9, league3PARate: 0.26, pace: 91.7 },
  '2008-09': { leaguePpg: 100.0, league3PARate: 0.27, pace: 92.2 },
  '2009-10': { leaguePpg: 100.4, league3PARate: 0.27, pace: 92.7 },
  '2010-11': { leaguePpg: 99.6, league3PARate: 0.27, pace: 92.1 },
  '2011-12': { leaguePpg: 96.3, league3PARate: 0.26, pace: 91.3 },
  '2012-13': { leaguePpg: 98.1, league3PARate: 0.28, pace: 92.7 },
  '2013-14': { leaguePpg: 101.0, league3PARate: 0.28, pace: 93.5 },
  '2014-15': { leaguePpg: 100.0, league3PARate: 0.27, pace: 93.5 },
  '2015-16': { leaguePpg: 102.7, league3PARate: 0.27, pace: 95.8 },
  '2016-17': { leaguePpg: 105.6, league3PARate: 0.31, pace: 96.4 },
  '2017-18': { leaguePpg: 106.3, league3PARate: 0.33, pace: 97.3 },
  '2018-19': { leaguePpg: 111.2, league3PARate: 0.36, pace: 100.0 },
  '2019-20': { leaguePpg: 111.8, league3PARate: 0.38, pace: 100.3 },
  '2020-21': { leaguePpg: 112.1, league3PARate: 0.39, pace: 99.8 },
  '2021-22': { leaguePpg: 110.7, league3PARate: 0.39, pace: 98.2 },
  '2022-23': { leaguePpg: 114.7, league3PARate: 0.4, pace: 99.2 },
  '2023-24': { leaguePpg: 114.9, league3PARate: 0.4, pace: 99.0 },
  '2024-25': { leaguePpg: 114.7, league3PARate: 0.39, pace: 99.2 },
};

export const DEFAULT_ERA: EraConfig = { leaguePpg: 114.7, league3PARate: 0.39, pace: 99.2 };

export function getEra(season: string): EraConfig {
  return ERA_CONFIGS[season] ?? DEFAULT_ERA;
}
