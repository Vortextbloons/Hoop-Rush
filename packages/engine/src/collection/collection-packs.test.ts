import { describe, expect, it } from 'vitest';
import {
  COLLECTION_CATALOG_VERSION,
  COLLECTION_ECONOMY_VERSION,
  COLLECTION_PACK_RULES_VERSION,
  COLLECTION_RARITY_ORDER,
  collectionStateSchema,
  type CollectionBalances,
  type CollectionCatalog,
  type CollectionCommand,
  type CollectionPackDefinition,
  type CollectionRarity,
  type CollectionState,
} from '@hoop-rush/data-contracts';
import {
  buildCollectionFixtureCatalog,
  buildCollectionFixtureCard,
  buildLegalSimulationTeam,
  DEFAULT_ERA_SIM_PROFILE,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import {
  applyCollectionCommand,
  auditCollectionState,
  collectionStateDigest,
  createEngineContext,
  checkGameResult,
  describeCollectionPackOdds,
  drawCollectionPackSlots,
  generateCollectionStarter,
  reproduceCollectionPull,
  simulateGame,
  toCollectionSimulationPlayer,
  validateCollectionPlayableFive,
} from '../index.ts';

const ROOT_SEED = 'c'.repeat(32);
const CATALOG_HASH = 'd'.repeat(64);
const ACQUIRED_AT = '2026-01-01T00:00:00.000Z';

function freshState(
  balances: CollectionBalances = { Coins: 0, Exchange: 0 },
  overrides: Partial<CollectionState> = {},
): CollectionState {
  const base = {
    schemaVersion: 1,
    collectionVersion: 'collection-v1',
    catalogVersion: COLLECTION_CATALOG_VERSION,
    economyVersion: COLLECTION_ECONOMY_VERSION,
    collectionId: 'collection-1',
    rootSeed: ROOT_SEED,
    revision: 0,
    digest: '0'.repeat(32),
    claimedWelcome: false,
    owned: [],
    balances,
    nextPullSequence: 0,
    ...overrides,
  } as CollectionState;
  const digest = collectionStateDigest({
    collectionId: base.collectionId,
    revision: base.revision,
    claimedWelcome: base.claimedWelcome,
    ownedCardIds: base.owned.map((entry) => entry.cardId),
    balances: base.balances,
    nextPullSequence: base.nextPullSequence,
    catalogVersion: base.catalogVersion,
    economyVersion: base.economyVersion,
  });
  return collectionStateSchema.parse({ ...base, digest });
}

function welcomeCommand(state: CollectionState, commandId = 'cmd-welcome'): CollectionCommand {
  return {
    schemaVersion: 1,
    commandVersion: 'collection-command-v1',
    commandId,
    collectionId: state.collectionId,
    expectedRevision: state.revision,
    expectedDigest: state.digest,
    command: 'claim-welcome',
    acquiredAtIso: ACQUIRED_AT,
  };
}

function packCommand(
  state: CollectionState,
  packId: 'tip-off',
  commandId: string,
): CollectionCommand {
  return {
    schemaVersion: 1,
    commandVersion: 'collection-command-v1',
    commandId,
    collectionId: state.collectionId,
    expectedRevision: state.revision,
    expectedDigest: state.digest,
    command: 'open-pack',
    packId,
    acquiredAtIso: ACQUIRED_AT,
  };
}

function rarityCatalog(): CollectionCatalog {
  const base = buildCollectionFixtureCatalog();
  const specs: Array<[string, CollectionRarity, string, number]> = [
    ['rarity-ember-a', 'Ember', 'Ember A', 60],
    ['rarity-ember-b', 'Ember', 'Ember B', 61],
    ['rarity-eruption-a', 'Eruption', 'Eruption A', 72],
    ['rarity-eruption-b', 'Eruption', 'Eruption B', 73],
    ['rarity-apex-a', 'Apex', 'Apex A', 85],
    ['rarity-titan-a', 'Titan', 'Titan A', 90],
    ['rarity-eclipse-a', 'Eclipse', 'Eclipse A', 95],
    ['rarity-immortal-a', 'Immortal', 'Immortal A', 99],
  ];
  const cards = specs.map(([playerId, rarity, displayName, overall]) =>
    buildCollectionFixtureCard(playerId, {
      displayName,
      rarity,
      summarySource: { overallRating: overall, offenseRating: overall, defenseRating: overall },
    }),
  );
  return { ...base, cards };
}

function launchLikePack(
  packId: CollectionPackDefinition['packId'],
  slots: CollectionPackDefinition['slots'],
  priceAmount = 100,
): CollectionPackDefinition {
  return {
    packId,
    packRulesVersion: COLLECTION_PACK_RULES_VERSION,
    priceCurrency: 'Coins',
    priceAmount,
    slots,
    eligibleScope: 'full-catalog',
    rarityWeights: { Ember: 70, Eruption: 23, Apex: 5, Titan: 1.7, Eclipse: 0.29, Immortal: 0.01 },
    duplicateExchange: {
      Ember: 5,
      Eruption: 15,
      Apex: 50,
      Titan: 150,
      Eclipse: 500,
      Immortal: 1500,
    },
  };
}

function emberOnlyPack(priceAmount = 0): CollectionPackDefinition {
  return {
    ...launchLikePack('tip-off', [{ kind: 'ordinary' }], priceAmount),
    rarityWeights: { Ember: 1, Eruption: 0, Apex: 0, Titan: 0, Eclipse: 0, Immortal: 0 },
  };
}

describe('collection starter', () => {
  it('draws five distinct Ember players with a legal assignment', () => {
    const catalog = buildCollectionFixtureCatalog();
    const first = generateCollectionStarter(catalog, ROOT_SEED);
    const second = generateCollectionStarter(catalog, ROOT_SEED);
    expect(second).toEqual(first);
    expect(first.cardIds).toHaveLength(5);
    const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
    const players = first.cardIds.map((cardId) => byId.get(cardId));
    for (const card of players) {
      expect(card?.family).toBe('Base');
      expect(card?.rarity).toBe('Ember');
    }
    expect(new Set(players.map((card) => card?.playerId)).size).toBe(5);
    expect(first.assignment.map((entry) => entry.slotIndex).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(validateCollectionPlayableFive(first.cardIds, (cardId) => byId.get(cardId)).ok).toBe(
      true,
    );
    expect(first.seedPath).toEqual(['collection', 'starter']);
  });

  it('is stable despite input catalog ordering', () => {
    const catalog = buildCollectionFixtureCatalog();
    const reversed = { ...catalog, cards: [...catalog.cards].reverse() };
    expect(generateCollectionStarter(reversed, ROOT_SEED)).toEqual(
      generateCollectionStarter(catalog, ROOT_SEED),
    );
  });

  it('completes a real seeded game with accounting invariants', () => {
    const catalog = buildCollectionFixtureCatalog();
    const starter = generateCollectionStarter(catalog, ROOT_SEED);
    const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
    const players = starter.cardIds.map((cardId) => {
      const card = byId.get(cardId);
      if (card === undefined) throw new Error(`missing starter card ${cardId}`);
      return toCollectionSimulationPlayer(
        {
          cardId: card.cardId,
          playerId: card.playerId,
          displayName: card.displayName,
          positions: [...card.positions],
          ratings: card.detailedRatings,
          tendencies: card.tendencies,
        },
        card,
      );
    });
    const [p0, p1, p2, p3, p4] = players;
    if (
      p0 === undefined ||
      p1 === undefined ||
      p2 === undefined ||
      p3 === undefined ||
      p4 === undefined
    ) {
      throw new Error('starter did not yield five players');
    }
    const result = simulateGame(
      {
        schemaVersion: 2,
        seed: seedFromString('starter-game'),
        gameNumber: 1,
        dataVersion: 'fixture-data-v1',
        profile: DEFAULT_ERA_SIM_PROFILE,
        home: { teamId: 'starter', displayName: 'Starter Five', players: [p0, p1, p2, p3, p4] },
        away: buildLegalSimulationTeam({ teamId: 'fixture-away', displayName: 'Fixture Away' }),
      },
      createEngineContext(),
    );
    expect(checkGameResult(result)).toEqual([]);
  });
});

describe('collection pack draws', () => {
  it('honors pack sizes with dedicated guarantee slots', () => {
    const catalog = rarityCatalog();
    const fullCourt = launchLikePack('full-court', [
      { kind: 'ordinary' },
      { kind: 'ordinary' },
      { kind: 'ordinary' },
      { kind: 'ordinary' },
      { kind: 'guaranteed', floorRarity: 'Eruption' },
    ]);
    const mainEvent = launchLikePack('main-event', [
      ...Array.from({ length: 9 }, () => ({ kind: 'ordinary' as const })),
      { kind: 'guaranteed' as const, floorRarity: 'Apex' as const },
    ]);
    const tipOff = launchLikePack('tip-off', [{ kind: 'ordinary' }]);
    expect(drawCollectionPackSlots(catalog, tipOff, ROOT_SEED, 0).draws).toHaveLength(1);
    const full = drawCollectionPackSlots(catalog, fullCourt, ROOT_SEED, 0).draws;
    expect(full).toHaveLength(5);
    const fullFloor = COLLECTION_RARITY_ORDER.indexOf(full[4]?.rarity ?? 'Ember');
    expect(fullFloor).toBeGreaterThanOrEqual(COLLECTION_RARITY_ORDER.indexOf('Eruption'));
    const main = drawCollectionPackSlots(catalog, mainEvent, ROOT_SEED, 0).draws;
    expect(main).toHaveLength(10);
    const mainFloor = COLLECTION_RARITY_ORDER.indexOf(main[9]?.rarity ?? 'Ember');
    expect(mainFloor).toBeGreaterThanOrEqual(COLLECTION_RARITY_ORDER.indexOf('Apex'));
  });

  it('never drops guaranteed slots below the floor across seeds', () => {
    const catalog = rarityCatalog();
    const pack = launchLikePack('full-court', [
      { kind: 'ordinary' },
      { kind: 'ordinary' },
      { kind: 'ordinary' },
      { kind: 'ordinary' },
      { kind: 'guaranteed', floorRarity: 'Eruption' },
    ]);
    for (let sequence = 0; sequence < 50; sequence += 1) {
      const seed = `${(sequence % 16).toString(16)}${'e'.repeat(31)}`;
      const { draws } = drawCollectionPackSlots(catalog, pack, seed, sequence);
      const at = COLLECTION_RARITY_ORDER.indexOf(draws[4]?.rarity ?? 'Ember');
      expect(at).toBeGreaterThanOrEqual(COLLECTION_RARITY_ORDER.indexOf('Eruption'));
    }
  });

  it('reaches every weighted rarity and is byte-identical per seed', () => {
    const catalog = rarityCatalog();
    const pack: CollectionPackDefinition = {
      ...launchLikePack('tip-off', [{ kind: 'ordinary' }]),
      rarityWeights: { Ember: 1, Eruption: 1, Apex: 1, Titan: 1, Eclipse: 1, Immortal: 1 },
    };
    const seen = new Set<string>();
    for (let sequence = 0; sequence < 200; sequence += 1) {
      const seed = `${(sequence % 16).toString(16)}${'b'.repeat(31)}`;
      const first = drawCollectionPackSlots(catalog, pack, seed, sequence);
      const second = drawCollectionPackSlots(catalog, pack, seed, sequence);
      expect(second).toEqual(first);
      for (const draw of first.draws) seen.add(draw.rarity);
    }
    expect([...seen].sort()).toEqual(['Apex', 'Eclipse', 'Ember', 'Eruption', 'Immortal', 'Titan']);
  });

  it('rejects invalid definitions with no eligible cards', () => {
    const catalog = rarityCatalog();
    const pack = launchLikePack('spotlight', [{ kind: 'guaranteed', floorRarity: 'Immortal' }]);
    const broken: CollectionPackDefinition = {
      ...pack,
      eligibleScope: 'specials-only',
    };
    expect(() => drawCollectionPackSlots(catalog, broken, ROOT_SEED, 0)).toThrow();
  });
});

describe('collection commands', () => {
  it('claims the welcome grant atomically', () => {
    const catalog = buildCollectionFixtureCatalog();
    const state = freshState();
    const command = welcomeCommand(state);
    const result = applyCollectionCommand(state, command, catalog, [], [], [], CATALOG_HASH);
    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') return;
    expect(result.state.claimedWelcome).toBe(true);
    expect(result.state.balances).toEqual({ Coins: 3000, Exchange: 0 });
    expect(result.state.owned).toHaveLength(5);
    expect(result.state.revision).toBe(1);
    expect(result.state.nextPullSequence).toBe(1);
    expect(result.pull.kind).toBe('welcome');
    expect(result.pull.slots.every((slot) => slot.kept)).toBe(true);
    expect(result.ledgerEntries).toHaveLength(1);
    expect(result.ledgerEntries[0]).toMatchObject({
      currency: 'Coins',
      amount: 3000,
      reason: 'welcome-grant',
    });
    expect(reproduceCollectionPull(catalog, result.pull, state.rootSeed).ok).toBe(true);
    expect(auditCollectionState(result.state, [result.pull], result.ledgerEntries)).toEqual([]);
  });

  it('converts exact duplicates and keeps versions separate', () => {
    const twinA = buildCollectionFixtureCard('twin-player', { displayName: 'Twin A' });
    const twinB = buildCollectionFixtureCard('twin-player-b', {
      playerId: 'twin-player',
      displayName: 'Twin B',
      summarySource: { overallRating: 61, offenseRating: 61, defenseRating: 60 },
    });
    expect(twinA.cardId).not.toBe(twinB.cardId);
    const base = buildCollectionFixtureCatalog();
    const pack = emberOnlyPack(0);
    const catalog = { ...base, cards: [twinA, twinB], packs: [pack] };
    let state = freshState({ Coins: 0, Exchange: 0 });
    const firstCommand = packCommand(state, 'tip-off', 'cmd-1');
    const first = applyCollectionCommand(state, firstCommand, catalog, [], [], [], CATALOG_HASH);
    expect(first.status).toBe('accepted');
    if (first.status !== 'accepted') return;
    expect(first.pull.slots[0]?.kept).toBe(true);
    expect(first.state.owned).toHaveLength(1);
    state = first.state;
    const predicted = drawCollectionPackSlots(catalog, pack, state.rootSeed, 1).draws[0];
    const secondCommand = packCommand(state, 'tip-off', 'cmd-2');
    const pulls = [first.pull];
    const ledger = [...first.ledgerEntries];
    const second = applyCollectionCommand(
      state,
      secondCommand,
      catalog,
      pulls,
      ledger,
      [firstCommand],
      CATALOG_HASH,
    );
    expect(second.status).toBe('accepted');
    if (second.status !== 'accepted') return;
    expect(second.pull.slots[0]?.cardId).toBe(predicted?.cardId);
    if (predicted?.cardId === first.pull.slots[0]?.cardId) {
      expect(second.pull.slots[0]).toMatchObject({ kept: false, conversionAmount: 5 });
      expect(second.state.owned).toHaveLength(1);
      expect(second.state.balances.Exchange).toBe(5);
    } else {
      expect(second.pull.slots[0]).toMatchObject({ kept: true, conversionAmount: 0 });
      expect(second.state.owned).toHaveLength(2);
    }
    expect(reproduceCollectionPull(catalog, second.pull, state.rootSeed).ok).toBe(true);
    expect(
      auditCollectionState(
        second.state,
        [...pulls, second.pull],
        [...ledger, ...second.ledgerEntries],
      ),
    ).toEqual([]);
  });

  it('rejects funds, reuse, stale state, and overflow failures', () => {
    const catalog = buildCollectionFixtureCatalog();
    const poorCatalog = rarityCatalog();
    const poorPack = launchLikePack('tip-off', [{ kind: 'ordinary' }], 100);
    const poorCatalogWithPack = { ...poorCatalog, packs: [poorPack] };
    const poor = freshState();
    const insufficient = applyCollectionCommand(
      poor,
      packCommand(poor, 'tip-off', 'cmd-poor'),
      poorCatalogWithPack,
      [],
      [],
      [],
      CATALOG_HASH,
    );
    expect(insufficient.status).toBe('rejected');
    if (insufficient.status === 'rejected') {
      expect(insufficient.rejection.code).toBe('insufficient-funds');
    }

    const rich = freshState({ Coins: 10000, Exchange: 0 });
    const welcome = welcomeCommand(rich, 'cmd-twice');
    const accepted = applyCollectionCommand(rich, welcome, catalog, [], [], [], CATALOG_HASH);
    expect(accepted.status).toBe('accepted');
    if (accepted.status !== 'accepted') return;
    const duplicate = applyCollectionCommand(
      accepted.state,
      welcome,
      catalog,
      [accepted.pull],
      accepted.ledgerEntries,
      [welcome],
      CATALOG_HASH,
    );
    expect(duplicate.status).toBe('rejected');
    if (duplicate.status === 'rejected') {
      expect(duplicate.rejection.code).toBe('duplicate-command');
    }
    const conflict: CollectionCommand = {
      schemaVersion: 1,
      commandVersion: 'collection-command-v1',
      commandId: welcome.commandId,
      collectionId: accepted.state.collectionId,
      expectedRevision: accepted.state.revision,
      expectedDigest: accepted.state.digest,
      command: 'open-pack',
      packId: 'tip-off',
      acquiredAtIso: ACQUIRED_AT,
    };
    const conflicting = applyCollectionCommand(
      accepted.state,
      conflict,
      catalog,
      [accepted.pull],
      accepted.ledgerEntries,
      [welcome],
      CATALOG_HASH,
    );
    expect(conflicting.status).toBe('rejected');
    if (conflicting.status === 'rejected') {
      expect(conflicting.rejection.code).toBe('conflicting-command-reuse');
    }
    const stale = welcomeCommand(accepted.state, 'cmd-stale');
    const staleCommand: CollectionCommand = {
      ...stale,
      expectedRevision: 0,
      expectedDigest: '0'.repeat(32),
    };
    const staleResult = applyCollectionCommand(
      accepted.state,
      staleCommand,
      catalog,
      [accepted.pull],
      accepted.ledgerEntries,
      [welcome],
      CATALOG_HASH,
    );
    expect(staleResult.status).toBe('rejected');
    if (staleResult.status === 'rejected') {
      expect(staleResult.rejection.code).toBe('stale-state');
    }
    const again = applyCollectionCommand(
      accepted.state,
      welcomeCommand(accepted.state, 'cmd-again'),
      catalog,
      [accepted.pull],
      accepted.ledgerEntries,
      [welcome],
      CATALOG_HASH,
    );
    expect(again.status).toBe('rejected');
    if (again.status === 'rejected') {
      expect(again.rejection.code).toBe('already-claimed');
    }
    const flush = freshState({ Coins: Number.MAX_SAFE_INTEGER, Exchange: 0 });
    const overflow = applyCollectionCommand(
      flush,
      welcomeCommand(flush, 'cmd-overflow'),
      catalog,
      [],
      [],
      [],
      CATALOG_HASH,
    );
    expect(overflow.status).toBe('rejected');
    if (overflow.status === 'rejected') {
      expect(overflow.rejection.code).toBe('arithmetic-overflow');
    }
  });

  it('describes odds analytically with retained precision', () => {
    const catalog = rarityCatalog();
    const pack = launchLikePack('main-event', [
      ...Array.from({ length: 9 }, () => ({ kind: 'ordinary' as const })),
      { kind: 'guaranteed' as const, floorRarity: 'Apex' as const },
    ]);
    const odds = describeCollectionPackOdds(catalog, pack);
    expect(odds.cardCount).toBe(10);
    for (const slot of odds.perSlot) {
      const total = Object.values(slot.distribution).reduce((sum, value) => sum + value, 0);
      expect(total).toBeCloseTo(1, 10);
    }
    expect(odds.atLeastOne.Immortal).toBeGreaterThan(0);
    const ordinary = odds.perSlot[0]?.distribution;
    if (ordinary === undefined) throw new Error('missing ordinary slot');
    let none = 1;
    for (const slot of odds.perSlot) none *= 1 - slot.distribution.Apex;
    expect(odds.atLeastOne.Apex).toBeCloseTo(1 - none, 12);
  });
});
