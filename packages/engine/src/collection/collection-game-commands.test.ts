import { describe, expect, it } from 'vitest';
import {
  COLLECTION_COMMAND_VERSION,
  COLLECTION_SCHEMA_VERSION,
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
} from '@hoop-rush/test-fixtures';
import { initializeCollectionActiveTeam } from './active-team.ts';
import { applyCollectionGameCommand } from './game-commands.ts';
import { simulateCollectionGame } from './game.ts';
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

function setup() {
  const catalog = gameCatalog(18);
  const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
  const ownedIds = catalog.cards.slice(0, 6).map((card) => card.cardId);
  const playState = initializeCollectionPlayState({
    collectionId: 'collection-1' as CollectionPlayState['collectionId'],
    ownedCardIds: ownedIds,
    resolve: (cardId) => byId.get(cardId),
  });
  const owned = new Set(ownedIds);
  const baseInput = {
    catalog,
    ownedCardIds: owned,
    rootSeed: '0'.repeat(32),
    cpuWeights: WEIGHTS,
    profile: DEFAULT_ERA_SIM_PROFILE,
    profileHash: HASH,
    catalogHash: HASH,
    rulesHash: HASH,
    balances: { Coins: 3000, Exchange: 0 },
    priorCommands: [] as CollectionGameCommand[],
  };
  return { catalog, byId, owned, playState, baseInput };
}

function baseCommand(
  playState: CollectionPlayState,
  commandId: string,
  extra: Record<string, unknown>,
): CollectionGameCommand {
  return {
    schemaVersion: COLLECTION_SCHEMA_VERSION,
    commandVersion: COLLECTION_COMMAND_VERSION,
    commandId,
    collectionId: playState.collectionId,
    expectedRevision: playState.revision,
    expectedDigest: collectionPlayStateDigest(collectionPlayStateFactsOf(playState)),
    ...extra,
  } as unknown as CollectionGameCommand;
}

