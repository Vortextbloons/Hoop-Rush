import { describe, expect, it } from 'vitest';
import { type CollectionCatalog, type CollectionCatalogCard } from '@hoop-rush/data-contracts';
import {
  buildCollectionFixtureCard,
  buildCollectionFixtureCatalog,
} from '@hoop-rush/test-fixtures';
import {
  allocateDefaultMinutes,
  initializeCollectionActiveTeam,
  validateCollectionActiveTeam,
  type ActiveTeamInput,
} from './active-team.ts';
import { assignLineup } from '../domain/lineup.ts';

const POSITIONS: Array<['PG'] | ['SG'] | ['SF'] | ['PF'] | ['C']> = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['C'],
];

function cardFor(playerId: string, positions: CollectionCatalogCard['positions'], overall: number) {
  return buildCollectionFixtureCard(playerId, {
    playerId: playerId as CollectionCatalogCard['playerId'],
    positions,
    rarity: overall < 72 ? 'Ember' : 'Apex',
    summarySource: { overallRating: overall, offenseRating: overall, defenseRating: overall },
  });
}

function catalogOf(size: number): {
  catalog: CollectionCatalog;
  byId: Map<string, CollectionCatalogCard>;
} {
  const cards: CollectionCatalogCard[] = [];
  for (let i = 0; i < size; i += 1) {
    const positions = POSITIONS[i % POSITIONS.length] ?? ['PG'];
    cards.push(cardFor(`strength-${String(i).padStart(2, '0')}`, positions, 60 + (i % 30)));
  }
  const catalog = buildCollectionFixtureCatalog({
    cards,
    sets: [
      {
        setId: 'sharpshooter-set',
        title: 'Sizes',
        memberCardIds: [cards[0]?.cardId as string, cards[1]?.cardId as string],
      },
    ],
  });
  return { catalog, byId: new Map(cards.map((card) => [card.cardId, card])) };
}

