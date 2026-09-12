import { describe, expect, it } from 'vitest';
import {
  COLLECTION_COMMAND_V1_VERSION,
  COLLECTION_GAME_COMMAND_VERSION,
  COLLECTION_GAME_V1_VERSION,
  COLLECTION_SCHEMA_VERSION,
  collectionPlayStateSchema,
  collectionPreparedGameV2Schema,
  type CollectionCatalog,
  type CollectionCatalogCard,
  type CollectionGameCommand,
  type CollectionPlayState,
  type CollectionRarity,
} from '@hoop-rush/data-contracts';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildCollectionFixtureCard,
  buildCollectionFixtureCatalog,
  buildCollectionGameRulesFixture,
  buildCollectionDifficultyProfiles,
} from '@hoop-rush/test-fixtures';
import { initializeCollectionActiveTeam } from './active-team.ts';
import { applyCollectionGameCommand } from './game-commands.ts';
import { collectionPreparedInputDigest, simulateCollectionGame } from './game.ts';
import {
  buildCollectionObjectiveFacts,
  collectionObjectiveDefinitionsFromRules,
} from './objectives.ts';
import {
  collectionPlayStateDigest,
  collectionPlayStateFactsOf,
  initializeCollectionPlayState,
} from './play-state.ts';

const WEIGHTS: Record<CollectionRarity, number> = {
  Ember: 70,
  Eruption: 23,
  Apex: 5,
  Titan: 1.7,
  Eclipse: 0.29,
  Immortal: 0.01,
};
const RARITIES: CollectionRarity[] = ['Ember', 'Eruption', 'Apex', 'Titan', 'Eclipse', 'Immortal'];
const POSITIONS: Array<CollectionCatalogCard['positions']> = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['C'],
];
const HASH = 'a'.repeat(64);
const FIXED_TIME = '2026-01-01T00:00:00.000Z';

function gameCatalog(size: number): CollectionCatalog {
  const cards: CollectionCatalogCard[] = [];
  for (let i = 0; i < size; i += 1) {
    cards.push(
      buildCollectionFixtureCard(`cmd-${String(i).padStart(3, '0')}`, {
        playerId: `cmd-${String(i).padStart(3, '0')}` as CollectionCatalogCard['playerId'],
        positions: POSITIONS[i % POSITIONS.length] ?? ['PG'],
        rarity: RARITIES[i % RARITIES.length] ?? 'Ember',
        summarySource: { overallRating: 60, offenseRating: 60, defenseRating: 60 },
      }),
    );
  }
  return buildCollectionFixtureCatalog({
    cards,
    sets: [
      {
        setId: 'sharpshooter-set',
        title: 'Cmd',
        memberCardIds: [cards[0]?.cardId as string, cards[1]?.cardId as string],
      },
    ],
  });
}

function setup(size = 24) {
  const catalog = gameCatalog(size);
  const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
  const ownedIds = catalog.cards.slice(0, 12).map((card) => card.cardId);
  const playState = initializeCollectionPlayState({
    collectionId: 'collection-1' as CollectionPlayState['collectionId'],
    ownedCardIds: ownedIds,
    resolve: (cardId) => byId.get(cardId),
  });
  const owned = new Set(ownedIds);
  const rules = buildCollectionGameRulesFixture();
  const baseInput = {
    catalog,
    ownedCardIds: owned,
    rootSeed: '0'.repeat(32),
    cpuWeights: WEIGHTS,
    difficultyProfiles: buildCollectionDifficultyProfiles(),
    objectiveDefinitions: collectionObjectiveDefinitionsFromRules(rules),
    profile: DEFAULT_ERA_SIM_PROFILE,
    profileHash: HASH,
    catalogHash: HASH,
    rulesHash: HASH,
    balances: { Coins: 3000, Exchange: 0 },
    priorCommands: [] as CollectionGameCommand[],
  };
  return { catalog, byId, owned, playState, baseInput, rules };
}

