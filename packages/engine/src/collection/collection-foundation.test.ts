import { describe, expect, it } from 'vitest';
import {
  collectionCatalogSchema,
  collectionCommandSchema,
  collectionStateSchema,
} from '@hoop-rush/data-contracts';
import {
  buildCollectionFixtureCatalog,
  buildCollectionFixtureCard,
} from '@hoop-rush/test-fixtures';
import {
  auditCollectionState,
  collectionCardId,
  collectionNamespaceSeed,
  collectionStateDigest,
  resolveCollectionCard,
  validateCollectionPlayableFive,
  validateCollectionTeamFoundation,
} from '../index.ts';

describe('collection foundation', () => {
  it('round-trips catalog, state, and commands', () => {
    const catalog = buildCollectionFixtureCatalog();
    expect(collectionCatalogSchema.parse(catalog)).toEqual(catalog);
    const state = collectionStateSchema.parse({
      schemaVersion: 1,
      collectionVersion: 'collection-v1',
      catalogVersion: 'collection-catalog-v1',
      economyVersion: 'collection-economy-v1',
      collectionId: 'collection-1',
      rootSeed: '0'.repeat(32),
      revision: 0,
      digest: '0'.repeat(32),
      claimedWelcome: false,
      owned: [],
      balances: { Coins: 0, Exchange: 0 },
      nextPullSequence: 0,
    });
    expect(state.collectionId).toBe('collection-1');
    const command = collectionCommandSchema.parse({
      schemaVersion: 1,
      commandVersion: 'collection-command-v1',
      commandId: 'cmd-1',
      collectionId: 'collection-1',
      expectedRevision: 0,
      expectedDigest: '0'.repeat(32),
      command: 'claim-welcome',
      acquiredAtIso: '2026-01-01T00:00:00.000Z',
    });
    expect(command.command).toBe('claim-welcome');
  });

  it('rejects malformed catalog content', () => {
    const catalog = buildCollectionFixtureCatalog();
    const cards = [...catalog.cards];
    const first = cards[0];
    if (first === undefined) throw new Error('fixture missing card');
    cards.push(first);
    expect(collectionCatalogSchema.safeParse({ ...catalog, cards }).success).toBe(false);
    const sets = [{ setId: 'sharpshooter-set', title: 'Bad', memberCardIds: [] }];
    expect(collectionCatalogSchema.safeParse({ ...catalog, sets }).success).toBe(false);
  });

  it('derives stable card ids and seeds', () => {
    expect(collectionCardId('base', 'pv-0'.padEnd(35, '0'), 'Base')).toBe(
      collectionCardId('base', 'pv-0'.padEnd(35, '0'), 'Base'),
    );
    const root = 'a'.repeat(32);
    expect(collectionNamespaceSeed(root, 'starter')).toBe(collectionNamespaceSeed(root, 'starter'));
  });

  it('applies special overlays to engine inputs only', () => {
    const base = buildCollectionFixtureCard('fixture-pg');
    const special = {
      ...base,
      cardId: collectionCardId('special', base.sourcePlayerVersionId, 'Sharpshooter'),
      family: 'Sharpshooter',
      ratingOverlay: { threePoint: 20, freeThrow: 10 },
    } as typeof base;
    const resolvedBase = resolveCollectionCard(base, base);
    const resolvedSpecial = resolveCollectionCard(special, base);
    expect(resolvedSpecial.ratings.threePoint).toBe(
      Math.min(100, resolvedBase.ratings.threePoint + 20),
    );
    expect(resolvedSpecial.ratings.freeThrow).toBe(
      Math.min(100, resolvedBase.ratings.freeThrow + 10),
    );
    expect(resolvedSpecial.ratings.insideScoring).toBe(resolvedBase.ratings.insideScoring);
    expect(base.detailedRatings.threePoint).toBe(resolvedBase.ratings.threePoint);
  });

  it('is stable despite input catalog ordering', () => {
    const catalog = buildCollectionFixtureCatalog();
    const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
    const forward = [...catalog.cards].sort((a, b) => (a.cardId < b.cardId ? -1 : 1));
    const reverse = [...forward].reverse();
    const digestOf = (cards: typeof forward) =>
      collectionStateDigest({
        collectionId: 'c',
        revision: 0,
        claimedWelcome: false,
        ownedCardIds: cards.map((card) => card.cardId),
        balances: { Coins: 0, Exchange: 0 },
        nextPullSequence: 0,
        catalogVersion: 'collection-catalog-v1',
        economyVersion: 'collection-economy-v1',
      });
    expect(digestOf(forward)).toBe(digestOf(reverse));
    expect(byId.size).toBe(catalog.cards.length);
  });

  it('validates team foundations and playable fives', () => {
    const catalog = buildCollectionFixtureCatalog();
    const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
    const resolve = (cardId: string) => byId.get(cardId);
    const five = catalog.cards.slice(0, 5).map((card) => card.cardId);
    expect(validateCollectionTeamFoundation(five, resolve).ok).toBe(true);
    expect(validateCollectionPlayableFive(five, resolve).ok).toBe(true);
    const dupPlayer = [five[0] ?? '', five[0] ?? ''];
    expect(validateCollectionTeamFoundation(dupPlayer, resolve).ok).toBe(false);
    expect(validateCollectionTeamFoundation([...five, ...five, ...five], resolve).ok).toBe(false);
  });

  it('audits empty state cleanly', () => {
    const state = collectionStateSchema.parse({
      schemaVersion: 1,
      collectionVersion: 'collection-v1',
      catalogVersion: 'collection-catalog-v1',
      economyVersion: 'collection-economy-v1',
      collectionId: 'collection-1',
      rootSeed: '0'.repeat(32),
      revision: 0,
      digest: '0'.repeat(32),
      claimedWelcome: false,
      owned: [],
      balances: { Coins: 0, Exchange: 0 },
      nextPullSequence: 0,
    });
    const digest = collectionStateDigest({
      collectionId: state.collectionId,
      revision: state.revision,
      claimedWelcome: state.claimedWelcome,
      ownedCardIds: [],
      balances: state.balances,
      nextPullSequence: state.nextPullSequence,
      catalogVersion: state.catalogVersion,
      economyVersion: state.economyVersion,
    });
    const fixed = { ...state, digest };
    expect(auditCollectionState(fixed, [], [])).toEqual([]);
  });
});