describe('collection active teams', () => {
  for (const size of [5, 6, 7, 8, 9, 10, 11, 12]) {
    it(`initializes a legal default team of ${String(size)}`, () => {
      const { byId } = catalogOf(size);
      const owned = [...byId.keys()];
      const team = initializeCollectionActiveTeam(owned, (cardId) => byId.get(cardId));
      expect(team.starters).toHaveLength(5);
      expect([...team.starters, ...team.bench]).toHaveLength(size);
      expect(team.targetMinutes.reduce((sum, entry) => sum + entry.minutes, 0)).toBe(240);
      const ownedSet = new Set(owned);
      const check = validateCollectionActiveTeam(team, (cardId) => byId.get(cardId), ownedSet);
      expect(check.issues).toEqual([]);
      expect(check.ok).toBe(true);
      const assignment = assignLineup(
        team.starters.map((cardId) => {
          const card = byId.get(cardId);
          if (card === undefined) throw new Error('missing starter');
          return { playerId: card.playerId, positions: card.positions };
        }),
      );
      expect(assignment).not.toBeNull();
    });
  }

  it('gives five-card teams 48 minutes each', () => {
    const { byId } = catalogOf(5);
    const team = initializeCollectionActiveTeam([...byId.keys()], (cardId) => byId.get(cardId));
    expect(team.targetMinutes.map((entry) => entry.minutes)).toEqual([48, 48, 48, 48, 48]);
  });

  it('apportions starter-heavy minutes deterministically', () => {
    const first = allocateDefaultMinutes([
      { cardId: 'a', starter: true },
      { cardId: 'b', starter: true },
      { cardId: 'c', starter: true },
      { cardId: 'd', starter: true },
      { cardId: 'e', starter: true },
      { cardId: 'f', starter: false },
      { cardId: 'g', starter: false },
    ]);
    const second = allocateDefaultMinutes([
      { cardId: 'a', starter: true },
      { cardId: 'b', starter: true },
      { cardId: 'c', starter: true },
      { cardId: 'd', starter: true },
      { cardId: 'e', starter: true },
      { cardId: 'f', starter: false },
      { cardId: 'g', starter: false },
    ]);
    expect(first).toEqual(second);
    expect(first.reduce((sum, entry) => sum + entry.minutes, 0)).toBe(240);
    const starterMinutes = first.filter((entry) => entry.cardId !== 'f' && entry.cardId !== 'g');
    const benchMinutes = first.filter((entry) => entry.cardId === 'f' || entry.cardId === 'g');
    expect(Math.min(...starterMinutes.map((entry) => entry.minutes))).toBeGreaterThanOrEqual(
      Math.max(...benchMinutes.map((entry) => entry.minutes)),
    );
  });

  it('rejects every invalid team shape with a typed code', () => {
    const { byId } = catalogOf(12);
    const owned = new Set(byId.keys());
    const good = initializeCollectionActiveTeam([...owned], (cardId) => byId.get(cardId));
    const checkOf = (team: ActiveTeamInput) =>
      validateCollectionActiveTeam(team, (cardId) => byId.get(cardId), owned);

    expect(checkOf({ ...good, starters: good.starters.slice(0, 4) }).issues[0]?.code).toBe(
      'illegal-starters',
    );
    expect(
      checkOf({ ...good, bench: [...good.bench, ...good.bench, ...good.bench] }).issues.map(
        (issue) => issue.code,
      ),
    ).toContain('too-many-cards');
    const shortRoster = [...good.starters, ...good.bench].slice(0, 4);
    expect(
      checkOf({
        starters: shortRoster.slice(0, 4),
        bench: [],
        targetMinutes: shortRoster.map((cardId) => ({ cardId, minutes: 48 })),
      }).issues.map((issue) => issue.code),
    ).toContain('too-few-cards');
    expect(
      checkOf({ ...good, starters: [...good.starters.slice(1), good.starters[0] as string] }).ok,
    ).toBe(true);
    expect(
      checkOf({
        ...good,
        starters: [good.bench[0] as string, ...good.starters.slice(1)],
      }).issues.map((issue) => issue.code),
    ).toContain('duplicate-card');
    expect(
      checkOf({
        ...good,
        targetMinutes: good.targetMinutes.map((entry) => ({ ...entry, minutes: 10 })),
      }).issues.map((issue) => issue.code),
    ).toContain('invalid-minutes');
    expect(
      checkOf({
        ...good,
        targetMinutes: good.targetMinutes.map((entry, index) =>
          index === 0 ? { ...entry, minutes: 0 } : entry,
        ),
      }).issues.map((issue) => issue.code),
    ).toContain('invalid-minutes');
    const unknownId = `card-${'f'.repeat(32)}`;
    expect(
      checkOf({
        ...good,
        bench: [...good.bench.slice(1), unknownId],
        targetMinutes: [
          ...good.targetMinutes.filter((entry) => entry.cardId !== good.bench[0]),
          { cardId: unknownId, minutes: 5 },
        ],
      }).issues.map((issue) => issue.code),
    ).toContain('unknown-card');
    const unownedId = `card-${'e'.repeat(32)}`;
    const unownedCard = cardFor('outsider', ['PG'], 60);
    const resolveWithOutsider = (cardId: string) =>
      cardId === unownedId ? { ...unownedCard, cardId: unownedId } : byId.get(cardId);
    expect(
      validateCollectionActiveTeam(
        {
          ...good,
          bench: [...good.bench.slice(1), unownedId],
          targetMinutes: [
            ...good.targetMinutes.filter((entry) => entry.cardId !== good.bench[0]),
            { cardId: unownedId, minutes: 5 },
          ],
        },
        resolveWithOutsider,
        owned,
      ).issues.map((issue) => issue.code),
    ).toContain('unowned-card');
  });

  it('rejects duplicate canonical players and illegal starter groups', () => {
    const base = cardFor('same-player', ['PG'], 80);
    const alt = buildCollectionFixtureCard('same-player-alt', {
      playerId: 'same-player' as CollectionCatalogCard['playerId'],
      positions: ['SG'],
      summarySource: { overallRating: 70, offenseRating: 70, defenseRating: 70 },
    });
    const others = [
      cardFor('p-sf', ['SF'], 60),
      cardFor('p-pf', ['PF'], 60),
      cardFor('p-c', ['C'], 60),
      cardFor('p-sg', ['SG'], 60),
    ];
    const cards = [base, alt, ...others];
    const byId = new Map(cards.map((card) => [card.cardId, card]));
    const owned = new Set(byId.keys());
    const dupTeam = {
      starters: [
        base.cardId,
        alt.cardId,
        others[0]?.cardId as string,
        others[1]?.cardId as string,
        others[2]?.cardId as string,
      ],
      bench: [others[3]?.cardId as string],
      targetMinutes: [
        { cardId: base.cardId, minutes: 40 },
        { cardId: alt.cardId, minutes: 40 },
        { cardId: others[0]?.cardId as string, minutes: 40 },
        { cardId: others[1]?.cardId as string, minutes: 40 },
        { cardId: others[2]?.cardId as string, minutes: 40 },
        { cardId: others[3]?.cardId as string, minutes: 40 },
      ],
    };
    expect(
      validateCollectionActiveTeam(dupTeam, (cardId) => byId.get(cardId), owned).issues.map(
        (issue) => issue.code,
      ),
    ).toContain('duplicate-player');

    const guards = [0, 1, 2, 3, 4].map((i) => cardFor(`guard-${String(i)}`, ['PG'], 60));
    const guardById = new Map(guards.map((card) => [card.cardId, card]));
    const guardOwned = new Set(guardById.keys());
    expect(
      validateCollectionActiveTeam(
        {
          starters: guards.map((card) => card.cardId),
          bench: [],
          targetMinutes: guards.map((card) => ({ cardId: card.cardId, minutes: 48 })),
        },
        (cardId) => guardById.get(cardId),
        guardOwned,
      ).issues.map((issue) => issue.code),
    ).toContain('illegal-starters');
  });

  it('initializes deterministically over the same ownership', () => {
    const { byId } = catalogOf(12);
    const owned = [...byId.keys()];
    const first = initializeCollectionActiveTeam(owned, (cardId) => byId.get(cardId));
    const second = initializeCollectionActiveTeam([...owned].reverse(), (cardId) =>
      byId.get(cardId),
    );
    expect(second).toEqual(first);
  });

  it('keeps the M4.1 fixture five playable', () => {
    const catalog = buildCollectionFixtureCatalog();
    const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
    const owned = catalog.cards.map((card) => card.cardId);
    const team = initializeCollectionActiveTeam(owned, (cardId) => byId.get(cardId));
    expect(team.starters).toHaveLength(5);
    expect(
      validateCollectionActiveTeam(team, (cardId) => byId.get(cardId), new Set(owned)).ok,
    ).toBe(true);
  });
});
