export const HAVOC_MULTIPLAYER_VERSION = 'havoc-multiplayer-v2';
export const HAVOC_MULTIPLAYER_SEED_DERIVATION_VERSION = 'havoc-multiplayer-seeds-v1';
export const HAVOC_MULTIPLAYER_SEED_ROOT = 'havoc-multiplayer-v1';
export const HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION = 1;
export const HAVOC_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION = 1;
export const HAVOC_MULTIPLAYER_PICK_TIMEOUT_MS = 60 * 1000;
export const HAVOC_MULTIPLAYER_BROADCAST_MS = 8 * 1000;
export const HAVOC_MULTIPLAYER_SHOWDOWN_MS = 4 * 1000;
export const HAVOC_MULTIPLAYER_GAME_READY_TIMEOUT_MS = 60 * 1000;
export const HAVOC_MULTIPLAYER_GAME_RESULTS_HOLD_MS = 60 * 1000;
export const HAVOC_MULTIPLAYER_SERIES_WINS = 4;
export const HAVOC_MULTIPLAYER_SERIES_GAMES = 7;
export const HAVOC_MULTIPLAYER_TURNS = 10;
export const HAVOC_MULTIPLAYER_PICKS_PER_PARTICIPANT = 5;
export const HAVOC_MULTIPLAYER_REROLLS_PER_PARTICIPANT = 1;
export const HAVOC_MULTIPLAYER_CODE_TTL_MS = 15 * 60 * 1000;
export const HAVOC_MULTIPLAYER_ROOM_RETENTION_MS = 24 * 60 * 60 * 1000;

export const HAVOC_CURATED_RATING_BAND_NAMES = ['under-80', '80-89', '90-plus'] as const;
export type HavocCuratedRatingBandName = (typeof HAVOC_CURATED_RATING_BAND_NAMES)[number];
export const HAVOC_CURATED_RATING_BANDS: Record<
  HavocCuratedRatingBandName,
  { minOverall: number; maxOverall: number }
> = {
  'under-80': { minOverall: 0, maxOverall: 79 },
  '80-89': { minOverall: 80, maxOverall: 89 },
  '90-plus': { minOverall: 90, maxOverall: 100 },
};
export const HAVOC_CURATED_RECIPE: readonly HavocCuratedRatingBandName[] = [
  '90-plus',
  '90-plus',
  '80-89',
  'under-80',
  'under-80',
];
