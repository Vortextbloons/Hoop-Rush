import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import {
  buildDraftDuelCatalogSource,
  collectionCatalogSchema,
  seedSchema,
  playerVersionId,
  parsePool,
  seasonDraftCatalogSchema,
  type DraftDuelFairness,
  type DraftDuelParticipantId,
  type Seed,
} from '@hoop-rush/data-contracts';
import {
  applyDraftDuelPick,
  buildDraftDuelCatalog,
  createDraftDuelDraft,
  draftDuelCurrentPicker,
  draftDuelFairBandTokens,
  draftDuelLegalPicks,
  draftDuelRoster,
  isDraftDuelComplete,
} from '@hoop-rush/engine';
import type { DraftDuelDraft } from '@hoop-rush/data-contracts';
import { seedFromString } from '@hoop-rush/test-fixtures';

const catalogPath = new URL(
  '../../../apps/web/static/data/collection/catalog.json',
  import.meta.url,
);
const collection = collectionCatalogSchema.parse(
  JSON.parse(readFileSync(catalogPath, 'utf8')) as unknown,
);
const catalog = buildDraftDuelCatalog(buildDraftDuelCatalogSource(collection));

function rooted(seedText: string): Seed {
  return seedSchema.parse(seedFromString(seedText));
}
function completeDraft(
  seedText: string,
  fairness: DraftDuelFairness,
  strategy: 'first' | 'last',
): DraftDuelDraft {
  let state = createDraftDuelDraft({ rootSeed: rooted(seedText), fairness, catalog });
  while (!isDraftDuelComplete(state)) {
    const offers = draftDuelLegalPicks(state, catalog);
    const legal = offers.filter((offer) => offer.available);
    expect(legal.length).toBeGreaterThan(0);
    const offer = strategy === 'first' ? legal[0] : legal[legal.length - 1];
    if (!offer) throw new Error('no legal offer');
    state = applyDraftDuelPick(state, catalog, {
      participantId: draftDuelCurrentPicker(state),
      playerId: offer.card.playerId,
      playerVersionId: offer.card.playerVersionId,
    });
  }
  return state;
}
function rosterPlayerIds(participantId: DraftDuelParticipantId, state: DraftDuelDraft) {
  return draftDuelRoster(state, catalog, participantId).slots.map((slot) => slot.card.playerId);
}
function offerBandHistogram(
  state: DraftDuelDraft,
  participantId: DraftDuelParticipantId,
): number[] {
  const counts = new Array<number>(10).fill(0);
  for (const round of state.rounds) {
    for (const card of round.offers[participantId]) {
      counts[card.bandIndex] = (counts[card.bandIndex] ?? 0) + 1;
    }
  }
  return counts;
}
describe('draft duel production catalog integration', () => {
  it('uses the current pool peaks and ratings in the draft and base player catalogs', () => {
    const manifestUrl = new URL('../../../apps/web/static/data/manifest.json', import.meta.url);
    const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8')) as {
      pools: Array<{ url: string }>;
      draftCatalog: { url: string };
    };
    const draft = seasonDraftCatalogSchema.parse(
      JSON.parse(readFileSync(new URL(manifest.draftCatalog.url, manifestUrl), 'utf8')),
    );
    const candidates = new Map(
      draft.candidates.map((candidate) => [candidate.playerVersionId, candidate]),
    );
    const cards = new Map(
      collection.cards
        .filter((card) => card.family === 'Base')
        .map((card) => [card.sourcePlayerVersionId, card]),
    );
    for (const entry of manifest.pools) {
      const pool = parsePool(JSON.parse(readFileSync(new URL(entry.url, manifestUrl), 'utf8')));
      for (const player of pool.players) {
        const id = playerVersionId(
          player.playerId,
          player.franchiseId,
          player.eraId,
          player.seasonKey,
        );
        const candidate = candidates.get(id);
        expect(candidate?.summaryRatings).toEqual(player.summaryRatings);
        expect(candidate?.detailedRatings).toEqual(player.detailedRatings);
        expect(cards.get(id)?.summarySource).toEqual(player.summaryRatings);
      }
    }
  });

  it('loads exactly the validated base catalog', () => {
    expect(catalog.entries.length).toBe(7943);
    expect(catalog.playerIds.length).toBe(2998);
    expect(new Set(catalog.entries.map((entry) => entry.card.cardId)).size).toBe(7943);
  });
  it('completes every draft path across seeds, fairness, and pick strategies', () => {
    for (const seed of ['prod-a', 'prod-b', 'prod-c']) {
      for (const fairness of ['fair', 'unfair'] as const) {
        for (const strategy of ['first', 'last'] as const) {
          const state = completeDraft(seed, fairness, strategy);
          expect(state.status).toBe('complete');
          expect(state.pickOrdinal).toBe(10);
          const p1 = rosterPlayerIds('p1', state);
          const p2 = rosterPlayerIds('p2', state);
          expect(p1.length).toBe(5);
          expect(p2.length).toBe(5);
          expect(new Set([...p1, ...p2]).size).toBe(10);
          expect(draftDuelRoster(state, catalog, 'p1').slots.length).toBe(5);
          expect(draftDuelRoster(state, catalog, 'p2').slots.length).toBe(5);
        }
      }
    }
  }, 120000);
  it('gives both players identical 40-offer band histograms in fair mode', () => {
    for (const seed of ['prod-fair-a', 'prod-fair-b']) {
      const state = completeDraft(seed, 'fair', 'first');
      const p1 = offerBandHistogram(state, 'p1');
      const p2 = offerBandHistogram(state, 'p2');
      expect(p1).toEqual(p2);
      expect(p1.reduce((sum, count) => sum + count, 0)).toBe(40);
      const tokens = draftDuelFairBandTokens(rooted(seed), 0);
      expect(tokens.length).toBe(40);
    }
  }, 120000);
  it('offers eight distinct known players per pool', () => {
    const state = completeDraft('prod-pools', 'unfair', 'first');
    for (const round of state.rounds) {
      for (const participantId of ['p1', 'p2'] as const) {
        const pool = round.offers[participantId];
        expect(pool.length).toBe(8);
        expect(new Set(pool.map((card) => card.playerId)).size).toBe(8);
        for (const card of pool) {
          expect(catalog.byVersionId.has(card.playerVersionId)).toBe(true);
        }
      }
    }
  }, 60000);
});
