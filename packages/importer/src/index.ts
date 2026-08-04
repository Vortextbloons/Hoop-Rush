/**
 * Build-time import pipeline for Hoop Rush.
 *
 * Python is the fetch layer (nba_api + asset CDNs, in `scripts/import-nba/`).
 * Everything else — normalization, lineage resolution, derivation, ratings,
 * pools, era profiles, manifest and opponent artifacts — is derived
 * here from the raw-data JSON snapshots (spec/12).
 */
export * from './config.js';
export * from './json.js';
export * from './fetch.js';
export * from './lineage.js';
export * as ratings from './ratings/index.js';
export * from './ratings/artifact.js';
export * as pools from './pools/compute.js';
export * as eraProfile from './era-profile/index.js';
export * as manifest from './manifest/index.js';
export * as opponent from './opponent/index.js';
export * as freeze from './freeze/index.js';
