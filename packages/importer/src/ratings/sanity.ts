import { computeForSeason } from './compute.ts';
const season = process.argv[2] ?? '1995-96';
computeForSeason(season, true);
