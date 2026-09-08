import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  type CollectionCatalog,
  type CollectionCatalogCard,
  type CollectionRarity,
} from '@hoop-rush/data-contracts';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildCollectionFixtureCard,
  buildCollectionFixtureCatalog,
} from '@hoop-rush/test-fixtures';
import { initializeCollectionActiveTeam } from './active-team.ts';
import { checkCollectionGameResult } from './game-audit.ts';
import {
  collectionGameEventDigest,
  collectionGameRewardFor,
  collectionGameResultDigest,
  prepareCollectionBasicGame,
  reproduceCollectionGame,
  simulateCollectionGame,
} from './game.ts';

const RARITIES: CollectionRarity[] = ['Ember', 'Eruption', 'Apex', 'Titan', 'Eclipse', 'Immortal'];
const WEIGHTS: Record<CollectionRarity, number> = {
  Ember: 70,
  Eruption: 23,
  Apex: 5,
  Titan: 1.7,
  Eclipse: 0.29,
  Immortal: 0.01,
};
const POSITIONS: Array<CollectionCatalogCard['positions']> = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['C'],
];

function gameCatalog(size: number): CollectionCatalog {
  const cards: CollectionCatalogCard[] = [];
  for (let i = 0; i < size; i += 1) {
    const rarity = RARITIES[i % RARITIES.length] ?? 'Ember';
    const positions = POSITIONS[i % POSITIONS.length] ?? ['PG'];
    cards.push(
      buildCollectionFixtureCard(`game-${String(i).padStart(3, '0')}`, {
        playerId: `game-${String(i).padStart(3, '0')}` as CollectionCatalogCard['playerId'],
        positions,
        rarity,
        summarySource: { overallRating: 60, offenseRating: 60, defenseRating: 60 },
      }),
    );
  }
  return buildCollectionFixtureCatalog({
    cards,
    sets: [
      {
        setId: 'sharpshooter-set',
        title: 'Game',
        memberCardIds: [cards[0]?.cardId as string, cards[1]?.cardId as string],
      },
    ],
  });
}

const HASH = 'a'.repeat(64);

