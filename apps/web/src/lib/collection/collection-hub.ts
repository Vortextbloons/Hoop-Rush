import {
  collectionCommandSchema,
  collectionGameCommandSchema,
  collectionPackIdSchema,
  loadEraSimulationProfile,
  type CollectionActiveTeam,
  type CollectionCatalog,
  type CollectionCpuRarityWeights,
  type CollectionGameCommand,
  type CollectionGameRecord,
  type CollectionGameResult,
  type CollectionGameEvent,
  type CollectionLedgerEntry,
  type CollectionPlayState,
  type CollectionPullRecord,
  type CollectionState,
  type EraSimulationProfile,
} from '@hoop-rush/data-contracts';
import { DexieCollectionRepository, HoopRushDatabase } from '@hoop-rush/persistence';
import { getManifest } from '$lib/data';
import { resolveAssetUrl } from '$lib/asset-url';
import { loadCollectionCatalog, loadCollectionGameRules } from './collection-assets.ts';

export const COLLECTION_ID = 'collection-1';

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
    createdAtIso: nowIso,
  });
}

export async function collectionCatalogHash(): Promise<string> {
  const manifest = await getManifest();
  const entry = manifest.collection?.catalog;
  if (!entry) throw new Error('The collection catalog is unavailable.');
  return entry.contentHash;
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
      createdAtIso: nowIso,
    }));
  const command = collectionCommandSchema.parse({
    schemaVersion: 1,
    commandVersion: 'collection-command-v1',
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

export async function openPack(packId: string, nowIso: string): Promise<PackOutcome> {
  const repo = getCollectionRepo();
  const catalog = await loadCollectionCatalog();
  const parsedPackId = collectionPackIdSchema.parse(packId);
  const snapshot = await repo.loadCollection(COLLECTION_ID);
  if (!snapshot) throw new Error('Claim the starter before opening packs.');
  const command = collectionCommandSchema.parse({
    schemaVersion: 1,
    commandVersion: 'collection-command-v1',
    commandId: crypto.randomUUID(),
    collectionId: COLLECTION_ID,
    expectedRevision: snapshot.state.revision,
    expectedDigest: snapshot.state.digest,
    command: 'open-pack',
    packId: parsedPackId,
    acquiredAtIso: nowIso,
  });
  const outcome = await repo.applyCollectionCommand({
    command,
    catalog,
    catalogHash: await collectionCatalogHash(),
    recordedAtIso: nowIso,
  });
  if (!outcome.pull) throw new Error('The pack did not produce cards.');
  return {
    state: outcome.state,
    pull: outcome.pull,
    ledgerEntries: outcome.ledgerEntries,
    catalog,
  };
}

export async function ensurePlayState(nowIso: string): Promise<CollectionPlayState> {
  const repo = getCollectionRepo();
  const catalog = await loadCollectionCatalog();
  const loaded = await repo.ensurePlayState({
    collectionId: COLLECTION_ID,
    catalog,
    catalogHash: await collectionCatalogHash(),
    recordedAtIso: nowIso,
  });
  return loaded.playState;
}

function gameCommandBase(
  playState: CollectionPlayState,
  commandId: string,
): {
  schemaVersion: 1;
  commandVersion: 'collection-command-v1';
  commandId: string;
  collectionId: string;
  expectedRevision: number;
  expectedDigest: string;
} {
  return {
    schemaVersion: 1,
    commandVersion: 'collection-command-v1',
    commandId,
    collectionId: COLLECTION_ID,
    expectedRevision: playState.revision,
    expectedDigest: playState.digest,
  };
}

export async function setActiveTeam(
  team: CollectionActiveTeam,
  nowIso: string,
): Promise<CollectionPlayState> {
  const repo = getCollectionRepo();
  const catalog = await loadCollectionCatalog();
  const playState = await ensurePlayState(nowIso);
  const command = collectionGameCommandSchema.parse({
    ...gameCommandBase(playState, crypto.randomUUID()),
    command: 'set-active-team',
    team,
  });
  const outcome = await repo.applyCollectionGameCommand({
    command,
    catalog,
    catalogHash: await collectionCatalogHash(),
    profile: await loadCollectionProfile(),
    profileHash: await collectionProfileHash(),
    rulesHash: await collectionGameRulesHash(),
    cpuWeights: await collectionCpuWeights(),
    recordedAtIso: nowIso,
  });
  return outcome.playState;
}

export interface PreparedGameOutcome {
  playState: CollectionPlayState;
  gameId: string;
  gameSequence: number;
}

export async function prepareBasicGame(nowIso: string): Promise<PreparedGameOutcome> {
  const repo = getCollectionRepo();
  const catalog = await loadCollectionCatalog();
  const playState = await ensurePlayState(nowIso);
  if (playState.pendingGame !== null) {
    return {
      playState,
      gameId: playState.pendingGame.gameId,
      gameSequence: playState.pendingGame.gameSequence,
    };
  }
  const command = collectionGameCommandSchema.parse({
    ...gameCommandBase(playState, crypto.randomUUID()),
    command: 'prepare-basic-game',
  });
  const outcome = await repo.applyCollectionGameCommand({
    command,
    catalog,
    catalogHash: await collectionCatalogHash(),
    profile: await loadCollectionProfile(),
    profileHash: await collectionProfileHash(),
    rulesHash: await collectionGameRulesHash(),
    cpuWeights: await collectionCpuWeights(),
    recordedAtIso: nowIso,
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
  const catalog = await loadCollectionCatalog();
  const playState = await ensurePlayState(nowIso);
  const pending = playState.pendingGame;
  if (pending === null) return playState;
  const command = collectionGameCommandSchema.parse({
    ...gameCommandBase(playState, crypto.randomUUID()),
    command: 'abandon-basic-game',
    gameId: pending.gameId,
  });
  const outcome = await repo.applyCollectionGameCommand({
    command,
    catalog,
    catalogHash: await collectionCatalogHash(),
    profile: await loadCollectionProfile(),
    profileHash: await collectionProfileHash(),
    rulesHash: await collectionGameRulesHash(),
    cpuWeights: await collectionCpuWeights(),
    recordedAtIso: nowIso,
  });
  return outcome.playState;
}

export interface AcceptedGameOutcome {
  playState: CollectionPlayState;
  record: CollectionGameRecord;
  balances: { Coins: number; Exchange: number };
}

export async function acceptBasicGameResult(input: {
  result: CollectionGameResult;
  events: CollectionGameEvent[];
  completedAtIso: string;
  recordedAtIso: string;
}): Promise<AcceptedGameOutcome> {
  const repo = getCollectionRepo();
  const catalog = await loadCollectionCatalog();
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
    command,
    catalog,
    catalogHash: await collectionCatalogHash(),
    profile: await loadCollectionProfile(),
    profileHash: await collectionProfileHash(),
    rulesHash: await collectionGameRulesHash(),
    cpuWeights: await collectionCpuWeights(),
    recordedAtIso: input.recordedAtIso,
  });
  if (!outcome.record || !outcome.balances) {
    throw new Error('Completing the game did not produce a record.');
  }
  return { playState: outcome.playState, record: outcome.record, balances: outcome.balances };
}

export async function loadCommittedGame(gameId: string): Promise<CollectionGameRecord | null> {
  const repo = getCollectionRepo();
  return repo.getGameRecord(COLLECTION_ID, gameId);
}

export async function collectionCpuWeights(): Promise<CollectionCpuRarityWeights> {
  const rules = await loadCollectionGameRules();
  return { ...rules.cpuRarityWeights };
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
