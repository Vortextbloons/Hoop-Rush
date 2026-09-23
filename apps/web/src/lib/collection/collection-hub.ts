import {
  COLLECTION_COMMAND_VERSION,
  COLLECTION_GAME_COMMAND_V1_VERSION,
  COLLECTION_GAME_COMMAND_VERSION,
  COLLECTION_STATE_SCHEMA_VERSION,
  collectionCommandSchema,
  collectionGameCommandSchema,
  collectionPackIdSchema,
  loadEraSimulationProfile,
  type CollectionActiveTeam,
  type CollectionCatalog,
  type CollectionCpuRarityWeights,
  type CollectionDifficultyId,
  type CollectionGameCommand,
  type CollectionGameEvent,
  type CollectionGameRecordUnion,
  type CollectionGameResultUnion,
  type CollectionGameResultV3,
  type CollectionGameRules,
  type CollectionLedgerEntry,
  type CollectionObjectiveId,
  type CollectionObjectiveOffer,
  type CollectionPlayState,
  type CollectionProgressionRules,
  type CollectionPullRecord,
  type CollectionSetClaimReceipt,
  type CollectionState,
  type EraSimulationProfile,
} from '@hoop-rush/data-contracts';
import {
  buildCollectionObjectiveFacts,
  collectionObjectiveDefinitionsFromRules,
  resolveCollectionChallenge,
} from '@hoop-rush/engine';
import {
  CollectionCommandStaleError,
  DexieCollectionRepository,
  HoopRushDatabase,
} from '@hoop-rush/persistence';
import { getManifest } from '$lib/data';
import { resolveAssetUrl } from '$lib/asset-url';
import {
  loadCollectionCatalog,
  loadCollectionGameRules,
  loadCollectionProgression,
} from './collection-assets.ts';

export const COLLECTION_ID = 'collection-1';

export class StaleCollectionPreviewError extends Error {
  constructor(
    message = 'The collection changed after this preview was shown. Review the refreshed odds and try again.',
  ) {
    super(message);
    this.name = 'StaleCollectionPreviewError';
  }
}

let dbInstance: HoopRushDatabase | null = null;
export function getCollectionDb(): HoopRushDatabase {
  if (!dbInstance) dbInstance = new HoopRushDatabase();
  return dbInstance;
}

export function getCollectionRepo(): DexieCollectionRepository {
  return new DexieCollectionRepository(getCollectionDb());
}

function randomSeedHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function ensureCollection(nowIso: string): Promise<CollectionState> {
  const repo = getCollectionRepo();
  const existing = await repo.loadCollection(COLLECTION_ID);
  if (existing) return existing.state;
  return repo.initializeCollection({
    collectionId: COLLECTION_ID,
    rootSeed: randomSeedHex(),
    catalogHash: await collectionCatalogHash(),
    progressionHash: await collectionProgressionHash(),
    createdAtIso: nowIso,
  });
}

export async function collectionCatalogHash(): Promise<string> {
  const manifest = await getManifest();
  const entry = manifest.collection?.catalog;
  if (!entry) throw new Error('The collection catalog is unavailable.');
  return entry.contentHash;
}

export async function collectionProgressionHash(): Promise<string | null> {
  const manifest = await getManifest();
  return manifest.collection?.progressionRules?.contentHash ?? null;
}

interface ProgressionCommandArgs {
  progression: CollectionProgressionRules | null;
  progressionHash: string | null;
}

async function progressionCommandArgs(): Promise<ProgressionCommandArgs> {
  const manifest = await getManifest();
  const entry = manifest.collection?.progressionRules;
  if (!entry) return { progression: null, progressionHash: null };
  try {
    return { progression: await loadCollectionProgression(), progressionHash: entry.contentHash };
  } catch {
    return { progression: null, progressionHash: null };
  }
}

export interface ClaimOutcome {
  state: CollectionState;
  pull: CollectionPullRecord;
  exchange: number;
}

