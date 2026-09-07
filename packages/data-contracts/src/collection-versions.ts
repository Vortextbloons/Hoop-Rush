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
