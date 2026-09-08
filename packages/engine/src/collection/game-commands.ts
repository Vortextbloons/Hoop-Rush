import {
  COLLECTION_CATALOG_VERSION,
  canonicalJson,
  type CollectionBalances,
  type CollectionCatalog,
  type CollectionCatalogCard,
  type CollectionCpuRarityWeights,
  type CollectionGameCommand,
  type CollectionGameRecord,
  type CollectionLedgerEntry,
  type CollectionPlayState,
  type EraSimulationProfile,
} from '@hoop-rush/data-contracts';
import { validateCollectionActiveTeam } from './active-team.ts';
import {
  collectionGameRewardFor,
  prepareCollectionBasicGame,
  reproduceCollectionGame,
  CollectionGameError,
} from './game.ts';
import { checkCollectionGameResult } from './game-audit.ts';
import { collectionPlayStateDigest, collectionPlayStateFactsOf } from './play-state.ts';

export interface AcceptedGameCommandResult {
  status: 'accepted';
  playState: CollectionPlayState;
  prepared?: CollectionPreparedGameRef;
  record?: CollectionGameRecord;
  ledgerEntry?: CollectionLedgerEntry;
  balances?: CollectionBalances;
}

export interface CollectionPreparedGameRef {
  gameId: string;
  gameSequence: number;
}

export interface RejectedGameCommandResult {
  status: 'rejected';
  rejection: { code: string; [key: string]: unknown };
}

export type CollectionGameCommandResult = AcceptedGameCommandResult | RejectedGameCommandResult;

function reject(code: string, extra: Record<string, unknown> = {}): RejectedGameCommandResult {
  return { status: 'rejected', rejection: { code, ...extra } };
}

function commitPlayState(
  state: CollectionPlayState,
  update: Partial<Pick<CollectionPlayState, 'activeTeam' | 'nextGameSequence' | 'pendingGame'>>,
): CollectionPlayState {
  const next: CollectionPlayState = {
    ...state,
    ...update,
    revision: state.revision + 1,
    digest: '0'.repeat(32),
  };
  return { ...next, digest: collectionPlayStateDigest(collectionPlayStateFactsOf(next)) };
}

function addChecked(a: number, b: number, what: string): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) {
    throw new CollectionGameError('arithmetic-overflow', `${what} overflows safe integers`);
  }
  return sum;
}

function mapTeamIssue(
  issue: { code: string; cardId: string; message: string },
  resolve: (cardId: string) => CollectionCatalogCard | undefined,
  rosterSize: number,
): RejectedGameCommandResult {
  switch (issue.code) {
    case 'unknown-card':
      return reject('unknown-card', { cardId: issue.cardId });
    case 'unowned-card':
      return reject('unowned-card', { cardId: issue.cardId });
    case 'duplicate-card':
      return reject('duplicate-card', { cardId: issue.cardId });
    case 'duplicate-player': {
      const card = issue.cardId === '' ? undefined : resolve(issue.cardId);
      return reject('duplicate-player', { cardId: issue.cardId, playerId: card?.playerId ?? '' });
    }
    case 'too-few-cards':
      return reject('too-few-cards', { count: rosterSize });
    case 'too-many-cards':
      return reject('too-many-cards', { count: rosterSize });
    case 'illegal-starters':
      return reject('illegal-starters', { detail: issue.message });
    default:
      return reject('invalid-minutes', { detail: issue.message });
  }
}

