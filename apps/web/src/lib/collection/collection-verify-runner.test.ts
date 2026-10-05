import { describe, expect, it } from 'vitest';
import {
  COLLECTION_GAME_WORKER_WIRE_VERSION,
  collectionChallengeDefinitionSchema,
  collectionGameCommandSchema,
  collectionGameWorkerVerifyRequestSchema,
  type CollectionCatalog,
  type CollectionCatalogCard,
  type CollectionChallengeDefinition,
  type CollectionPlayState,
} from '@hoop-rush/data-contracts';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildCollectionDifficultyProfiles,
  buildCollectionFixtureCard,
  buildCollectionFixtureCatalog,
  buildCollectionGameRulesFixture,
  buildCollectionProgressionFixture,
} from '@hoop-rush/test-fixtures';
import {
  collectionObjectiveDefinitionsFromRules,
  initializeCollectionPlayState,
  type CollectionGameCommandInput,
} from '@hoop-rush/engine';
import { runCollectionGameVerification } from './collection-verify-runner';

const HASH = 'a'.repeat(64);
const RARITIES: CollectionCatalogCard['rarity'][] = [
  'Ember',
  'Eruption',
  'Apex',
  'Titan',
  'Eclipse',
  'Immortal',
];
const POSITIONS: CollectionCatalogCard['positions'][] = [['PG'], ['SG'], ['SF'], ['PF'], ['C']];

function buildCatalog(): CollectionCatalog {
  const cards: CollectionCatalogCard[] = [];
  for (let i = 0; i < 24; i += 1) {
    cards.push(
      buildCollectionFixtureCard(`v2-${String(i).padStart(3, '0')}`, {
        playerId: `v2-${String(i).padStart(3, '0')}` as CollectionCatalogCard['playerId'],
        positions: POSITIONS[i % POSITIONS.length] ?? ['PG'],
        rarity: RARITIES[i % RARITIES.length] ?? 'Ember',
        summarySource: {
          overallRating: 60 + (i % 12),
          offenseRating: 60 + (i % 12),
          defenseRating: 60,
        },
      }),
    );
  }
  return buildCollectionFixtureCatalog({
    cards,
    sets: [
      {
        setId: 'heat-check-set',
        title: 'Envelope',
        memberCardIds: [cards[0]?.cardId as string, cards[1]?.cardId as string],
      },
    ],
  });
}

function buildChallenge(): CollectionChallengeDefinition {
  return collectionChallengeDefinitionSchema.parse({
    challengeVersion: 'collection-challenge-v1',
    challengeId: 'challenge-franchise-lakers-v1',
    displayName: 'Fixture Lakers Core',
    description: 'Fixture challenge over the committed team.',
    requirement: {
      kind: 'franchise-core',
      franchiseId: 'lakers',
      minimumRosterCount: 5,
      minimumStarterCount: 2,
    },
    difficultyId: 'pro',
    firstClearCoins: 450,
    repeatWinCoins: 45,
  });
}

function buildEngineInput(catalog: CollectionCatalog): CollectionGameCommandInput {
  const rules = buildCollectionGameRulesFixture();
  return {
    catalog,
    ownedCardIds: new Set(catalog.cards.map((card) => card.cardId)),
    rootSeed: '0'.repeat(32),
    cpuWeights: {
      Ember: 1,
      Eruption: 1,
      Apex: 1,
      Titan: 1,
      Eclipse: 1,
      Immortal: 1,
    },
    difficultyProfiles: buildCollectionDifficultyProfiles(),
    objectiveDefinitions: collectionObjectiveDefinitionsFromRules(rules),
    profile: DEFAULT_ERA_SIM_PROFILE,
    profileHash: HASH,
    catalogHash: HASH,
    rulesHash: HASH,
    balances: { Coins: 0, Exchange: 0 },
    priorCommands: [],
    progression: buildCollectionProgressionFixture({
      catalog,
      challenges: [buildChallenge()],
    }),
    progressionHash: HASH,
  };
}

class FakeCollectionWorker {
  posted: unknown[] = [];
  terminated = 0;
  private listeners = new Map<string, Array<(event: MessageEvent<unknown>) => void>>();
  postMessage(data: unknown): void {
    this.posted.push(data);
  }
  addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => entry !== listener),
    );
  }
  terminate(): void {
    this.terminated += 1;
  }
  emit(data: unknown): void {
    for (const listener of [...(this.listeners.get('message') ?? [])]) {
      listener({ data } as MessageEvent<unknown>);
    }
  }
}

function buildVerifyCase() {
  const catalog = buildCatalog();
  const playState = initializeCollectionPlayState({
    collectionId: 'collection-test' as CollectionPlayState['collectionId'],
    ownedCardIds: catalog.cards.map((card) => card.cardId),
    resolve: (cardId) => catalog.cards.find((card) => card.cardId === cardId),
  });
  const command = collectionGameCommandSchema.parse({
    schemaVersion: 1,
    commandVersion: 'collection-game-command-v1',
    commandId: 'verify-cmd-1',
    collectionId: playState.collectionId,
    expectedRevision: playState.revision,
    expectedDigest: playState.digest,
    command: 'set-active-team',
    team: playState.activeTeam,
  });
  return { catalog, playState, command };
}