export async function claimWelcomeStarter(nowIso: string): Promise<ClaimOutcome> {
  const repo = getCollectionRepo();
  const catalog = await loadCollectionCatalog();
  const snapshot = await repo.loadCollection(COLLECTION_ID);
  const state =
    snapshot?.state ??
    (await repo.initializeCollection({
      collectionId: COLLECTION_ID,
      rootSeed: randomSeedHex(),
      catalogHash: await collectionCatalogHash(),
      progressionHash: await collectionProgressionHash(),
      createdAtIso: nowIso,
    }));
  const command = collectionCommandSchema.parse({
    schemaVersion: COLLECTION_STATE_SCHEMA_VERSION,
    commandVersion: COLLECTION_COMMAND_VERSION,
    commandId: crypto.randomUUID(),
    collectionId: COLLECTION_ID,
    expectedRevision: state.revision,
    expectedDigest: state.digest,
    command: 'claim-welcome',
    acquiredAtIso: nowIso,
  });
  const outcome = await repo.applyCollectionCommand({
    command,
    catalog,
    catalogHash: await collectionCatalogHash(),
    ...(await progressionCommandArgs()),
    recordedAtIso: nowIso,
  });
  if (!outcome.pull) throw new Error('The starter claim did not produce cards.');
  return { state: outcome.state, pull: outcome.pull, exchange: outcome.state.balances.Exchange };
}

export interface PackOutcome {
  state: CollectionState;
  pull: CollectionPullRecord;
  ledgerEntries: CollectionLedgerEntry[];
  catalog: CollectionCatalog;
}

export interface CollectionPreview {
  revision: number;
  digest: string;
}

function assertPreviewCurrent(state: CollectionState, preview?: CollectionPreview): void {
  if (preview === undefined) return;
  if (state.revision !== preview.revision || state.digest !== preview.digest) {
    throw new StaleCollectionPreviewError();
  }
}

export async function openPack(
  packId: string,
  nowIso: string,
  preview?: CollectionPreview,
): Promise<PackOutcome> {
  const repo = getCollectionRepo();
  const catalog = await loadCollectionCatalog();
  const parsedPackId = collectionPackIdSchema.parse(packId);
  const snapshot = await repo.loadCollection(COLLECTION_ID);
  if (!snapshot) throw new Error('Claim the starter before opening packs.');
  assertPreviewCurrent(snapshot.state, preview);
  const command = collectionCommandSchema.parse({
    schemaVersion: COLLECTION_STATE_SCHEMA_VERSION,
    commandVersion: COLLECTION_COMMAND_VERSION,
    commandId: crypto.randomUUID(),
    collectionId: COLLECTION_ID,
    expectedRevision: snapshot.state.revision,
    expectedDigest: snapshot.state.digest,
    command: 'open-pack',
    packId: parsedPackId,
    acquiredAtIso: nowIso,
  });
  let outcome;
  try {
    outcome = await repo.applyCollectionCommand({
      command,
      catalog,
      catalogHash: await collectionCatalogHash(),
      ...(await progressionCommandArgs()),
      recordedAtIso: nowIso,
    });
  } catch (error) {
    if (error instanceof CollectionCommandStaleError) throw new StaleCollectionPreviewError();
    throw error;
  }
  if (!outcome.pull) throw new Error('The pack did not produce cards.');
  return {
    state: outcome.state,
    pull: outcome.pull,
    ledgerEntries: outcome.ledgerEntries,
    catalog,
  };
}

export async function setTargetPlayer(
  playerId: string | null,
  nowIso: string,
): Promise<CollectionState> {
  const repo = getCollectionRepo();
  const catalog = await loadCollectionCatalog();
  const snapshot = await repo.loadCollection(COLLECTION_ID);
  if (!snapshot) throw new Error('Claim the starter before targeting a player.');
  const command = collectionCommandSchema.parse({
    schemaVersion: COLLECTION_STATE_SCHEMA_VERSION,
    commandVersion: COLLECTION_COMMAND_VERSION,
    commandId: crypto.randomUUID(),
    collectionId: COLLECTION_ID,
    expectedRevision: snapshot.state.revision,
    expectedDigest: snapshot.state.digest,
    command: 'set-target-player',
    playerId,
  });
  const outcome = await repo.applyCollectionCommand({
    command,
    catalog,
    catalogHash: await collectionCatalogHash(),
    ...(await progressionCommandArgs()),
    recordedAtIso: nowIso,
  });
  return outcome.state;
}

export interface SetClaimOutcome {
  state: CollectionState;
  receipt: CollectionSetClaimReceipt | null;
  ledgerEntries: CollectionLedgerEntry[];
}

