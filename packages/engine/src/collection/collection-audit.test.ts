import { describe, expect, it } from 'vitest';
import {
  COLLECTION_GAME_COMMAND_VERSION,
  COLLECTION_GAME_V1_VERSION,
  COLLECTION_SCHEMA_VERSION,
  type CollectionGameCommand,
  type CollectionGameRecordUnion,
  type CollectionLedgerEntry,
  type CollectionPlayState,
} from '@hoop-rush/data-contracts';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildCollectionDifficultyProfiles,
  buildCollectionGameRulesFixture,
} from '@hoop-rush/test-fixtures';
import { checkCollectionGameRecord } from './game-audit.ts';
import { applyCollectionGameCommand } from './game-commands.ts';
import { simulateCollectionGame } from './game.ts';
import { auditCollectionFirstClearState } from './audit.ts';
import { collectionObjectiveDefinitionsFromRules } from './objectives.ts';
import {
  collectionPlayStateDigest,
  collectionPlayStateFactsOf,
  initializeCollectionPlayState,
} from './play-state.ts';
import { v2Catalog, v2Team } from './v2-fixtures.ts';

const HASH = 'a'.repeat(64);

function setup() {
  const catalog = v2Catalog();
  const team = v2Team(catalog);
  const ownedIds = [...team.starters, ...team.bench];
  const playState = initializeCollectionPlayState({
    collectionId: 'collection-audit' as CollectionPlayState['collectionId'],
    ownedCardIds: ownedIds,
    resolve: (cardId) => catalog.cards.find((card) => card.cardId === cardId),
  });
  const rules = buildCollectionGameRulesFixture();
  return {
    catalog,
    playState,
    input: {
      catalog,
      ownedCardIds: new Set(ownedIds),
      rootSeed: '0'.repeat(32),
      cpuWeights: {
        Ember: 70,
        Eruption: 23,
        Apex: 5,
        Titan: 1.7,
        Eclipse: 0.29,
        Immortal: 0.01,
      },
      difficultyProfiles: buildCollectionDifficultyProfiles(),
      objectiveDefinitions: collectionObjectiveDefinitionsFromRules(rules),
      profile: DEFAULT_ERA_SIM_PROFILE,
      profileHash: HASH,
      catalogHash: HASH,
      rulesHash: HASH,
      balances: { Coins: 0, Exchange: 0 },
      priorCommands: [] as CollectionGameCommand[],
    },
  };
}

function commandOf(
  state: CollectionPlayState,
  commandId: string,
  extra: Record<string, unknown>,
): CollectionGameCommand {
  return {
    schemaVersion: COLLECTION_SCHEMA_VERSION,
    commandVersion: COLLECTION_GAME_COMMAND_VERSION,
    commandId,
    collectionId: state.collectionId,
    expectedRevision: state.revision,
    expectedDigest: collectionPlayStateDigest(collectionPlayStateFactsOf(state)),
    ...extra,
  } as unknown as CollectionGameCommand;
}

describe('collection audits', () => {
  it('reproduces v2 records and proves the first-clear state agrees with the ledger', () => {
    const { catalog, playState: initial, input } = setup();
    let state = initial;
    const records: CollectionGameRecordUnion[] = [];
    const ledger: CollectionLedgerEntry[] = [];
    for (let attempt = 0; attempt < 40 && state.clearedDifficultyIds.length === 0; attempt += 1) {
      const prepared = applyCollectionGameCommand(
        state,
        commandOf(state, `audit-prep-${String(attempt)}`, {
          command: 'prepare-basic-game',
          difficultyId: 'street',
          objectiveId: null,
        }),
        input,
      );
      if (prepared.status !== 'accepted' || prepared.playState.pendingGame === null) {
        throw new Error('prepare rejected');
      }
      const pending = prepared.playState.pendingGame;
      if (pending.gameVersion === COLLECTION_GAME_V1_VERSION) throw new Error('expected v2');
      const simulation = simulateCollectionGame(pending, catalog, input.profile);
      const accepted = applyCollectionGameCommand(
        prepared.playState,
        commandOf(prepared.playState, `audit-accept-${String(attempt)}`, {
          command: 'accept-basic-game-result',
          gameId: pending.gameId,
          result: simulation.result,
          events: simulation.events,
          completedAtIso: '2026-01-01T00:00:00.000Z',
        }),
        input,
      );
      if (accepted.status !== 'accepted' || accepted.record === undefined) {
        throw new Error(JSON.stringify(accepted));
      }
      state = accepted.playState;
      if (accepted.record.gameVersion !== COLLECTION_GAME_V1_VERSION) {
        records.push(accepted.record);
        ledger.push(...(accepted.ledgerEntries ?? []));
      }
    }
    expect(records.length).toBeGreaterThan(0);
    expect(state.clearedDifficultyIds).toEqual(['street']);
    for (const record of records) {
      expect(checkCollectionGameRecord(record, catalog, input.profile)).toEqual([]);
    }
    expect(auditCollectionFirstClearState(state, records, ledger)).toEqual([]);
    const tampered = {
      ...state,
      clearedDifficultyIds: ['pro'] as CollectionPlayState['clearedDifficultyIds'],
    };
    expect(
      auditCollectionFirstClearState(tampered, records, ledger).map((failure) => failure.code),
    ).toContain('first-clear-without-record');
  });
});