function baseCommand(
  playState: CollectionPlayState,
  commandId: string,
  extra: Record<string, unknown>,
  version: string = COLLECTION_GAME_COMMAND_VERSION,
): CollectionGameCommand {
  return {
    schemaVersion: COLLECTION_SCHEMA_VERSION,
    commandVersion: version,
    commandId,
    collectionId: playState.collectionId,
    expectedRevision: playState.revision,
    expectedDigest: collectionPlayStateDigest(collectionPlayStateFactsOf(playState)),
    ...extra,
  } as unknown as CollectionGameCommand;
}

function prepareV2(
  state: CollectionPlayState,
  input: ReturnType<typeof setup>['baseInput'],
  commandId: string,
  difficultyId: 'street' | 'pro' | 'legend',
  objectiveId: string | null,
) {
  return applyCollectionGameCommand(
    state,
    baseCommand(state, commandId, {
      command: 'prepare-basic-game',
      difficultyId,
      objectiveId,
    }),
    input,
  );
}

function acceptPending(
  state: CollectionPlayState,
  input: ReturnType<typeof setup>['baseInput'],
  commandId: string,
) {
  const pending = state.pendingGame;
  if (pending === null) throw new Error('no pending game');
  const { result, events } = simulateCollectionGame(pending, input.catalog, input.profile);
  return applyCollectionGameCommand(
    state,
    baseCommand(state, commandId, {
      command: 'accept-basic-game-result',
      gameId: pending.gameId,
      result,
      events,
      completedAtIso: FIXED_TIME,
    }),
    input,
  );
}