export async function claimSetReward(setId: string, nowIso: string): Promise<SetClaimOutcome> {
  const repo = getCollectionRepo();
  const catalog = await loadCollectionCatalog();
  const snapshot = await repo.loadCollection(COLLECTION_ID);
  if (!snapshot) throw new Error('Claim the starter before claiming a set.');
  const command = collectionCommandSchema.parse({
    schemaVersion: COLLECTION_STATE_SCHEMA_VERSION,
    commandVersion: COLLECTION_COMMAND_VERSION,
    commandId: crypto.randomUUID(),
    collectionId: COLLECTION_ID,
    expectedRevision: snapshot.state.revision,
    expectedDigest: snapshot.state.digest,
    command: 'claim-set-reward',
    setId,
    claimedAtIso: nowIso,
  });
  const outcome = await repo.applyCollectionCommand({
    command,
    catalog,
    catalogHash: await collectionCatalogHash(),
    ...(await progressionCommandArgs()),
    recordedAtIso: nowIso,
  });
  return {
    state: outcome.state,
    receipt: outcome.setReceipt ?? null,
    ledgerEntries: outcome.ledgerEntries,
  };
}

export interface CollectionPlaySnapshot {
  playState: CollectionPlayState;
  rootSeed: string;
}

export async function ensurePlayStateSnapshot(nowIso: string): Promise<CollectionPlaySnapshot> {
  const repo = getCollectionRepo();
  const catalog = await loadCollectionCatalog();
  const loaded = await repo.ensurePlayState({
    collectionId: COLLECTION_ID,
    catalog,
    catalogHash: await collectionCatalogHash(),
    recordedAtIso: nowIso,
  });
  return { playState: loaded.playState, rootSeed: loaded.rootSeed };
}

export async function ensurePlayState(nowIso: string): Promise<CollectionPlayState> {
  return (await ensurePlayStateSnapshot(nowIso)).playState;
}

export function collectionObjectiveOffers(input: {
  rules: CollectionGameRules;
  rootSeed: string;
  difficultyId: CollectionDifficultyId;
  gameSequence: number;
  team: CollectionActiveTeam;
}): CollectionObjectiveOffer[] {
  return buildCollectionObjectiveFacts({
    definitions: collectionObjectiveDefinitionsFromRules(input.rules),
    rootSeed: input.rootSeed,
    difficultyId: input.difficultyId,
    gameSequence: input.gameSequence,
    team: input.team,
    selectedObjectiveId: null,
  }).offers;
}

export function collectionChallengeOffers(input: {
  progression: CollectionProgressionRules;
  rules: CollectionGameRules;
  rootSeed: string;
  challengeId: string;
  gameSequence: number;
  team: CollectionActiveTeam;
}): CollectionObjectiveOffer[] {
  const challenge = resolveCollectionChallenge(input.progression, input.challengeId);
  if (challenge === undefined) throw new Error(`unknown challenge ${input.challengeId}`);
  return collectionObjectiveOffers({
    rules: input.rules,
    rootSeed: input.rootSeed,
    difficultyId: challenge.difficultyId,
    gameSequence: input.gameSequence,
    team: input.team,
  });
}

function gameCommandBase(
  playState: CollectionPlayState,
  commandId: string,
  commandVersion:
    | typeof COLLECTION_GAME_COMMAND_V1_VERSION
    | typeof COLLECTION_GAME_COMMAND_VERSION = COLLECTION_GAME_COMMAND_V1_VERSION,
): {
  schemaVersion: 1;
  commandVersion:
    typeof COLLECTION_GAME_COMMAND_V1_VERSION | typeof COLLECTION_GAME_COMMAND_VERSION;
  commandId: string;
  collectionId: string;
  expectedRevision: number;
  expectedDigest: string;
} {
  return {
    schemaVersion: 1,
    commandVersion,
    commandId,
    collectionId: COLLECTION_ID,
    expectedRevision: playState.revision,
    expectedDigest: playState.digest,
  };
}

// Frozen M4.1/M4.2 CPU rarity weights. The v2 rules artifact has no v1 weights,
// but the shared command input still requires them for legacy v1 replay paths.
export const LEGACY_COLLECTION_CPU_WEIGHTS: CollectionCpuRarityWeights = {
  Ember: 70,
  Eruption: 23,
  Apex: 5,
  Titan: 1.7,
  Eclipse: 0.29,
  Immortal: 0.01,
};

async function gameCommandArgs(recordedAtIso: string) {
  const [catalog, rules, catalogHash, profile, profileHash, rulesHash, progression] =
    await Promise.all([
      loadCollectionCatalog(),
      loadCollectionGameRules(),
      collectionCatalogHash(),
      loadCollectionProfile(),
      collectionProfileHash(),
      collectionGameRulesHash(),
      progressionCommandArgs(),
    ]);
  return {
    catalog,
    catalogHash,
    profile,
    profileHash,
    rulesHash,
    cpuWeights: LEGACY_COLLECTION_CPU_WEIGHTS,
    difficultyProfiles: rules.difficulties,
    objectiveDefinitions: collectionObjectiveDefinitionsFromRules(rules),
    ...progression,
    recordedAtIso,
  };
}