describe('collection game commands', () => {
  it('initializes play state lazily with a valid default team', () => {
    const { playState } = setup();
    expect(playState.revision).toBe(0);
    expect(playState.nextGameSequence).toBe(0);
    expect(playState.pendingGame).toBeNull();
    expect(playState.activeTeam.starters).toHaveLength(5);
  });

  it('sets, prepares, abandons, and re-prepares without reusing seeds', () => {
    const { catalog, byId, owned, playState: initial, baseInput } = setup();
    const ownedIds = [...owned];
    const team = initializeCollectionActiveTeam(ownedIds, (cardId) => byId.get(cardId));
    const setResult = applyCollectionGameCommand(
      initial,
      baseCommand(initial, 'cmd-set-1', { command: 'set-active-team', team }),
      baseInput,
    );
    expect(setResult.status).toBe('accepted');
    if (setResult.status !== 'accepted') throw new Error('set rejected');
    expect(setResult.playState.revision).toBe(1);

    const stale = applyCollectionGameCommand(
      setResult.playState,
      baseCommand(initial, 'cmd-set-2', { command: 'set-active-team', team }),
      baseInput,
    );
    expect(stale.status).toBe('rejected');
    if (stale.status !== 'rejected') throw new Error('expected stale');
    expect(stale.rejection.code).toBe('stale-state');

    const prepared = applyCollectionGameCommand(
      setResult.playState,
      baseCommand(setResult.playState, 'cmd-prep-1', { command: 'prepare-basic-game' }),
      baseInput,
    );
    expect(prepared.status).toBe('accepted');
    if (prepared.status !== 'accepted') throw new Error('prepare rejected');
    expect(prepared.playState.pendingGame?.gameSequence).toBe(0);
    expect(prepared.playState.nextGameSequence).toBe(1);

    const locked = applyCollectionGameCommand(
      prepared.playState,
      baseCommand(prepared.playState, 'cmd-set-3', { command: 'set-active-team', team }),
      baseInput,
    );
    expect(locked.status).toBe('rejected');
    if (locked.status !== 'rejected') throw new Error('expected lock');
    expect(locked.rejection.code).toBe('pending-game-conflict');

    const abandoned = applyCollectionGameCommand(
      prepared.playState,
      baseCommand(prepared.playState, 'cmd-abandon-1', {
        command: 'abandon-basic-game',
        gameId: prepared.playState.pendingGame?.gameId,
      }),
      baseInput,
    );
    expect(abandoned.status).toBe('accepted');
    if (abandoned.status !== 'accepted') throw new Error('abandon rejected');
    expect(abandoned.playState.pendingGame).toBeNull();
    expect(abandoned.playState.nextGameSequence).toBe(1);

    const reprepared = applyCollectionGameCommand(
      abandoned.playState,
      baseCommand(abandoned.playState, 'cmd-prep-2', { command: 'prepare-basic-game' }),
      baseInput,
    );
    expect(reprepared.status).toBe('accepted');
    if (reprepared.status !== 'accepted') throw new Error('reprepare rejected');
    expect(reprepared.playState.pendingGame?.gameSequence).toBe(1);
    expect(reprepared.playState.pendingGame?.gameId).not.toBe(
      prepared.playState.pendingGame?.gameId,
    );
    void catalog;
  });

  it('accepts a reproduced result exactly once with the correct reward', () => {
    const { owned, playState: initial, baseInput } = setup();
    void owned;
    const prepared = applyCollectionGameCommand(
      initial,
      baseCommand(initial, 'cmd-prep-1', { command: 'prepare-basic-game' }),
      baseInput,
    );
    expect(prepared.status).toBe('accepted');
    if (prepared.status !== 'accepted' || prepared.playState.pendingGame === null) {
      throw new Error('prepare rejected');
    }
    const pending = prepared.playState.pendingGame;
    const { result, events } = simulateCollectionGame(
      pending,
      baseInput.catalog,
      DEFAULT_ERA_SIM_PROFILE,
    );
    const acceptCommand = baseCommand(prepared.playState, 'cmd-accept-1', {
      command: 'accept-basic-game-result',
      gameId: pending.gameId,
      result,
      events,
      completedAtIso: '2026-01-01T00:00:00.000Z',
    });
    const accepted = applyCollectionGameCommand(prepared.playState, acceptCommand, {
      ...baseInput,
      priorCommands: [baseCommand(initial, 'cmd-prep-1', { command: 'prepare-basic-game' })],
    });
    expect(accepted.status).toBe('accepted');
    if (accepted.status !== 'accepted') throw new Error(JSON.stringify(accepted));
    expect(accepted.playState.pendingGame).toBeNull();
    expect(accepted.ledgerEntry?.pullSequence).toBeNull();
    expect(accepted.ledgerEntry?.currency).toBe('Coins');
    const expectedAmount = result.winner === 'home' ? 100 : 10;
    expect(accepted.ledgerEntry?.amount).toBe(expectedAmount);
    expect(accepted.balances?.Coins).toBe(3000 + expectedAmount);
    expect(accepted.record?.reward.amount).toBe(expectedAmount);

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

  it('rejects tampered results and illegal teams with typed codes', () => {
    const { byId, owned, playState: initial, baseInput } = setup();
    const prepared = applyCollectionGameCommand(
      initial,
      baseCommand(initial, 'cmd-prep-1', { command: 'prepare-basic-game' }),
      baseInput,
    );
    if (prepared.status !== 'accepted' || prepared.playState.pendingGame === null) {
      throw new Error('prepare rejected');
    }
    const pending = prepared.playState.pendingGame;
    const { result, events } = simulateCollectionGame(
      pending,
      baseInput.catalog,
      DEFAULT_ERA_SIM_PROFILE,
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
        completedAtIso: '2026-01-01T00:00:00.000Z',
      }),
      baseInput,
    );
    expect(rejected.status).toBe('rejected');
    if (rejected.status !== 'rejected') throw new Error('expected invalid-result');
    expect(rejected.rejection.code).toBe('invalid-result');

    const ownedIds = [...owned];
    const good = initializeCollectionActiveTeam(ownedIds, (cardId) => byId.get(cardId));
    const guards = good.starters.map((cardId) => byId.get(cardId));
    void guards;
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
  });

  it('rejects rewards that overflow safe integers', () => {
    const { playState: initial, baseInput } = setup();
    const prepared = applyCollectionGameCommand(
      initial,
      baseCommand(initial, 'cmd-prep-1', { command: 'prepare-basic-game' }),
      baseInput,
    );
    if (prepared.status !== 'accepted' || prepared.playState.pendingGame === null) {
      throw new Error('prepare rejected');
    }
    const pending = prepared.playState.pendingGame;
    const { result, events } = simulateCollectionGame(
      pending,
      baseInput.catalog,
      DEFAULT_ERA_SIM_PROFILE,
    );
    const outcome = applyCollectionGameCommand(
      prepared.playState,
      baseCommand(prepared.playState, 'cmd-accept-overflow', {
        command: 'accept-basic-game-result',
        gameId: pending.gameId,
        result,
        events,
        completedAtIso: '2026-01-01T00:00:00.000Z',
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