export function applyCollectionGameCommand(
  playState: CollectionPlayState,
  command: CollectionGameCommand,
  input: {
    catalog: CollectionCatalog;
    ownedCardIds: ReadonlySet<string>;
    resolve?: (cardId: string) => CollectionCatalogCard | undefined;
    rootSeed: string;
    cpuWeights: CollectionCpuRarityWeights;
    profile: EraSimulationProfile;
    profileHash: string;
    catalogHash: string;
    rulesHash: string;
    balances: CollectionBalances;
    priorCommands: readonly CollectionGameCommand[];
  },
): CollectionGameCommandResult {
  if (command.collectionId !== playState.collectionId) {
    return reject('collection-mismatch', { expectedCollectionId: playState.collectionId });
  }
  const prior = input.priorCommands.find((entry) => entry.commandId === command.commandId);
  if (prior !== undefined) {
    if (canonicalJson(prior) === canonicalJson(command)) {
      return reject('duplicate-command', { commandId: command.commandId });
    }
    return reject('conflicting-command-reuse', { commandId: command.commandId });
  }
  const currentDigest = collectionPlayStateDigest(collectionPlayStateFactsOf(playState));
  if (command.expectedRevision !== playState.revision || command.expectedDigest !== currentDigest) {
    return reject('stale-state', {
      expectedRevision: command.expectedRevision,
      expectedDigest: command.expectedDigest,
      currentRevision: playState.revision,
      currentDigest,
    });
  }
  try {
    switch (command.command) {
      case 'set-active-team':
        return applySetActiveTeam(playState, command, input);
      case 'prepare-basic-game':
        return applyPrepareBasicGame(playState, command, input);
      case 'abandon-basic-game':
        return applyAbandonBasicGame(playState, command);
      case 'accept-basic-game-result':
        return applyAcceptBasicGameResult(playState, command, input);
    }
  } catch (error) {
    if (error instanceof CollectionGameError) {
      return reject(error.code, { detail: error.message });
    }
    throw error;
  }
}

type SetActiveTeamCommand = Extract<CollectionGameCommand, { command: 'set-active-team' }>;

function applySetActiveTeam(
  playState: CollectionPlayState,
  command: SetActiveTeamCommand,
  input: {
    catalog: CollectionCatalog;
    ownedCardIds: ReadonlySet<string>;
    resolve?: (cardId: string) => CollectionCatalogCard | undefined;
  },
): CollectionGameCommandResult {
  if (playState.pendingGame !== null) {
    return reject('pending-game-conflict', { gameId: playState.pendingGame.gameId });
  }
  const resolve =
    input.resolve ??
    ((cardId: string) => input.catalog.cards.find((card) => card.cardId === cardId));
  const check = validateCollectionActiveTeam(command.team, resolve, input.ownedCardIds);
  if (!check.ok) {
    const first = check.issues[0];
    if (first === undefined) return reject('invalid-minutes', { detail: 'invalid team' });
    return mapTeamIssue(first, resolve, command.team.starters.length + command.team.bench.length);
  }
  return {
    status: 'accepted',
    playState: commitPlayState(playState, { activeTeam: command.team }),
  };
}

type PrepareCommand = Extract<CollectionGameCommand, { command: 'prepare-basic-game' }>;

function applyPrepareBasicGame(
  playState: CollectionPlayState,
  command: PrepareCommand,
  input: {
    catalog: CollectionCatalog;
    ownedCardIds: ReadonlySet<string>;
    resolve?: (cardId: string) => CollectionCatalogCard | undefined;
    rootSeed: string;
    cpuWeights: CollectionCpuRarityWeights;
    profile: EraSimulationProfile;
    profileHash: string;
    catalogHash: string;
    rulesHash: string;
  },
): CollectionGameCommandResult {
  void command;
  if (playState.pendingGame !== null) {
    return reject('pending-game-conflict', { gameId: playState.pendingGame.gameId });
  }
  const catalogVersion: string = input.catalog.catalogVersion;
  if (catalogVersion !== COLLECTION_CATALOG_VERSION) {
    return reject('incompatible-content', { detail: catalogVersion });
  }
  const resolve =
    input.resolve ??
    ((cardId: string) => input.catalog.cards.find((card) => card.cardId === cardId));
  const check = validateCollectionActiveTeam(playState.activeTeam, resolve, input.ownedCardIds);
  if (!check.ok) {
    const first = check.issues[0];
    if (first === undefined) return reject('invalid-minutes', { detail: 'invalid team' });
    return mapTeamIssue(
      first,
      resolve,
      playState.activeTeam.starters.length + playState.activeTeam.bench.length,
    );
  }
  let prepared: ReturnType<typeof prepareCollectionBasicGame>;
  try {
    prepared = prepareCollectionBasicGame({
      collectionId: playState.collectionId,
      rootSeed: input.rootSeed,
      gameSequence: playState.nextGameSequence,
      ownedCardIds: input.ownedCardIds,
      team: playState.activeTeam,
      catalog: input.catalog,
      cpuWeights: input.cpuWeights,
      profileVersion: input.profile.profileVersion,
      profileHash: input.profileHash,
      catalogHash: input.catalogHash,
      rulesHash: input.rulesHash,
    });
  } catch (error) {
    if (error instanceof CollectionGameError) {
      return reject(error.code, { detail: error.message });
    }
    throw error;
  }
  return {
    status: 'accepted',
    playState: commitPlayState(playState, {
      pendingGame: prepared,
      nextGameSequence: playState.nextGameSequence + 1,
    }),
    prepared: { gameId: prepared.gameId, gameSequence: prepared.gameSequence },
  };
}

