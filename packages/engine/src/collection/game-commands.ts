import {
  COLLECTION_CATALOG_VERSION,
  COLLECTION_COMMAND_V1_VERSION,
  COLLECTION_GAME_V1_VERSION,
  COLLECTION_GAME_VERSION,
  COLLECTION_GAME_COMMAND_VERSION,
  canonicalJson,
  collectionGameRecordUnionSchema,
  collectionPlayStateSchema,
  type CollectionBalances,
  type CollectionCatalog,
  type CollectionCatalogCard,
  type CollectionCpuRarityWeights,
  type CollectionDifficultyProfile,
  type CollectionGameCommand,
  type CollectionGameRecordUnion,
  type CollectionLedgerEntry,
  type CollectionObjectiveDefinition,
  type CollectionPlayState,
  type CollectionPreparedGameUnion,
  type EraSimulationProfile,
} from '@hoop-rush/data-contracts';
import { validateCollectionActiveTeam } from './active-team.ts';
import {
  collectionGameRewardFor,
  prepareCollectionBasicGame,
  prepareCollectionBasicGameV2,
  reproduceCollectionGame,
  CollectionGameError,
} from './game.ts';
import { checkCollectionGameResult } from './game-audit.ts';
import { evaluateCollectionObjective } from './objectives.ts';
import { collectionGameRewardReceiptFor } from './rewards.ts';
import { collectionPlayStateDigest, collectionPlayStateFactsOf } from './play-state.ts';

