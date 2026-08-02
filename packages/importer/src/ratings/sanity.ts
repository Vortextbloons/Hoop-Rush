/**
 * Manual sanity runner for ratings computation against real raw data.
 *
 * Usage (from repo root, with a scratch NBA_ROOT):
 *   HOOP_RUSH_NBA_ROOT=<temp copy of raw-data/nba> pnpm --filter @hoop-rush/importer exec tsx src/ratings/sanity.ts <season>
 */
import { computeForSeason } from './compute.js';

const season = process.argv[2] ?? '1995-96';
computeForSeason(season, true);
