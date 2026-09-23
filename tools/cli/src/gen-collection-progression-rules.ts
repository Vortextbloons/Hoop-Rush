import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLLECTION_CATALOG_VERSION,
  COLLECTION_CHALLENGE_REWARD_VERSION,
  COLLECTION_CHALLENGE_VERSION,
  COLLECTION_PROGRESSION_VERSION,
  COLLECTION_SET_REWARD_VERSION,
  COLLECTION_TARGETING_VERSION,
  collectionProgressionRulesDigest,
  collectionProgressionRulesSchema,
  contentHashSchema,
  type CollectionCatalog,
  type CollectionProgressionRules,
} from '@hoop-rush/data-contracts';
import { validateCollectionProgressionRules } from '@hoop-rush/engine';
import {
  COLLECTION_LAUNCH_CHALLENGES,
  COLLECTION_PROGRESSION_DISPLAY,
  COLLECTION_TARGET_MULTIPLIER_BP,
  collectionLaunchSetRewardDefinitions,
} from './collection-progression-constants.ts';
import { loadCollectionCatalog } from './commands/collection.ts';
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
const RULES_PATH = resolve(COLLECTION_DIR, 'progression-rules.json');
const IS_ENTRY =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export function buildCollectionProgressionRules(): {
  rules: CollectionProgressionRules;
  catalog: CollectionCatalog;
  catalogHash: string;
} {
  const { catalog, catalogHash } = loadCollectionCatalog(MANIFEST_PATH);
  const base: Omit<CollectionProgressionRules, 'contentDigest'> = {
    schemaVersion: 1,
    progressionVersion: COLLECTION_PROGRESSION_VERSION,
    targetingVersion: COLLECTION_TARGETING_VERSION,
    challengeVersion: COLLECTION_CHALLENGE_VERSION,
    challengeRewardVersion: COLLECTION_CHALLENGE_REWARD_VERSION,
    setRewardVersion: COLLECTION_SET_REWARD_VERSION,
    sourceCatalogVersion: COLLECTION_CATALOG_VERSION,
    sourceCatalogHash: contentHashSchema.parse(catalogHash),
    targetMultiplierBp: COLLECTION_TARGET_MULTIPLIER_BP,
    challenges: [...COLLECTION_LAUNCH_CHALLENGES],
    setRewards: collectionLaunchSetRewardDefinitions(catalog),
    display: COLLECTION_PROGRESSION_DISPLAY,
  };
  const contentDigest = collectionProgressionRulesDigest(base);
  const rules = collectionProgressionRulesSchema.parse({ ...base, contentDigest });
  return { rules, catalog, catalogHash };
}

export function main(): void {
  const { rules, catalog, catalogHash } = buildCollectionProgressionRules();
  const content = `${JSON.stringify(rules)}\n`;
  const hash = sha256Hex(content);
  validateCollectionProgressionRules({
    progression: rules,
    progressionHash: hash,
    catalog,
    verifyFeasibility: true,
  });
  mkdirSync(COLLECTION_DIR, { recursive: true });
  atomicWriteFileSync(RULES_PATH, content);
  const fullManifest = readJson(MANIFEST_PATH) as {
    collection?: Record<string, unknown>;
  };
  fullManifest.collection = {
    ...fullManifest.collection,
    progressionRules: { url: 'collection/progression-rules.json', contentHash: hash },
  };
  atomicWriteFileSync(MANIFEST_PATH, `${JSON.stringify(fullManifest, null, 2)}\n`);
  console.log(
    `wrote collection progression rules (${rules.progressionVersion}) · ${String(rules.challenges.length)} challenges · ${String(rules.setRewards.length)} set rewards · catalog ${catalogHash} · hash ${hash}`,
  );
}

if (IS_ENTRY) {
  main();
}
