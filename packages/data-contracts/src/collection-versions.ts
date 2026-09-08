export const COLLECTION_SCHEMA_VERSION = 1;
export const COLLECTION_VERSION = 'collection-v1';
export const COLLECTION_CATALOG_VERSION = 'collection-catalog-v1';
export const COLLECTION_OVERLAY_VERSION = 'collection-overlay-v1';
export const COLLECTION_PACK_RULES_VERSION = 'collection-pack-rules-v1';
export const COLLECTION_ECONOMY_VERSION = 'collection-economy-v1';
export const COLLECTION_COMMAND_VERSION = 'collection-command-v1';
export const COLLECTION_REPLAY_VERSION = 'collection-replay-v1';
export const COLLECTION_PACK_TARGETS_VERSION = 'pack-targets-v1';
export const COLLECTION_SAVE_VERSION = 1;
export const COLLECTION_SEED_DERIVATION_VERSION = 'collection-seeds-v1';
export const COLLECTION_SEED_NAMESPACES = {
  starter: 'starter',
  pulls: 'pulls',
  targeting: 'targeting',
  cpuTeams: 'cpu-teams',
  objectives: 'objectives',
} as const;
export type CollectionSeedNamespace = keyof typeof COLLECTION_SEED_NAMESPACES;
export const COLLECTION_RARITY_ORDER = [
  'Ember',
  'Eruption',
  'Apex',
  'Titan',
  'Eclipse',
  'Immortal',
] as const;
export const COLLECTION_TEAM_VERSION = 'collection-team-v1';
export const COLLECTION_GAME_VERSION = 'collection-game-v1';
export const COLLECTION_GAME_RULES_VERSION = 'collection-game-rules-v1';
export const COLLECTION_REWARD_VERSION = 'collection-reward-v1';
export const COLLECTION_GAME_REPLAY_VERSION = 'collection-game-replay-v1';
export const COLLECTION_PLAY_SAVE_VERSION = 1;
export const COLLECTION_GAME_SEED_DERIVATION_VERSION = 'collection-game-seeds-v1';
export const COLLECTION_GAME_WORKER_WIRE_VERSION = 1;
export const COLLECTION_GAME_CPU_ROSTER_SIZE = 12;
export const COLLECTION_GAME_REWARD_WIN_COINS = 100;
export const COLLECTION_GAME_REWARD_LOSS_COINS = 10;
export const COLLECTION_GAME_ENVIRONMENT_ERA_ID = '2020s';
export const COLLECTION_GAME_HOME_COURT_POLICY = 'neutral-home-court';
