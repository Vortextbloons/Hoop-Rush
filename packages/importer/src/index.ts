/**
 * Build-time import pipeline for Hoop Rush.
 *
 * Python is the fetch layer (nba_api + asset CDNs, in `scripts/import-nba/`).
 * Everything else — normalization, lineage resolution, derivation, ratings,
 * pools, era profiles, manifest and opponent artifacts — is derived
 * here from the raw-data JSON snapshots (spec/12).
 */
export * from './config.ts';
export * from './json.ts';
export * from './fetch.ts';
export * from './lineage.ts';
export * as ratings from './ratings/index.ts';
export * from './ratings/artifact.ts';
export * as pools from './pools/compute.ts';
export * as eraProfile from './era-profile/index.ts';
export * as manifest from './manifest/index.ts';
export * as opponent from './opponent/index.ts';
export * from './reconstruction/index.ts';
export * as freeze from './freeze/index.ts';
