export const COLLECTION_SCHEMA_VERSION = 1;
export const COLLECTION_STATE_SCHEMA_VERSION = 2;
export const COLLECTION_VERSION = 'collection-v1';
export const COLLECTION_CATALOG_VERSION = 'collection-catalog-v1';
export const COLLECTION_OVERLAY_VERSION = 'collection-overlay-v1';
export const COLLECTION_PACK_RULES_VERSION = 'collection-pack-rules-v1';
export const COLLECTION_ECONOMY_VERSION = 'collection-economy-v1';
export const COLLECTION_COMMAND_V1_VERSION = 'collection-command-v1';
export const COLLECTION_COMMAND_VERSION = 'collection-command-v2';
export const COLLECTION_REPLAY_V1_VERSION = 'collection-replay-v1';
export const COLLECTION_REPLAY_VERSION = 'collection-replay-v2';
export const COLLECTION_PACK_TARGETS_VERSION = 'pack-targets-v1';
export const COLLECTION_SAVE_V1_VERSION = 1;
export const COLLECTION_SAVE_VERSION = 2;
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
export const COLLECTION_GAME_V1_VERSION = 'collection-game-v1';
export const COLLECTION_GAME_V2_VERSION = 'collection-game-v2';
export const COLLECTION_GAME_VERSION = 'collection-game-v3';
export const COLLECTION_GAME_RULES_V1_VERSION = 'collection-game-rules-v1';
export const COLLECTION_GAME_V1_RULES_VERSION = COLLECTION_GAME_RULES_V1_VERSION;
export const COLLECTION_GAME_RULES_VERSION = 'collection-game-rules-v2';
export const COLLECTION_REWARD_V1_VERSION = 'collection-reward-v1';
export const COLLECTION_REWARD_V2_VERSION = 'collection-reward-v2';
export const COLLECTION_REWARD_VERSION = 'collection-reward-v3';
export const COLLECTION_GAME_V1_REPLAY_VERSION = 'collection-game-replay-v1';
export const COLLECTION_GAME_V2_REPLAY_VERSION = 'collection-game-replay-v2';
export const COLLECTION_GAME_REPLAY_VERSION = 'collection-game-replay-v3';
export const COLLECTION_PLAY_SAVE_V1_VERSION = 1;
export const COLLECTION_PLAY_SAVE_V2_VERSION = 2;
export const COLLECTION_PLAY_SAVE_VERSION = 3;
export const COLLECTION_GAME_SEED_DERIVATION_VERSION = 'collection-game-seeds-v2';
export const COLLECTION_GAME_V1_SEED_DERIVATION_VERSION = 'collection-game-seeds-v1';
export const COLLECTION_GAME_V1_WORKER_WIRE_VERSION = 1;
export const COLLECTION_GAME_V2_WORKER_WIRE_VERSION = 2;
export const COLLECTION_GAME_WORKER_WIRE_VERSION = 3;
export const COLLECTION_GAME_CPU_ROSTER_SIZE = 12;
export const COLLECTION_GAME_REWARD_WIN_COINS = 100;
export const COLLECTION_GAME_REWARD_LOSS_COINS = 10;
export const COLLECTION_GAME_ENVIRONMENT_ERA_ID = '2020s';
export const COLLECTION_GAME_HOME_COURT_POLICY = 'neutral-home-court';

export const COLLECTION_GAME_REWARD_OBJECTIVE_COINS = 30;
export const COLLECTION_GAME_REWARD_MARGIN_COIN_PER_POINT = 1;
export const COLLECTION_GAME_REWARD_MARGIN_CAP_POINTS = 20;
export const COLLECTION_GAME_FIRST_CLEAR_COINS = {
  street: 200,
  pro: 350,
  legend: 500,
} as const;

export const COLLECTION_DIFFICULTY_VERSION = 'collection-difficulty-v1';
export const COLLECTION_OBJECTIVE_VERSION = 'collection-objectives-v1';
export const COLLECTION_GAME_COMMAND_V1_VERSION = 'collection-game-command-v1';
export const COLLECTION_GAME_COMMAND_VERSION = 'collection-game-command-v2';
export const COLLECTION_GAME_TARGETS_VERSION = 'collection-game-targets-v1';

export const COLLECTION_PROGRESSION_VERSION = 'collection-progression-v1';
export const COLLECTION_TARGETING_VERSION = 'collection-targeting-v1';
export const COLLECTION_SET_REWARD_VERSION = 'collection-set-reward-v1';
export const COLLECTION_CHALLENGE_VERSION = 'collection-challenge-v1';
export const COLLECTION_CHALLENGE_REWARD_VERSION = 'collection-challenge-reward-v1';
export const COLLECTION_PROGRESSION_TARGETS_VERSION = 'collection-progression-targets-v1';

export const COLLECTION_TARGET_BASE_WEIGHT_BP = 10_000;

export const COLLECTION_DIFFICULTY_ORDER = ['street', 'pro', 'legend'] as const;
export type CollectionDifficultyOrder = (typeof COLLECTION_DIFFICULTY_ORDER)[number];

export const COLLECTION_DIFFICULTY_NAMES = {
  street: 'Street',
  pro: 'Pro',
  legend: 'Legend',
} as const;
