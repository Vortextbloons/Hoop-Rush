/**
 * Build-time import pipeline for Hoop Rush.
 *
 * Python is the fetch layer (nba_api + asset CDNs, in `scripts/import-nba/`).
 * Everything else — ratings, pools, era profiles, careers, manifest and opponent
 * artifacts — is derived here from the raw-data JSON snapshots.
 */
export * from './config.js';
export * from './json.js';
export * from './rng.js';
export * from './fetch.js';
export * as ratings from './ratings/index.js';
export * as pools from './pools/compute.js';
export * as eraProfile from './era-profile/index.js';
export * as eraConfig from './era-config/index.js';
export * as careers from './careers/index.js';
export * as manifest from './manifest/index.js';
export * as opponent from './opponent/index.js';
export * as freeze from './freeze/index.js';