describe('collection basic games', () => {
  it('completes a five-card heavy-minute game with a clean audit', () => {
    const catalog = gameCatalog(18);
    const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
    const owned = catalog.cards.slice(0, 5).map((card) => card.cardId);
    const team = initializeCollectionActiveTeam(owned, (cardId) => byId.get(cardId));
    expect(team.bench).toHaveLength(0);
    const prepared = prepareCollectionBasicGame({
      collectionId: 'collection-1',
      rootSeed: '0'.repeat(32),
      gameSequence: 0,
      ownedCardIds: new Set(owned),
      team,
      catalog,
      cpuWeights: WEIGHTS,
      profileVersion: DEFAULT_ERA_SIM_PROFILE.profileVersion,
      profileHash: HASH,
      catalogHash: HASH,
      rulesHash: HASH,
    });
    expect(prepared.playerTeam.starters).toHaveLength(5);
    expect([...prepared.cpuTeam.starters, ...prepared.cpuTeam.bench]).toHaveLength(12);
    const first = simulateCollectionGame(prepared, catalog, DEFAULT_ERA_SIM_PROFILE);
    const second = simulateCollectionGame(prepared, catalog, DEFAULT_ERA_SIM_PROFILE);
    expect(canonicalJson(second.result)).toBe(canonicalJson(first.result));
    expect(canonicalJson(second.events)).toBe(canonicalJson(first.events));
    if (first.result.outcome !== 'completed') throw new Error('expected a completed game');
    for (const player of first.result.home.players) {
      expect(player.seconds).toBe(48 * 60 + first.result.overtimePeriods * 5 * 60);
    }
    expect(
      checkCollectionGameResult(
        first.result,
        first.events,
        prepared,
        catalog,
        DEFAULT_ERA_SIM_PROFILE,
      ),
    ).toEqual([]);
    const reward = collectionGameRewardFor(first.result, prepared.gameId);
    expect(reward.currency).toBe('Coins');
    expect([100, 10]).toContain(reward.amount);
    expect(reward.transactionId).toMatch(/^txn-[0-9a-f]{32}$/);
    const reproduced = reproduceCollectionGame(prepared, catalog, DEFAULT_ERA_SIM_PROFILE);
    expect(reproduced.resultDigest).toBe(collectionGameResultDigest(first.result));
    expect(reproduced.eventDigest).toBe(collectionGameEventDigest(first.events));
  });

  it('completes twelve-card rotation games with clean audits across seeds', () => {
    const catalog = gameCatalog(24);
    const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
    const owned = catalog.cards.slice(0, 12).map((card) => card.cardId);
    const team = initializeCollectionActiveTeam(owned, (cardId) => byId.get(cardId));
    for (let gameSequence = 0; gameSequence < 12; gameSequence += 1) {
      const prepared = prepareCollectionBasicGame({
        collectionId: 'collection-1',
        rootSeed: '2'.repeat(32),
        gameSequence,
        ownedCardIds: new Set(owned),
        team,
        catalog,
        cpuWeights: WEIGHTS,
        profileVersion: DEFAULT_ERA_SIM_PROFILE.profileVersion,
        profileHash: HASH,
        catalogHash: HASH,
        rulesHash: HASH,
      });
      const { result, events } = simulateCollectionGame(prepared, catalog, DEFAULT_ERA_SIM_PROFILE);
      expect(
        checkCollectionGameResult(result, events, prepared, catalog, DEFAULT_ERA_SIM_PROFILE),
      ).toEqual([]);
      if (result.outcome !== 'completed') throw new Error('expected a completed game');
      const reward = collectionGameRewardFor(result, prepared.gameId);
      expect(reward.amount).toBe(result.winner === 'home' ? 100 : 10);
      for (const side of [result.home, result.away] as const) {
        for (const exception of side.foulLimitExceptions) {
          const deviation = result.deviations.find((entry) => entry.cardId === exception.cardId);
          if (deviation !== undefined) {
            expect(deviation.reasons).toContain('foul-limit-exception');
          }
        }
      }
    }
  });

  it('finds an overtime game with exact period accounting', () => {
    const catalog = gameCatalog(24);
    const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
    const owned = catalog.cards.slice(0, 12).map((card) => card.cardId);
    const team = initializeCollectionActiveTeam(owned, (cardId) => byId.get(cardId));
    let found = 0;
    for (let gameSequence = 0; gameSequence < 200; gameSequence += 1) {
      const prepared = prepareCollectionBasicGame({
        collectionId: 'collection-1',
        rootSeed: '3'.repeat(32),
        gameSequence,
        ownedCardIds: new Set(owned),
        team,
        catalog,
        cpuWeights: WEIGHTS,
        profileVersion: DEFAULT_ERA_SIM_PROFILE.profileVersion,
        profileHash: HASH,
        catalogHash: HASH,
        rulesHash: HASH,
      });
      const { result, events } = simulateCollectionGame(prepared, catalog, DEFAULT_ERA_SIM_PROFILE);
      if (result.outcome !== 'completed' || result.overtimePeriods === 0) continue;
      found += 1;
      expect(result.home.periodScores).toHaveLength(4 + result.overtimePeriods);
      expect(
        checkCollectionGameResult(result, events, prepared, catalog, DEFAULT_ERA_SIM_PROFILE),
      ).toEqual([]);
      const expectedSideSeconds = 5 * (4 * 720 + result.overtimePeriods * 300);
      for (const side of [result.home, result.away]) {
        expect(side.players.reduce((sum, player) => sum + player.seconds, 0)).toBe(
          expectedSideSeconds,
        );
      }
      break;
    }
    expect(found).toBe(1);
  });

  it('records the minimum-five foul-limit exception as a game fact', () => {
    const catalog = gameCatalog(18);
    const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
    const owned = catalog.cards.slice(0, 5).map((card) => card.cardId);
    const team = initializeCollectionActiveTeam(owned, (cardId) => byId.get(cardId));
    let found = 0;
    for (let gameSequence = 0; gameSequence < 12; gameSequence += 1) {
      const prepared = prepareCollectionBasicGame({
        collectionId: 'collection-1',
        rootSeed: '4'.repeat(32),
        gameSequence,
        ownedCardIds: new Set(owned),
        team,
        catalog,
        cpuWeights: WEIGHTS,
        profileVersion: DEFAULT_ERA_SIM_PROFILE.profileVersion,
        profileHash: HASH,
        catalogHash: HASH,
        rulesHash: HASH,
      });
      const { result, events } = simulateCollectionGame(prepared, catalog, DEFAULT_ERA_SIM_PROFILE);
      expect(
        checkCollectionGameResult(result, events, prepared, catalog, DEFAULT_ERA_SIM_PROFILE),
      ).toEqual([]);
      if (result.outcome !== 'completed') throw new Error('expected a completed game');
      const exceptions = [...result.home.foulLimitExceptions, ...result.away.foulLimitExceptions];
      if (exceptions.length === 0) continue;
      found += 1;
      const homeRoster = new Set([...prepared.playerTeam.starters, ...prepared.playerTeam.bench]);
      const awayRoster = new Set([...prepared.cpuTeam.starters, ...prepared.cpuTeam.bench]);
      for (const exception of exceptions) {
        const roster = exception.side === 'home' ? homeRoster : awayRoster;
        expect(roster.has(exception.cardId)).toBe(true);
        const deviation = result.deviations.find(
          (entry) => entry.side === exception.side && entry.cardId === exception.cardId,
        );
        if (deviation !== undefined) {
          expect(deviation.reasons).toContain('foul-limit-exception');
        }
      }
      break;
    }
    expect(found).toBe(1);
  });
});