const FUZZ_PAYLOADS: unknown[] = [
  undefined,
  null,
  42,
  'wire-noise',
  [],
  {},
  { type: 'collection-game-verified' },
  { wireVersion: 999, type: 'nope', requestId: 'req-fuzz' },
  {
    wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
    type: 'collection-game-verified',
    requestId: 'req-fuzz',
  },
  {
    wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
    type: 'collection-game-verified',
    requestId: 'req-fuzz',
    outcome: { status: 'rejected' },
  },
  {
    wireVersion: 'v0',
    type: 'collection-game-error',
    requestId: 'req-fuzz',
    gameId: null,
    code: 'internal',
    message: 'boom',
    seed: null,
  },
];

describe('collection verify runner worker envelope', () => {
  it('posts a verify request without engine assets and resolves the audited outcome', async () => {
    const { catalog, playState, command } = buildVerifyCase();
    const worker = new FakeCollectionWorker();
    const promise = runCollectionGameVerification({
      playState,
      command,
      engineInput: buildEngineInput(catalog),
      assets: {
        catalogUrl: 'https://example.test/catalog.json',
        catalogHash: HASH,
        profileUrl: 'https://example.test/profile.json',
        profileHash: HASH,
      },
      requestId: 'req-verify-1',
      createWorker: () => worker as unknown as Worker,
    });
    const request = collectionGameWorkerVerifyRequestSchema.parse(worker.posted[0]);
    expect(request.requestId).toBe('req-verify-1');
    expect(request.command.commandId).toBe(command.commandId);
    expect(request.playState.digest).toBe(playState.digest);
    expect('catalog' in request).toBe(false);
    expect('profile' in request).toBe(false);
    worker.emit({
      wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
      type: 'collection-game-verified',
      requestId: 'req-verify-1',
      outcome: { status: 'rejected', rejection: { code: 'stale-state' } },
    });
    const outcome = await promise;
    expect(outcome).toEqual({ status: 'rejected', rejection: { code: 'stale-state' } });
    expect(worker.terminated).toBe(1);
  });

  it('resolves accepted outcomes with the committed play state', async () => {
    const { catalog, playState, command } = buildVerifyCase();
    const worker = new FakeCollectionWorker();
    const promise = runCollectionGameVerification({
      playState,
      command,
      engineInput: buildEngineInput(catalog),
      assets: {
        catalogUrl: 'https://example.test/catalog.json',
        catalogHash: HASH,
        profileUrl: 'https://example.test/profile.json',
        profileHash: HASH,
      },
      requestId: 'req-verify-2',
      createWorker: () => worker as unknown as Worker,
    });
    worker.emit({
      wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
      type: 'collection-game-verified',
      requestId: 'req-verify-2',
      outcome: { status: 'accepted', playState, balances: { Coins: 120, Exchange: 0 } },
    });
    const outcome = await promise;
    expect(outcome.status).toBe('accepted');
    expect(worker.terminated).toBe(1);
  });

  it('rejects worker error messages instead of hanging', async () => {
    const { catalog, playState, command } = buildVerifyCase();
    const worker = new FakeCollectionWorker();
    const promise = runCollectionGameVerification({
      playState,
      command,
      engineInput: buildEngineInput(catalog),
      assets: {
        catalogUrl: 'https://example.test/catalog.json',
        catalogHash: HASH,
        profileUrl: 'https://example.test/profile.json',
        profileHash: HASH,
      },
      requestId: 'req-verify-3',
      createWorker: () => worker as unknown as Worker,
    });
    worker.emit({
      wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
      type: 'collection-game-error',
      requestId: 'req-verify-3',
      gameId: null,
      code: 'internal',
      message: 'verify exploded',
      seed: null,
    });
    await expect(promise).rejects.toThrow('verify exploded');
    expect(worker.terminated).toBe(1);
  });

  it.each(FUZZ_PAYLOADS.map((payload, index) => ({ payload, index })))(
    'rejects unparsable envelope $index instead of hanging forever',
    async ({ payload }) => {
      const { catalog, playState, command } = buildVerifyCase();
      const worker = new FakeCollectionWorker();
      const promise = runCollectionGameVerification({
        playState,
        command,
        engineInput: buildEngineInput(catalog),
        assets: {
          catalogUrl: 'https://example.test/catalog.json',
          catalogHash: HASH,
          profileUrl: 'https://example.test/profile.json',
          profileHash: HASH,
        },
        requestId: 'req-fuzz',
        createWorker: () => worker as unknown as Worker,
      });
      worker.emit(payload);
      await expect(promise).rejects.toThrow(/outside the worker wire schema/);
      expect(worker.terminated).toBe(1);
    },
  );
});