export async function setActiveTeam(
  team: CollectionActiveTeam,
  nowIso: string,
): Promise<CollectionPlayState> {
  const repo = getCollectionRepo();
  const playState = await ensurePlayState(nowIso);
  const command = collectionGameCommandSchema.parse({
    ...gameCommandBase(playState, crypto.randomUUID()),
    command: 'set-active-team',
    team,
  });
  const outcome = await repo.applyCollectionGameCommand({
    ...(await gameCommandArgs(nowIso)),
    command,
  });
  return outcome.playState;
}

export interface PreparedGameOutcome {
  playState: CollectionPlayState;
  gameId: string;
  gameSequence: number;
}

export interface PrepareGameSetup {
  difficultyId: CollectionDifficultyId;
  objectiveId: CollectionObjectiveId | null;
}

export async function prepareBasicGame(
  nowIso: string,
  setup: PrepareGameSetup,
): Promise<PreparedGameOutcome> {
  const repo = getCollectionRepo();
  const playState = await ensurePlayState(nowIso);
  if (playState.pendingGame !== null) {
    return {
      playState,
      gameId: playState.pendingGame.gameId,
      gameSequence: playState.pendingGame.gameSequence,
    };
  }
  const command: CollectionGameCommand = collectionGameCommandSchema.parse({
    ...gameCommandBase(playState, crypto.randomUUID()),
    command: 'prepare-basic-game',
    difficultyId: setup.difficultyId,
    objectiveId: setup.objectiveId,
  });
  const outcome = await repo.applyCollectionGameCommand({
    ...(await gameCommandArgs(nowIso)),
    command,
  });
  if (!outcome.prepared) throw new Error('Preparing the game did not produce a matchup.');
  return {
    playState: outcome.playState,
    gameId: outcome.prepared.gameId,
    gameSequence: outcome.prepared.gameSequence,
  };
}

export async function abandonBasicGame(nowIso: string): Promise<CollectionPlayState> {
  const repo = getCollectionRepo();
  const playState = await ensurePlayState(nowIso);
  const pending = playState.pendingGame;
  if (pending === null) return playState;
  const command = collectionGameCommandSchema.parse({
    ...gameCommandBase(playState, crypto.randomUUID()),
    command: 'abandon-basic-game',
    gameId: pending.gameId,
  });
  const outcome = await repo.applyCollectionGameCommand({
    ...(await gameCommandArgs(nowIso)),
    command,
  });
  return outcome.playState;
}

export interface AcceptedGameOutcome {
  playState: CollectionPlayState;
  record: CollectionGameRecordUnion;
  balances: { Coins: number; Exchange: number };
}

export async function acceptBasicGameResult(input: {
  result: CollectionGameResultUnion;
  events: CollectionGameEvent[];
  completedAtIso: string;
  recordedAtIso: string;
}): Promise<AcceptedGameOutcome> {
  const repo = getCollectionRepo();
  const playState = await ensurePlayState(input.recordedAtIso);
  const pending = playState.pendingGame;
  if (pending === null) throw new Error('No pending game to complete.');
  const command: CollectionGameCommand = collectionGameCommandSchema.parse({
    ...gameCommandBase(playState, crypto.randomUUID()),
    command: 'accept-basic-game-result',
    gameId: pending.gameId,
    result: input.result,
    events: input.events,
    completedAtIso: input.completedAtIso,
  });
  const outcome = await repo.applyCollectionGameCommand({
    ...(await gameCommandArgs(input.recordedAtIso)),
    command,
  });
  if (!outcome.record || !outcome.balances) {
    throw new Error('Completing the game did not produce a record.');
  }
  return { playState: outcome.playState, record: outcome.record, balances: outcome.balances };
}

export async function loadCommittedGame(gameId: string): Promise<CollectionGameRecordUnion | null> {
  const repo = getCollectionRepo();
  return repo.getGameRecord(COLLECTION_ID, gameId);
}

