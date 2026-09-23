import {
  collectionPreparedGameV2Schema,
  seasonDigestHex,
  type CollectionActiveTeam,
  type CollectionCatalog,
  type CollectionCatalogCard,
  type CollectionDifficultyId,
  type CollectionGameRules,
  type CollectionObjectiveDefinition,
  type CollectionObjectiveId,
  type CollectionPreparedGame,
  type CollectionRarity,
} from '@hoop-rush/data-contracts';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildCollectionDifficultyProfiles,
  buildCollectionFixtureCard,
  buildCollectionFixtureCatalog,
  buildCollectionGameRulesFixture,
} from '@hoop-rush/test-fixtures';
import { initializeCollectionActiveTeam } from './active-team.ts';
import { collectionPreparedInputDigest, prepareCollectionBasicGameV2 } from './game.ts';
import { collectionObjectiveDefinitionsFromRules } from './objectives.ts';
import { collectionGameSeedV2 } from './seeds.ts';

export const V2_HASH = 'a'.repeat(64);
export const V2_ROOT_SEED = '0'.repeat(32);

const RARITIES: CollectionRarity[] = ['Ember', 'Eruption', 'Apex', 'Titan', 'Eclipse', 'Immortal'];
const POSITIONS: Array<CollectionCatalogCard['positions']> = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['C'],
];

export function v2Catalog(size = 24, options: { specials?: boolean } = {}): CollectionCatalog {
  const cards: CollectionCatalogCard[] = [];
  for (let i = 0; i < size; i += 1) {
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
  if (options.specials === true) {
    for (let i = 0; i < size; i += 1) {
      const card = cards[i];
      if (card === undefined) continue;
      cards.push(
        buildCollectionFixtureCard(`${card.playerId}-special`, {
          playerId: card.playerId,
          cardId: `card-${seasonDigestHex(`v2-special\u0000${card.cardId}`)}`,
          family: 'Heat Check',
          positions: card.positions,
          rarity: card.rarity,
          summarySource: {
            overallRating: (card.summarySource?.overallRating ?? 60) + 1,
            offenseRating: (card.summarySource?.overallRating ?? 60) + 1,
            defenseRating: 60,
          },
        }),
      );
    }
  }
  return buildCollectionFixtureCatalog({
    cards,
    sets: [
      {
        setId: 'heat-check-set',
        title: 'V2',
        memberCardIds: [cards[0]?.cardId as string, cards[1]?.cardId as string],
      },
    ],
  });
}

export function v2Rules(): CollectionGameRules {
  return buildCollectionGameRulesFixture();
}

export function v2Definitions(
  rules: CollectionGameRules = v2Rules(),
): CollectionObjectiveDefinition[] {
  return collectionObjectiveDefinitionsFromRules(rules);
}

export function v2Team(catalog: CollectionCatalog, count = 12): CollectionActiveTeam {
  const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
  const owned = catalog.cards.slice(0, count).map((card) => card.cardId);
  return initializeCollectionActiveTeam(owned, (cardId) => byId.get(cardId));
}

export function withSelectedObjective(
  prepared: CollectionPreparedGame,
  objectiveId: CollectionObjectiveId,
  rules: CollectionGameRules = v2Rules(),
): CollectionPreparedGame {
  const definition = v2Definitions(rules).find((entry) => entry.objectiveId === objectiveId);
  if (definition === undefined) throw new Error(`unknown objective ${objectiveId}`);
  const others = prepared.objectives.offers.filter((offer) => offer.objectiveId !== objectiveId);
  const modified = collectionPreparedGameV2Schema.parse({
    ...prepared,
    objectives: {
      ...prepared.objectives,
      offers: [
        {
          objectiveVersion: prepared.objectives.objectiveVersion,
          objectiveId: definition.objectiveId,
          title: definition.title,
          condition: definition.condition,
        },
        ...others.slice(0, 2),
      ],
      selectedObjectiveId: objectiveId,
    },
  });
  return { ...modified, inputDigest: collectionPreparedInputDigest(modified) };
}

export function prepareV2Fixture(input: {
  catalog?: CollectionCatalog;
  team?: CollectionActiveTeam;
  difficultyId?: CollectionDifficultyId;
  objectiveId?: CollectionObjectiveId | null;
  gameSequence?: number;
  rootSeed?: string;
  clearedDifficultyIds?: CollectionDifficultyId[];
  rules?: CollectionGameRules;
}): { prepared: CollectionPreparedGame; catalog: CollectionCatalog } {
  const catalog = input.catalog ?? v2Catalog();
  const team = input.team ?? v2Team(catalog);
  const rules = input.rules ?? v2Rules();
  const difficultyId = input.difficultyId ?? 'pro';
  const profile = buildCollectionDifficultyProfiles().find(
    (candidate) => candidate.difficultyId === difficultyId,
  );
  if (profile === undefined) throw new Error(`missing difficulty ${difficultyId}`);
  const gameSequence = input.gameSequence ?? 0;
  const rootSeed = input.rootSeed ?? V2_ROOT_SEED;
  const prepared = prepareCollectionBasicGameV2({
    collectionId: 'collection-test',
    rootSeed,
    gameSequence,
    ownedCardIds: new Set(catalog.cards.map((card) => card.cardId)),
    team,
    catalog,
    difficulty: profile,
    objectiveDefinitions: v2Definitions(rules),
    selectedObjectiveId: input.objectiveId ?? null,
    clearedDifficultyIds: input.clearedDifficultyIds ?? [],
    profileVersion: DEFAULT_ERA_SIM_PROFILE.profileVersion,
    profileHash: V2_HASH,
    catalogHash: V2_HASH,
    rulesHash: V2_HASH,
  });
  if (prepared.seed !== collectionGameSeedV2(rootSeed, gameSequence)) {
    throw new Error('unexpected seed derivation');
  }
  return { prepared, catalog };
}