type AbandonCommand = Extract<CollectionGameCommand, { command: 'abandon-basic-game' }>;

function applyAbandonBasicGame(
  playState: CollectionPlayState,
  command: AbandonCommand,
): CollectionGameCommandResult {
  const pending = playState.pendingGame;
  if (pending === null) return reject('no-pending-game');
  if (pending.gameId !== command.gameId) {
    return reject('pending-game-mismatch', { gameId: pending.gameId });
  }
  return { status: 'accepted', playState: commitPlayState(playState, { pendingGame: null }) };
}

type AcceptCommand = Extract<CollectionGameCommand, { command: 'accept-basic-game-result' }>;

function applyAcceptBasicGameResult(
  playState: CollectionPlayState,
  command: AcceptCommand,
  input: {
    catalog: CollectionCatalog;
    profile: EraSimulationProfile;
    balances: CollectionBalances;
  },
): CollectionGameCommandResult {
  const pending = playState.pendingGame;
  if (pending === null) return reject('no-pending-game');
  if (pending.gameId !== command.gameId) {
    return reject('pending-game-mismatch', { gameId: pending.gameId });
  }
  if (command.result.gameId !== pending.gameId) {
    return reject('invalid-result', { detail: 'result gameId does not match the pending game' });
  }
  let reproduced: ReturnType<typeof reproduceCollectionGame>;
  try {
    reproduced = reproduceCollectionGame(pending, input.catalog, input.profile);
  } catch (error) {
    if (error instanceof CollectionGameError) {
      return reject('invalid-result', { detail: error.message });
    }
    throw error;
  }
  if (canonicalJson(reproduced.result) !== canonicalJson(command.result)) {
    return reject('invalid-result', { detail: 'result does not reproduce from the pending input' });
  }
  if (canonicalJson(reproduced.events) !== canonicalJson(command.events)) {
    return reject('invalid-result', { detail: 'events do not reproduce from the pending input' });
  }
  const failures = checkCollectionGameResult(
    command.result,
    command.events,
    pending,
    input.catalog,
    input.profile,
  );
  if (failures.length > 0) {
    return reject('invalid-result', { detail: failures[0] ?? 'game audit failed' });
  }
  const reward = collectionGameRewardFor(command.result, pending.gameId);
  let balances: CollectionBalances;
  try {
    balances = {
      Coins: addChecked(input.balances.Coins, reward.amount, 'game reward'),
      Exchange: input.balances.Exchange,
    };
  } catch (error) {
    if (error instanceof CollectionGameError) {
      return reject(error.code, { detail: error.message });
    }
    throw error;
  }
  if (balances.Coins < 0) {
    return reject('arithmetic-overflow', { detail: 'negative Coins balance' });
  }
  const ledgerEntry: CollectionLedgerEntry = {
    transactionId: reward.transactionId,
    commandId: command.commandId,
    pullSequence: null,
    currency: 'Coins',
    amount: reward.amount,
    reason: reward.reason,
  };
  const record: CollectionGameRecord = {
    gameVersion: pending.gameVersion,
    collectionId: playState.collectionId,
    gameId: pending.gameId,
    gameSequence: pending.gameSequence,
    prepared: pending,
    result: command.result,
    events: [...command.events],
    eventDigest: reproduced.eventDigest,
    resultDigest: reproduced.resultDigest,
    reward,
    completedAtIso: command.completedAtIso,
  };
  return {
    status: 'accepted',
    playState: commitPlayState(playState, { pendingGame: null }),
    record,
    ledgerEntry,
    balances,
  };
}
