import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLLECTION_GAME_CPU_ROSTER_SIZE,
  COLLECTION_GAME_ENVIRONMENT_ERA_ID,
  COLLECTION_GAME_HOME_COURT_POLICY,
  COLLECTION_GAME_REPLAY_VERSION,
  COLLECTION_GAME_REWARD_LOSS_COINS,
  COLLECTION_GAME_REWARD_WIN_COINS,
  COLLECTION_GAME_RULES_VERSION,
  COLLECTION_GAME_VERSION,
  COLLECTION_REWARD_VERSION,
  COLLECTION_TEAM_VERSION,
  collectionGameRulesSchema,
  type CollectionRarity,
} from '@hoop-rush/data-contracts';
import { ENGINE_VERSION } from '@hoop-rush/engine';
import { readJson } from './io.ts';

function atomicWriteFileSync(target: string, content: string): void {
  const tmp = `${target}.tmp-${String(Date.now())}-${String(Math.random()).slice(2)}`;
  writeFileSync(tmp, content);
  renameSync(tmp, target);
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const STATIC_DATA = resolve(REPO_ROOT, 'apps/web/static/data');
const COLLECTION_DIR = resolve(STATIC_DATA, 'collection');
const MANIFEST_PATH = resolve(STATIC_DATA, 'manifest.json');
const PROFILE_PATH = resolve(STATIC_DATA, `era-sim/${COLLECTION_GAME_ENVIRONMENT_ERA_ID}.json`);
const IS_ENTRY =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export const COLLECTION_GAME_CPU_RARITY_WEIGHTS: Record<CollectionRarity, number> = {
  Ember: 70,
  Eruption: 23,
  Apex: 5,
  Titan: 1.7,
  Eclipse: 0.29,
  Immortal: 0.01,
};

export function buildCollectionGameRules(): unknown {
  const profile = readJson(PROFILE_PATH) as { profileVersion?: unknown };
  if (typeof profile.profileVersion !== 'string' || profile.profileVersion.length === 0) {
    throw new Error(`collection game rules: ${PROFILE_PATH} has no profileVersion`);
  }
  return {
    rulesVersion: COLLECTION_GAME_RULES_VERSION,
    gameVersion: COLLECTION_GAME_VERSION,
    teamVersion: COLLECTION_TEAM_VERSION,
    rewardVersion: COLLECTION_REWARD_VERSION,
    replayVersion: COLLECTION_GAME_REPLAY_VERSION,
    cpuRosterSize: COLLECTION_GAME_CPU_ROSTER_SIZE,
    eligibleScope: 'full-catalog',
    cpuRarityWeights: { ...COLLECTION_GAME_CPU_RARITY_WEIGHTS },
    environmentEraId: COLLECTION_GAME_ENVIRONMENT_ERA_ID,
    homeCourtPolicy: COLLECTION_GAME_HOME_COURT_POLICY,
    winRewardCoins: COLLECTION_GAME_REWARD_WIN_COINS,
    lossRewardCoins: COLLECTION_GAME_REWARD_LOSS_COINS,
    engineVersion: ENGINE_VERSION,
    profileVersion: profile.profileVersion,
  };
}

export function main(): void {
  const parsed = collectionGameRulesSchema.safeParse(buildCollectionGameRules());
  if (!parsed.success) {
    throw new Error(
      `derived collection game rules fail the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  const content = `${JSON.stringify(parsed.data)}\n`;
  mkdirSync(COLLECTION_DIR, { recursive: true });
  atomicWriteFileSync(resolve(COLLECTION_DIR, 'game-rules.json'), content);
  const hash = sha256Hex(content);
  const fullManifest = readJson(MANIFEST_PATH) as {
    collection?: Record<string, unknown>;
  };
  fullManifest.collection = {
    ...fullManifest.collection,
    gameRules: { url: 'collection/game-rules.json', contentHash: hash },
  };
  atomicWriteFileSync(MANIFEST_PATH, `${JSON.stringify(fullManifest, null, 2)}\n`);
  console.log(`wrote collection game rules (${COLLECTION_GAME_RULES_VERSION}) hash ${hash}`);
}

if (IS_ENTRY) {
  main();
}