export interface AcceptedGameCommandResult {
  status: 'accepted';
  playState: CollectionPlayState;
  prepared?: CollectionPreparedGameRef;
  record?: CollectionGameRecordUnion;
  ledgerEntries?: CollectionLedgerEntry[];
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
  update: Partial<
    Pick<
      CollectionPlayState,
      'activeTeam' | 'nextGameSequence' | 'pendingGame' | 'clearedDifficultyIds'
    >
  >,
): CollectionPlayState {
  const next: CollectionPlayState = {
    ...state,
    ...update,
    revision: state.revision + 1,
    digest: '0'.repeat(32),
  };
  return collectionPlayStateSchema.parse({
    ...next,
    digest: collectionPlayStateDigest(collectionPlayStateFactsOf(next)),
  });
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

interface CommandInput {
  catalog: CollectionCatalog;
  ownedCardIds: ReadonlySet<string>;
  resolve?: (cardId: string) => CollectionCatalogCard | undefined;
  rootSeed: string;
  cpuWeights: CollectionCpuRarityWeights;
  difficultyProfiles: readonly CollectionDifficultyProfile[];
  objectiveDefinitions: readonly CollectionObjectiveDefinition[];
  profile: EraSimulationProfile;
  profileHash: string;
  catalogHash: string;
  rulesHash: string;
  balances: CollectionBalances;
  priorCommands: readonly CollectionGameCommand[];
}

export function applyCollectionGameCommand(
  playState: CollectionPlayState,
  command: CollectionGameCommand,
  input: CommandInput,
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
    if (command.command === 'set-active-team') {
      return applySetActiveTeam(playState, command, input);
    }
    if (command.command === 'prepare-basic-game') {
      return applyPrepareBasicGame(playState, command, input);
    }
    if (command.command === 'abandon-basic-game') {
      return applyAbandonBasicGame(playState, command);
    }
    return applyAcceptBasicGameResult(playState, command, input);
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
  input: CommandInput,
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
  input: CommandInput,
): CollectionGameCommandResult {
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
  let prepared: CollectionPreparedGameUnion;
  try {
    if (command.commandVersion === COLLECTION_COMMAND_V1_VERSION) {
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
    } else {
      const difficulty = input.difficultyProfiles.find(
        (profile) => profile.difficultyId === command.difficultyId,
      );
      if (difficulty === undefined) {
        return reject('unknown-difficulty', { difficultyId: command.difficultyId });
      }
      prepared = prepareCollectionBasicGameV2({
        collectionId: playState.collectionId,
        rootSeed: input.rootSeed,
        gameSequence: playState.nextGameSequence,
        ownedCardIds: input.ownedCardIds,
        team: playState.activeTeam,
        catalog: input.catalog,
        difficulty,
        objectiveDefinitions: input.objectiveDefinitions,
        selectedObjectiveId: command.objectiveId,
        clearedDifficultyIds: playState.clearedDifficultyIds,
        profileVersion: input.profile.profileVersion,
        profileHash: input.profileHash,
        catalogHash: input.catalogHash,
        rulesHash: input.rulesHash,
      });
    }
  } catch (error) {
    if (error instanceof CollectionGameError) {
      return reject(error.code, { detail: error.message });
    }
    if (error instanceof Error && 'code' in error) {
      const code = (error as { code: unknown }).code;
      if (typeof code === 'string') return reject(code, { detail: error.message });
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
  input: CommandInput,
): CollectionGameCommandResult {
  const pending = playState.pendingGame;
  if (pending === null) return reject('no-pending-game');
  if (pending.gameId !== command.gameId) {
    return reject('pending-game-mismatch', { gameId: pending.gameId });
  }
  if (command.result.gameId !== pending.gameId) {
    return reject('invalid-result', { detail: 'result gameId does not match the pending game' });
  }
  if (
    command.commandVersion !== COLLECTION_GAME_COMMAND_VERSION &&
    pending.gameVersion !== COLLECTION_GAME_V1_VERSION
  ) {
    return reject('incompatible-content', {
      detail: 'legacy accept commands cannot complete a current prepared game',
    });
  }
  if (command.result.gameVersion !== pending.gameVersion) {
    return reject('invalid-result', {
      detail: 'result version does not match the pending game version',
    });
  }
  let reproduced: ReturnType<typeof reproduceCollectionGame>;
  try {
    reproduced = reproduceCollectionGame(pending, input.catalog, input.profile);
  } catch (error) {
    if (error instanceof CollectionGameError) {
      return reject('invalid-result', { detail: error.message });
    }
    if (error instanceof Error && 'code' in error) {
      const code = (error as { code: unknown }).code;
      if (typeof code === 'string') return reject(code, { detail: error.message });
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
  if (pending.gameVersion === COLLECTION_GAME_V1_VERSION) {
    return acceptLegacyResult(playState, command, pending, reproduced, input);
  }
  return acceptCurrentResult(playState, command, pending, reproduced, input);
}

function acceptLegacyResult(
  playState: CollectionPlayState,
  command: AcceptCommand,
  pending: Extract<CollectionPreparedGameUnion, { gameVersion: typeof COLLECTION_GAME_V1_VERSION }>,
  reproduced: ReturnType<typeof reproduceCollectionGame>,
  input: CommandInput,
): CollectionGameCommandResult {
  const result = command.result;
  if (result.gameVersion !== COLLECTION_GAME_V1_VERSION) {
    return reject('invalid-result', { detail: 'legacy pending game requires a legacy result' });
  }
  const reward = collectionGameRewardFor(result, pending.gameId);
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
  const ledgerEntry: CollectionLedgerEntry = {
    transactionId: reward.transactionId,
    commandId: command.commandId,
    pullSequence: null,
    currency: 'Coins',
    amount: reward.amount,
    reason: reward.reason,
  };
  const record = collectionGameRecordUnionSchema.parse({
    gameVersion: pending.gameVersion,
    collectionId: playState.collectionId,
    gameId: pending.gameId,
    gameSequence: pending.gameSequence,
    prepared: pending,
    result,
    events: [...command.events],
    eventDigest: reproduced.eventDigest,
    resultDigest: reproduced.resultDigest,
    reward,
    completedAtIso: command.completedAtIso,
  });
  return {
    status: 'accepted',
    playState: commitPlayState(playState, { pendingGame: null }),
    record,
    ledgerEntries: [ledgerEntry],
    balances,
  };
}

function acceptCurrentResult(
  playState: CollectionPlayState,
  command: AcceptCommand,
  pending: Extract<CollectionPreparedGameUnion, { gameVersion: typeof COLLECTION_GAME_VERSION }>,
  reproduced: ReturnType<typeof reproduceCollectionGame>,
  input: CommandInput,
): CollectionGameCommandResult {
  const result = command.result;
  if (result.gameVersion !== COLLECTION_GAME_VERSION) {
    return reject('invalid-result', { detail: 'current pending game requires a current result' });
  }
  const difficultyId = pending.difficulty.difficultyId;
  if (pending.firstClearEligible && playState.clearedDifficultyIds.includes(difficultyId)) {
    return reject('first-clear-divergence', {
      detail: `difficulty ${difficultyId} was already cleared after preparation`,
    });
  }
  let evaluation: ReturnType<typeof evaluateCollectionObjective>;
  try {
    evaluation = evaluateCollectionObjective({ prepared: pending, result });
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      const code = (error as { code: unknown }).code;
      if (typeof code === 'string') return reject(code, { detail: error.message });
    }
    throw error;
  }
  let reward: ReturnType<typeof collectionGameRewardReceiptFor>;
  try {
    reward = collectionGameRewardReceiptFor({
      gameId: pending.gameId,
      prepared: pending,
      result,
      evaluation,
    });
  } catch (error) {
    if (error instanceof CollectionGameError) {
      return reject(error.code, { detail: error.message });
    }
    if (error instanceof Error && 'code' in error) {
      const code = (error as { code: unknown }).code;
      if (typeof code === 'string') return reject(code, { detail: error.message });
    }
    throw error;
  }
  let balances: CollectionBalances;
  try {
    balances = {
      Coins: addChecked(input.balances.Coins, reward.total, 'game reward'),
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
  const ledgerEntries: CollectionLedgerEntry[] = reward.components.map((component) => ({
    transactionId: component.transactionId,
    commandId: command.commandId,
    pullSequence: null,
    currency: 'Coins',
    amount: component.amount,
    reason: component.reason,
  }));
  const record = collectionGameRecordUnionSchema.parse({
    gameVersion: pending.gameVersion,
    collectionId: playState.collectionId,
    gameId: pending.gameId,
    gameSequence: pending.gameSequence,
    prepared: pending,
    result,
    events: [...command.events],
    eventDigest: reproduced.eventDigest,
    resultDigest: reproduced.resultDigest,
    objectiveEvaluation: evaluation,
    reward,
    completedAtIso: command.completedAtIso,
  });
  const clearedDifficultyIds = reward.firstClearGranted
    ? [...playState.clearedDifficultyIds, difficultyId].sort()
    : [...playState.clearedDifficultyIds];
  return {
    status: 'accepted',
    playState: commitPlayState(playState, { pendingGame: null, clearedDifficultyIds }),
    record,
    ledgerEntries,
    balances,
  };
}