describe('collection game commands', () => {
  it('initializes play state lazily with a valid default team', () => {
    const { playState } = setup();
    expect(playState.revision).toBe(0);
    expect(playState.nextGameSequence).toBe(0);
    expect(playState.pendingGame).toBeNull();
    expect(playState.clearedDifficultyIds).toEqual([]);
    expect(playState.activeTeam.starters).toHaveLength(5);
  });

  it('prepares a v2 street game with snapshot facts and locks the setup', () => {
    const { byId, owned, playState: initial, baseInput } = setup();
    const team = initializeCollectionActiveTeam([...owned], (cardId) => byId.get(cardId));
    const setResult = applyCollectionGameCommand(
      initial,
      baseCommand(initial, 'cmd-set-1', { command: 'set-active-team', team }),
      baseInput,
    );
    expect(setResult.status).toBe('accepted');
    if (setResult.status !== 'accepted') throw new Error('set rejected');

    const prepared = prepareV2(setResult.playState, baseInput, 'cmd-prep-1', 'street', null);
    expect(prepared.status).toBe('accepted');
    if (prepared.status !== 'accepted' || prepared.playState.pendingGame === null) {
      throw new Error(JSON.stringify(prepared));
    }
    const pending = prepared.playState.pendingGame;
    if (pending.gameVersion === COLLECTION_GAME_V1_VERSION) throw new Error('expected v2');
    expect(pending.gameVersion).toBe('collection-game-v2');
    expect(pending.difficulty.difficultyId).toBe('street');
    expect(pending.construction.candidateCount).toBe(1);
    expect(pending.construction.chosenCandidateIndex).toBe(0);
    expect(pending.construction.targetMinutes.reduce((sum, entry) => sum + entry.minutes, 0)).toBe(
      240,
    );
    expect(pending.adjustments.requestedDelta).toBe(-2);
    expect(pending.adjustments.facts).toHaveLength(12);
    expect(pending.objectives.offers).toHaveLength(3);
    expect(pending.objectives.selectedObjectiveId).toBeNull();
    expect(pending.firstClearEligible).toBe(true);
    expect(prepared.playState.nextGameSequence).toBe(1);
    expect(prepared.playState.clearedDifficultyIds).toEqual([]);

    const locked = applyCollectionGameCommand(
      prepared.playState,
      baseCommand(prepared.playState, 'cmd-set-2', { command: 'set-active-team', team }),
      baseInput,
    );
    expect(locked.status).toBe('rejected');
    if (locked.status !== 'rejected') throw new Error('expected lock');
    expect(locked.rejection.code).toBe('pending-game-conflict');

    const abandoned = applyCollectionGameCommand(
      prepared.playState,
      baseCommand(prepared.playState, 'cmd-abandon-1', {
        command: 'abandon-basic-game',
        gameId: pending.gameId,
      }),
      baseInput,
    );
    expect(abandoned.status).toBe('accepted');
    if (abandoned.status !== 'accepted') throw new Error('abandon rejected');
    expect(abandoned.playState.pendingGame).toBeNull();
    expect(abandoned.playState.nextGameSequence).toBe(1);
    expect(abandoned.playState.clearedDifficultyIds).toEqual([]);
  });

  it('accepts a v2 result and pays componentized coins once', () => {
    const { playState: initial, baseInput } = setup();
    const prepared = prepareV2(initial, baseInput, 'cmd-prep-1', 'street', null);
    if (prepared.status !== 'accepted' || prepared.playState.pendingGame === null) {
      throw new Error('prepare rejected');
    }
    const pending = prepared.playState.pendingGame;
    const { result, events } = simulateCollectionGame(
      pending,
      baseInput.catalog,
      baseInput.profile,
    );
    const acceptCommand = baseCommand(prepared.playState, 'cmd-accept-1', {
      command: 'accept-basic-game-result',
      gameId: pending.gameId,
      result,
      events,
      completedAtIso: FIXED_TIME,
    });
    const accepted = applyCollectionGameCommand(prepared.playState, acceptCommand, baseInput);
    expect(accepted.status).toBe('accepted');
    if (accepted.status !== 'accepted') throw new Error(JSON.stringify(accepted));
    expect(accepted.playState.pendingGame).toBeNull();
    const record = accepted.record;
    if (record === undefined || record.gameVersion === COLLECTION_GAME_V1_VERSION) {
      throw new Error('expected v2 record');
    }
    expect(accepted.ledgerEntries).toHaveLength(record.reward.components.length);
    expect(accepted.ledgerEntries?.reduce((sum, entry) => sum + entry.amount, 0)).toBe(
      record.reward.total,
    );
    expect(record.reward.difficultyId).toBe('street');
    expect(accepted.balances?.Coins).toBe(3000 + record.reward.total);
    if (record.reward.firstClearGranted) {
      expect(accepted.playState.clearedDifficultyIds).toEqual(['street']);
    } else {
      expect(accepted.playState.clearedDifficultyIds).toEqual([]);
    }
    for (const entry of accepted.ledgerEntries ?? []) {
      expect(entry.pullSequence).toBeNull();
      expect(entry.currency).toBe('Coins');
    }

    const duplicate = applyCollectionGameCommand(prepared.playState, acceptCommand, {
      ...baseInput,
      priorCommands: [acceptCommand],
    });
    expect(duplicate.status).toBe('rejected');
    if (duplicate.status !== 'rejected') throw new Error('expected duplicate');
    expect(duplicate.rejection.code).toBe('duplicate-command');

    const conflict = applyCollectionGameCommand(prepared.playState, acceptCommand, {
      ...baseInput,
      priorCommands: [
        { ...acceptCommand, completedAtIso: '2026-01-02T00:00:00.000Z' } as CollectionGameCommand,
      ],
    });
    expect(conflict.status).toBe('rejected');
    if (conflict.status !== 'rejected') throw new Error('expected conflict');
    expect(conflict.rejection.code).toBe('conflicting-command-reuse');
  });

  it('grants the first clear exactly once per difficulty', () => {
    const { playState: initial, baseInput } = setup();
    let state = initial;
    let firstClear: 'street' | null = null;
    let repeatClear = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const prepared = prepareV2(state, baseInput, `cmd-prep-${String(attempt)}`, 'street', null);
      if (prepared.status !== 'accepted') throw new Error('prepare rejected');
      const accepted = acceptPending(
        prepared.playState,
        baseInput,
        `cmd-accept-${String(attempt)}`,
      );
      if (accepted.status !== 'accepted') throw new Error(JSON.stringify(accepted));
      const record = accepted.record;
      if (record === undefined || record.gameVersion === COLLECTION_GAME_V1_VERSION) {
        throw new Error('expected v2 record');
      }
      state = accepted.playState;
      if (firstClear === null) {
        if (record.reward.firstClearGranted) {
          firstClear = 'street';
          expect(state.clearedDifficultyIds).toEqual(['street']);
        } else {
          continue;
        }
      } else if (record.reward.playerWin) {
        repeatClear = record.reward.firstClearGranted;
        expect(record.reward.components.some((component) => component.kind === 'first-clear')).toBe(
          false,
        );
        expect(state.clearedDifficultyIds).toEqual(['street']);
        break;
      }
    }
    expect(firstClear).toBe('street');
    expect(repeatClear).toBe(false);
  });

  it('rejects unknown difficulties, infeasible objectives, and unoffered objectives', () => {
    const { playState, baseInput } = setup();
    const unknown = applyCollectionGameCommand(
      playState,
      baseCommand(playState, 'cmd-prep-unknown', {
        command: 'prepare-basic-game',
        difficultyId: 'impossible',
        objectiveId: null,
      }),
      baseInput,
    );
    expect(unknown.status).toBe('rejected');
    if (unknown.status !== 'rejected') throw new Error('expected rejection');
    expect(unknown.rejection.code).toBe('unknown-difficulty');

    const smallOwned = baseInput.catalog.cards.slice(0, 5).map((card) => card.cardId);
    const smallPlayState = initializeCollectionPlayState({
      collectionId: 'collection-1' as CollectionPlayState['collectionId'],
      ownedCardIds: smallOwned,
      resolve: (cardId) => baseInput.catalog.cards.find((card) => card.cardId === cardId),
    });
    const infeasible = applyCollectionGameCommand(
      smallPlayState,
      baseCommand(smallPlayState, 'cmd-prep-infeasible', {
        command: 'prepare-basic-game',
        difficultyId: 'street',
        objectiveId: 'obj-bench-spark-v1',
      }),
      { ...baseInput, ownedCardIds: new Set(smallOwned) },
    );
    expect(infeasible.status).toBe('rejected');
    if (infeasible.status !== 'rejected') throw new Error('expected rejection');
    expect(infeasible.rejection.code).toBe('infeasible-objective');

    const offers = buildCollectionObjectiveFacts({
      definitions: baseInput.objectiveDefinitions,
      rootSeed: baseInput.rootSeed,
      difficultyId: 'street',
      gameSequence: playState.nextGameSequence,
      team: playState.activeTeam,
      selectedObjectiveId: null,
    }).offers;
    const offeredIds = new Set(offers.map((offer) => offer.objectiveId));
    const unoffered = baseInput.objectiveDefinitions.find(
      (definition) => !offeredIds.has(definition.objectiveId),
    );
    if (unoffered === undefined) throw new Error('expected an unoffered objective');
    const notOffered = applyCollectionGameCommand(
      playState,
      baseCommand(playState, 'cmd-prep-unoffered', {
        command: 'prepare-basic-game',
        difficultyId: 'street',
        objectiveId: unoffered.objectiveId,
      }),
      baseInput,
    );
    expect(notOffered.status).toBe('rejected');
    if (notOffered.status !== 'rejected') throw new Error('expected rejection');
    expect(notOffered.rejection.code).toBe('objective-not-offered');
  });

  it('selects an offered objective and records its evaluation', () => {
    const { playState, baseInput } = setup();
    const offers = buildCollectionObjectiveFacts({
      definitions: baseInput.objectiveDefinitions,
      rootSeed: baseInput.rootSeed,
      difficultyId: 'pro',
      gameSequence: playState.nextGameSequence,
      team: playState.activeTeam,
      selectedObjectiveId: null,
    }).offers;
    const selected = offers[0];
    if (selected === undefined) throw new Error('no offer');
    const prepared = prepareV2(playState, baseInput, 'cmd-prep-obj', 'pro', selected.objectiveId);
    expect(prepared.status).toBe('accepted');
    if (prepared.status !== 'accepted' || prepared.playState.pendingGame === null) {
      throw new Error('prepare rejected');
    }
    const pending = prepared.playState.pendingGame;
    if (pending.gameVersion === COLLECTION_GAME_V1_VERSION) throw new Error('expected v2');
    expect(pending.objectives.selectedObjectiveId).toBe(selected.objectiveId);
    const accepted = acceptPending(prepared.playState, baseInput, 'cmd-accept-obj');
    if (accepted.status !== 'accepted') throw new Error(JSON.stringify(accepted));
    const record = accepted.record;
    if (record === undefined || record.gameVersion === COLLECTION_GAME_V1_VERSION) {
      throw new Error('expected v2 record');
    }
    expect(record.objectiveEvaluation.kind).not.toBe('not-selected');
    if (record.objectiveEvaluation.kind === 'evaluated') {
      expect(record.objectiveEvaluation.objectiveId).toBe(selected.objectiveId);
      const hasObjectiveComponent = record.reward.components.some(
        (component) => component.kind === 'objective',
      );
      expect(hasObjectiveComponent).toBe(record.objectiveEvaluation.success);
    }
  });

  it('still completes a legacy v1 pending game with the 100/10 reward', () => {
    const { playState: initial, baseInput } = setup();
    const prepared = applyCollectionGameCommand(
      initial,
      baseCommand(
        initial,
        'cmd-prep-v1',
        { command: 'prepare-basic-game' },
        COLLECTION_COMMAND_V1_VERSION,
      ),
      baseInput,
    );
    expect(prepared.status).toBe('accepted');
    if (prepared.status !== 'accepted' || prepared.playState.pendingGame === null) {
      throw new Error('prepare rejected');
    }
    const pending = prepared.playState.pendingGame;
    expect(pending.gameVersion).toBe(COLLECTION_GAME_V1_VERSION);
    const { result, events } = simulateCollectionGame(
      pending,
      baseInput.catalog,
      baseInput.profile,
    );
    const accepted = applyCollectionGameCommand(
      prepared.playState,
      baseCommand(prepared.playState, 'cmd-accept-v1', {
        command: 'accept-basic-game-result',
        gameId: pending.gameId,
        result,
        events,
        completedAtIso: FIXED_TIME,
      }),
      baseInput,
    );
    expect(accepted.status).toBe('accepted');
    if (accepted.status !== 'accepted') throw new Error(JSON.stringify(accepted));
    const record = accepted.record;
    if (record === undefined || record.gameVersion !== COLLECTION_GAME_V1_VERSION) {
      throw new Error('expected v1 record');
    }
    const expectedAmount = record.result.winner === 'home' ? 100 : 10;
    expect(record.reward.amount).toBe(expectedAmount);
    expect(accepted.ledgerEntries).toHaveLength(1);
    expect(accepted.ledgerEntries?.[0]?.amount).toBe(expectedAmount);
    expect(accepted.playState.clearedDifficultyIds).toEqual([]);
  });

  it('rejects tampered adjustment facts as a typed rejection', () => {
    const { playState: initial, baseInput } = setup();
    const prepared = prepareV2(initial, baseInput, 'cmd-prep-tamper', 'street', null);
    if (prepared.status !== 'accepted' || prepared.playState.pendingGame === null) {
      throw new Error('prepare rejected');
    }
    const pending = prepared.playState.pendingGame;
    if (pending.gameVersion === COLLECTION_GAME_V1_VERSION) throw new Error('expected v2');
    const tamperedBase = collectionPreparedGameV2Schema.parse({
      ...pending,
      adjustments: {
        ...pending.adjustments,
        facts: pending.adjustments.facts.map((fact, index) =>
          index === 0
            ? {
                ...fact,
                ratings: fact.ratings.map((entry) => {
                  const before = entry.before + 1;
                  return {
                    ...entry,
                    before,
                    after: Math.min(100, Math.max(0, before + fact.requestedDelta)),
                  };
                }),
              }
            : fact,
        ),
      },
    });
    const tampered = {
      ...prepared.playState,
      pendingGame: {
        ...tamperedBase,
        inputDigest: collectionPreparedInputDigest(tamperedBase),
      },
    };
    const { result, events } = simulateCollectionGame(pending, baseInput.catalog, baseInput.profile);
    const rejected = applyCollectionGameCommand(
      tampered,
      baseCommand(tampered, 'cmd-accept-tamper', {
        command: 'accept-basic-game-result',
        gameId: pending.gameId,
        result,
        events,
        completedAtIso: FIXED_TIME,
      }),
      baseInput,
    );
    expect(rejected.status).toBe('rejected');
    if (rejected.status !== 'rejected') throw new Error('expected rejection');
    expect(rejected.rejection.code).toBe('invalid-adjustment-facts');
  });

  it('rejects tampered results and illegal teams with typed codes', () => {
    const { byId, owned, playState: initial, baseInput } = setup();
    const prepared = prepareV2(initial, baseInput, 'cmd-prep-1', 'pro', null);
    if (prepared.status !== 'accepted' || prepared.playState.pendingGame === null) {
      throw new Error('prepare rejected');
    }
    const pending = prepared.playState.pendingGame;
    const { result, events } = simulateCollectionGame(
      pending,
      baseInput.catalog,
      baseInput.profile,
    );
    if (result.outcome !== 'completed') throw new Error('expected completed');
    const tampered = {
      ...result,
      home: { ...result.home, score: result.home.score + 50 },
    };
    const rejected = applyCollectionGameCommand(
      prepared.playState,
      baseCommand(prepared.playState, 'cmd-accept-9', {
        command: 'accept-basic-game-result',
        gameId: pending.gameId,
        result: tampered,
        events,
        completedAtIso: FIXED_TIME,
      }),
      baseInput,
    );
    expect(rejected.status).toBe('rejected');
    if (rejected.status !== 'rejected') throw new Error('expected invalid-result');
    expect(rejected.rejection.code).toBe('invalid-result');

    const good = initializeCollectionActiveTeam([...owned], (cardId) => byId.get(cardId));
    const illegal = applyCollectionGameCommand(
      initial,
      baseCommand(initial, 'cmd-set-9', {
        command: 'set-active-team',
        team: {
          ...good,
          targetMinutes: good.targetMinutes.map((entry) => ({ ...entry, minutes: 10 })),
        },
      }),
      baseInput,
    );
    expect(illegal.status).toBe('rejected');
    if (illegal.status !== 'rejected') throw new Error('expected invalid-minutes');
    expect(illegal.rejection.code).toBe('invalid-minutes');

    const mismatch = applyCollectionGameCommand(
      { ...initial, collectionId: 'other' as CollectionPlayState['collectionId'] },
      baseCommand(initial, 'cmd-set-10', { command: 'set-active-team', team: good }),
      baseInput,
    );
    expect(mismatch.status).toBe('rejected');
    if (mismatch.status !== 'rejected') throw new Error('expected mismatch');
    expect(mismatch.rejection.code).toBe('collection-mismatch');

    const parsed = collectionPlayStateSchema.parse(prepared.playState);
    expect(parsed.digest).toBe(prepared.playState.digest);
  });

  it('rejects rewards that overflow safe integers', () => {
    const { playState: initial, baseInput } = setup();
    const prepared = prepareV2(initial, baseInput, 'cmd-prep-1', 'legend', null);
    if (prepared.status !== 'accepted' || prepared.playState.pendingGame === null) {
      throw new Error('prepare rejected');
    }
    const pending = prepared.playState.pendingGame;
    const { result, events } = simulateCollectionGame(
      pending,
      baseInput.catalog,
      baseInput.profile,
    );
    const outcome = applyCollectionGameCommand(
      prepared.playState,
      baseCommand(prepared.playState, 'cmd-accept-overflow', {
        command: 'accept-basic-game-result',
        gameId: pending.gameId,
        result,
        events,
        completedAtIso: FIXED_TIME,
      }),
      {
        ...baseInput,
        balances: { Coins: Number.MAX_SAFE_INTEGER, Exchange: 0 },
      },
    );
    expect(outcome.status).toBe('rejected');
    if (outcome.status !== 'rejected') throw new Error('expected overflow');
    expect(outcome.rejection.code).toBe('arithmetic-overflow');
  });
});