export async function prepareChallengeGame(
  challengeId: string,
  objectiveId: CollectionObjectiveId | null,
  nowIso: string,
): Promise<PreparedGameOutcome> {
  const repo = getCollectionRepo();
  const playState = await ensurePlayState(nowIso);
  if (playState.pendingGame !== null) {
    return {
      playState,
      gameId: playState.pendingGame.gameId,
      gameSequence: playState.pendingGame.gameSequence,
    };
  }
  const command: CollectionGameCommand = collectionGameCommandSchema.parse({
    ...gameCommandBase(playState, crypto.randomUUID(), COLLECTION_GAME_COMMAND_VERSION),
    command: 'prepare-challenge-game',
    challengeId,
    objectiveId,
  });
  const outcome = await repo.applyCollectionGameCommand({
    ...(await gameCommandArgs(nowIso)),
    command,
  });
  if (!outcome.prepared) throw new Error('Preparing the challenge did not produce a matchup.');
  return {
    playState: outcome.playState,
    gameId: outcome.prepared.gameId,
    gameSequence: outcome.prepared.gameSequence,
  };
}

export async function abandonChallengeGame(nowIso: string): Promise<CollectionPlayState> {
  const repo = getCollectionRepo();
  const playState = await ensurePlayState(nowIso);
  const pending = playState.pendingGame;
  if (pending === null) return playState;
  if (pending.gameVersion !== 'collection-game-v3') {
    throw new Error('The pending game is not a challenge game.');
  }
  const command = collectionGameCommandSchema.parse({
    ...gameCommandBase(playState, crypto.randomUUID(), COLLECTION_GAME_COMMAND_VERSION),
    command: 'abandon-challenge-game',
    gameId: pending.gameId,
  });
  const outcome = await repo.applyCollectionGameCommand({
    ...(await gameCommandArgs(nowIso)),
    command,
  });
  return outcome.playState;
}

export async function acceptChallengeGameResult(input: {
  result: CollectionGameResultV3;
  events: CollectionGameEvent[];
  completedAtIso: string;
  recordedAtIso: string;
}): Promise<AcceptedGameOutcome> {
  const repo = getCollectionRepo();
  const playState = await ensurePlayState(input.recordedAtIso);
  const pending = playState.pendingGame;
  if (pending === null) throw new Error('No pending game to complete.');
  if (pending.gameVersion !== 'collection-game-v3') {
    throw new Error('The pending game is not a challenge game.');
  }
  const command: CollectionGameCommand = collectionGameCommandSchema.parse({
    ...gameCommandBase(playState, crypto.randomUUID(), COLLECTION_GAME_COMMAND_VERSION),
    command: 'accept-challenge-game-result',
    gameId: pending.gameId,
    result: input.result,
    events: input.events,
    completedAtIso: input.completedAtIso,
  });
  const outcome = await repo.applyCollectionGameCommand({
    ...(await gameCommandArgs(input.recordedAtIso)),
    command,
  });
  if (!outcome.record || !outcome.balances) {
    throw new Error('Completing the game did not produce a record.');
  }
  return { playState: outcome.playState, record: outcome.record, balances: outcome.balances };
}

export async function collectionGameRulesHash(): Promise<string> {
  const manifest = await getManifest();
  const entry = manifest.collection?.gameRules;
  if (!entry) throw new Error('The collection game rules are unavailable.');
  return entry.contentHash;
}

export async function loadCollectionProfile(): Promise<EraSimulationProfile> {
  const manifest = await getManifest();
  const entry = manifest.eraSimulationProfiles.find((profile) => profile.eraId === '2020s');
  if (!entry) throw new Error('The 2020s simulation profile is unavailable.');
  return loadEraSimulationProfile(resolveAssetUrl(entry.url), entry.contentHash);
}

export async function collectionProfileHash(): Promise<string> {
  const manifest = await getManifest();
  const entry = manifest.eraSimulationProfiles.find((profile) => profile.eraId === '2020s');
  if (!entry) throw new Error('The 2020s simulation profile is unavailable.');
  return entry.contentHash;
}

export interface CollectionGameWorkerAssets {
  catalogUrl: string;
  catalogHash: string;
  profileUrl: string;
  profileHash: string;
}

export async function collectionGameWorkerAssets(): Promise<CollectionGameWorkerAssets> {
  const manifest = await getManifest();
  const catalog = manifest.collection?.catalog;
  const profile = manifest.eraSimulationProfiles.find((entry) => entry.eraId === '2020s');
  if (!catalog || !profile) throw new Error('The collection game assets are unavailable.');
  return {
    catalogUrl: resolveAssetUrl(catalog.url),
    catalogHash: catalog.contentHash,
    profileUrl: resolveAssetUrl(profile.url),
    profileHash: profile.contentHash,
  };
}
