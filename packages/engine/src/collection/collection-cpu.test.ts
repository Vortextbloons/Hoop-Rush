import { describe, expect, it } from 'vitest';
import {
  COLLECTION_GAME_CPU_ROSTER_SIZE,
  type CollectionCatalog,
  type CollectionCatalogCard,
  type CollectionRarity,
} from '@hoop-rush/data-contracts';
import {
  buildCollectionFixtureCard,
  buildCollectionFixtureCatalog,
} from '@hoop-rush/test-fixtures';
import { generateCollectionCpuTeam } from './cpu.ts';
import { collectionCpuTeamSeed, collectionGameId, collectionGameSeed } from './seeds.ts';
import { validateCollectionActiveTeam } from './active-team.ts';
import { assignLineup } from '../domain/lineup.ts';

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

function mixedCatalog(size: number): CollectionCatalog {
  const cards: CollectionCatalogCard[] = [];
  for (let i = 0; i < size; i += 1) {
    const rarity = RARITIES[i % RARITIES.length] ?? 'Ember';
    const positions = POSITIONS[i % POSITIONS.length] ?? ['PG'];
    cards.push(
      buildCollectionFixtureCard(`cpu-${String(i).padStart(3, '0')}`, {
        playerId: `cpu-${String(i).padStart(3, '0')}` as CollectionCatalogCard['playerId'],
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
        title: 'Cpu',
        memberCardIds: [cards[0]?.cardId as string, cards[1]?.cardId as string],
      },
    ],
  });
}

describe('collection cpu teams', () => {
  it('generates a legal deterministic 12-card team', () => {
    const catalog = mixedCatalog(60);
    const rootSeed = '0'.repeat(32);
    const first = generateCollectionCpuTeam(catalog, rootSeed, 0, WEIGHTS);
    const second = generateCollectionCpuTeam(catalog, rootSeed, 0, WEIGHTS);
    expect(second.team).toEqual(first.team);
    expect(first.team.starters).toHaveLength(5);
    expect([...first.team.starters, ...first.team.bench]).toHaveLength(
      COLLECTION_GAME_CPU_ROSTER_SIZE,
    );
    expect(first.team.targetMinutes.reduce((sum, entry) => sum + entry.minutes, 0)).toBe(240);
    expect(first.seedPath).toEqual(['collection', 'cpu-teams', '0']);
    const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
    const roster = [...first.team.starters, ...first.team.bench];
    const players = roster.map((cardId) => byId.get(cardId)?.playerId);
    expect(new Set(players).size).toBe(players.length);
    expect(new Set(roster).size).toBe(roster.length);
    const assignment = assignLineup(
      first.team.starters.map((cardId) => {
        const card = byId.get(cardId);
        if (card === undefined) throw new Error('missing starter');
        return { playerId: card.playerId, positions: card.positions };
      }),
    );
    expect(assignment).not.toBeNull();
    expect(
      validateCollectionActiveTeam(
        first.team,
        (cardId) => byId.get(cardId),
        new Set(catalog.cards.map((card) => card.cardId)),
      ).ok,
    ).toBe(true);
  });

  it('uses distinct seeds per game sequence', () => {
    expect(collectionCpuTeamSeed('0'.repeat(32), 0)).not.toBe(
      collectionCpuTeamSeed('0'.repeat(32), 1),
    );
    expect(collectionGameSeed('0'.repeat(32), 0)).not.toBe(
      collectionCpuTeamSeed('0'.repeat(32), 0),
    );
    expect(collectionGameId('0'.repeat(32), 0)).toMatch(/^game-[0-9a-f]{32}$/);
    expect(collectionGameId('0'.repeat(32), 0)).toBe(collectionGameId('0'.repeat(32), 0));
  });

  it('tracks the frozen rarity weights over 200 seeded teams', () => {
    const catalog = mixedCatalog(600);
    const counts: Record<CollectionRarity, number> = {
      Ember: 0,
      Eruption: 0,
      Apex: 0,
      Titan: 0,
      Eclipse: 0,
      Immortal: 0,
    };
    const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
    const rootSeed = '1'.repeat(32);
    for (let sequence = 0; sequence < 200; sequence += 1) {
      const { team } = generateCollectionCpuTeam(catalog, rootSeed, sequence, WEIGHTS);
      for (const cardId of [...team.starters, ...team.bench]) {
        const rarity = byId.get(cardId)?.rarity;
        if (rarity === undefined) throw new Error('missing cpu card');
        counts[rarity] += 1;
      }
    }
    const total = 200 * COLLECTION_GAME_CPU_ROSTER_SIZE;
    expect(counts.Ember / total).toBeGreaterThan(0.6);
    expect(counts.Ember / total).toBeLessThan(0.8);
    expect(counts.Eruption / total).toBeGreaterThan(0.15);
    expect(counts.Eruption / total).toBeLessThan(0.32);
    expect(counts.Apex).toBeGreaterThan(50);
    expect(counts.Apex).toBeLessThan(200);
    expect(counts.Titan).toBeGreaterThan(5);
    expect(counts.Titan).toBeLessThan(90);
    expect(counts.Eclipse).toBeLessThan(30);
    expect(counts.Immortal).toBeLessThan(5);
  });
});
