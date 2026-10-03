import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collectionCatalogSchema, seedSchema } from '@hoop-rush/data-contracts';
import {
  checkGameResult,
  createEngineContext,
  gameResultDigest,
  resolveCollectionCard,
  simulateGame,
  toCollectionSimulationPlayer,
} from '@hoop-rush/engine';
import {
  buildGameSimulationInput,
  buildLegalSimulationTeam,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import { collectionCardArtOf } from '../../../apps/web/src/lib/collection/collection-card-art.ts';

const catalog = collectionCatalogSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL('../../../apps/web/static/data/collection/catalog.json', import.meta.url),
      ),
      'utf8',
    ),
  ),
);
const specials = catalog.cards.filter((card) => card.family === 'Arm Guard');
const context = createEngineContext();

describe('Arm Guard shipped collection', () => {
  it('ships seven distinct illustrated players in the collectible set and Spotlight pool', () => {
    expect(specials).toHaveLength(7);
    expect(new Set(specials.map((card) => card.playerId)).size).toBe(7);
    expect(
      catalog.sets
        .find((set) => set.setId === 'arm-guard-set')
        ?.memberCardIds.slice()
        .sort(),
    ).toEqual(specials.map((card) => card.cardId).sort());
    expect(catalog.packs.find((pack) => pack.packId === 'spotlight')?.eligibleScope).toBe(
      'specials-only',
    );
    for (const card of specials) {
      const art = collectionCardArtOf(card);
      expect(art).toBeTruthy();
      if (art === null) throw new Error(`Missing artwork for ${card.displayName}`);
      expect(
        readFileSync(fileURLToPath(new URL(`../../../apps/web/static${art}`, import.meta.url)))
          .length,
      ).toBeGreaterThan(1000);
    }
  });

  it.each(specials)(
    '$displayName improves defense and overall without changing offensive ratings',
    (card) => {
      const base = catalog.cards.find(
        (candidate) =>
          candidate.family === 'Base' &&
          candidate.sourcePlayerVersionId === card.sourcePlayerVersionId,
      );
      if (!base?.summarySource || !card.summarySource)
        throw new Error(`Missing source ratings for ${card.displayName}`);
      const resolved = resolveCollectionCard(card, card);
      expect(card.summarySource.overallRating).toBeGreaterThan(base.summarySource.overallRating);
      expect(
        card.summarySource.defenseRating - base.summarySource.defenseRating,
      ).toBeGreaterThanOrEqual(20);
      expect(card.summarySource.offenseRating).toBe(base.summarySource.offenseRating);
      for (const key of [
        'insideScoring',
        'threePoint',
        'ballHandling',
        'passing',
        'offensiveIq',
      ] as const) {
        expect(resolved.ratings[key]).toBe(base.detailedRatings[key]);
      }
      expect(
        resolved.ratings.perimeterDefense - base.detailedRatings.perimeterDefense,
      ).toBeGreaterThanOrEqual(25);
      expect(
        resolved.ratings.defensiveIq - base.detailedRatings.defensiveIq,
      ).toBeGreaterThanOrEqual(20);
    },
  );

  it.each(specials)(
    '$displayName lowers opponent efficiency across 512 matched seeds with exact accounting and replay',
    (card) => {
      const base = catalog.cards.find(
        (candidate) =>
          candidate.family === 'Base' &&
          candidate.sourcePlayerVersionId === card.sourcePlayerVersionId,
      );
      if (base === undefined) throw new Error(`Missing source card for ${card.displayName}`);
      const totals = {
        basePoints: 0,
        specialPoints: 0,
        basePossessions: 0,
        specialPossessions: 0,
        baseTurnovers: 0,
        specialTurnovers: 0,
      };
      for (let i = 0; i < 512; i += 1) {
        const seed = seedSchema.parse(
          seedFromString(`arm-guard/sensitivity/${card.playerId}/${String(i)}`),
        );
        for (const [variant, candidate] of [
          ['base', base],
          ['special', card],
        ] as const) {
          const fixture = buildLegalSimulationTeam({ teamId: 'arm-guard-team' });
          const player = toCollectionSimulationPlayer(
            resolveCollectionCard(candidate, candidate),
            candidate,
          );
          const team = { ...fixture, players: [player, ...fixture.players.slice(1)] };
          const opponent = buildLegalSimulationTeam({ teamId: 'opponent' });
          const atHome = i % 2 === 0;
          const input = buildGameSimulationInput({
            seed,
            home: atHome ? team : opponent,
            away: atHome ? opponent : team,
          });
          const result = simulateGame(input, context);
          expect(checkGameResult(result)).toEqual([]);
          if (i === 0)
            expect(gameResultDigest(simulateGame(input, context))).toBe(gameResultDigest(result));
          const opposing = atHome ? result.away : result.home;
          totals[`${variant}Points`] += opposing.box.points;
          totals[`${variant}Possessions`] += opposing.box.possessions;
          totals[`${variant}Turnovers`] += opposing.box.turnovers;
        }
      }
      const baseEfficiency = (totals.basePoints / totals.basePossessions) * 100;
      const specialEfficiency = (totals.specialPoints / totals.specialPossessions) * 100;
      console.info(card.displayName, {
        baseEfficiency,
        specialEfficiency,
        opponentTurnovers: [totals.baseTurnovers / 512, totals.specialTurnovers / 512],
      });
      expect(specialEfficiency).toBeLessThan(baseEfficiency - 1);
      expect(totals.specialTurnovers).toBeGreaterThan(totals.baseTurnovers);
    },
    60000,
  );
});
