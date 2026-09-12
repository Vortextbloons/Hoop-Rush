import {
  collectionObjectiveDefinitionSchema,
  collectionObjectiveEvaluationSchema,
  collectionObjectiveOfferSchema,
  seasonDigestHex,
  type CollectionActiveTeam,
  type CollectionDifficultyId,
  type CollectionGameResult,
  type CollectionGameRules,
  type CollectionObjectiveCondition,
  type CollectionObjectiveDefinition,
  type CollectionObjectiveEvaluation,
  type CollectionObjectiveFacts,
  type CollectionObjectiveId,
  type CollectionPreparedGameV2,
} from '@hoop-rush/data-contracts';
import { CollectionCommandError } from './packs.ts';
import { collectionObjectiveOfferSeed } from './seeds.ts';

interface ObjectiveTemplate {
  objectiveId: CollectionObjectiveId;
  title: string;
  condition: (threshold: number) => CollectionObjectiveCondition;
  minimumBenchPlayers: number;
  minimumPlannedBenchMinutes: number;
}

export const COLLECTION_OBJECTIVE_TEMPLATES: readonly ObjectiveTemplate[] = [
  {
    objectiveId: 'obj-three-barrage-v1',
    title: 'Three barrage',
    condition: (threshold) => ({ kind: 'player-team-three-pointers-made', threshold }),
    minimumBenchPlayers: 0,
    minimumPlannedBenchMinutes: 0,
  },
  {
    objectiveId: 'obj-lock-score-v1',
    title: 'Lock the score',
    condition: (threshold) => ({ kind: 'cpu-team-points-at-most', threshold }),
    minimumBenchPlayers: 0,
    minimumPlannedBenchMinutes: 0,
  },
  {
    objectiveId: 'obj-bench-spark-v1',
    title: 'Bench spark',
    condition: (threshold) => ({ kind: 'player-bench-points-at-least', threshold }),
    minimumBenchPlayers: 1,
    minimumPlannedBenchMinutes: 48,
  },
  {
    objectiveId: 'obj-ball-pressure-v1',
    title: 'Ball pressure',
    condition: (threshold) => ({ kind: 'cpu-team-turnovers-at-least', threshold }),
    minimumBenchPlayers: 0,
    minimumPlannedBenchMinutes: 0,
  },
  {
    objectiveId: 'obj-own-glass-v1',
    title: 'Own the glass',
    condition: (threshold) => ({ kind: 'player-rebound-margin-at-least', threshold }),
    minimumBenchPlayers: 0,
    minimumPlannedBenchMinutes: 0,
  },
  {
    objectiveId: 'obj-box-score-star-v1',
    title: 'Box-score star',
    condition: (threshold) => ({ kind: 'player-double-stat', threshold, categories: 2 }),
    minimumBenchPlayers: 0,
    minimumPlannedBenchMinutes: 0,
  },
];

export function collectionObjectiveDefinitionsFromRules(
  rules: CollectionGameRules,
): CollectionObjectiveDefinition[] {
  const thresholds = new Map(rules.objectives.map((entry) => [entry.objectiveId, entry]));
  return COLLECTION_OBJECTIVE_TEMPLATES.map((template) => {
    const rulesEntry = thresholds.get(template.objectiveId);
    if (rulesEntry === undefined) {
      throw new CollectionCommandError(
        'missing-content',
        `objective rules are missing ${template.objectiveId}`,
      );
    }
    return collectionObjectiveDefinitionSchema.parse({
      objectiveVersion: 'collection-objectives-v1',
      objectiveId: template.objectiveId,
      title: template.title,
      condition: template.condition(rulesEntry.threshold),
      feasibility: {
        minimumBenchPlayers: template.minimumBenchPlayers,
        minimumPlannedBenchMinutes: template.minimumPlannedBenchMinutes,
      },
    });
  });
}

export function collectionObjectiveFeasibilityFactsOf(
  team: CollectionActiveTeam,
): CollectionObjectiveFacts['feasibility'] {
  const benchIds = new Set(team.bench);
  const plannedBenchMinutes = team.targetMinutes
    .filter((entry) => benchIds.has(entry.cardId))
    .reduce((sum, entry) => sum + entry.minutes, 0);
  return {
    rosterSize: team.starters.length + team.bench.length,
    benchPlayerCount: team.bench.length,
    plannedBenchMinutes,
  };
}

function objectiveRankingKey(seed: string, objectiveId: string): string {
  return seasonDigestHex([seed, objectiveId].join('\u0000'));
}

export function buildCollectionObjectiveFacts(input: {
  definitions: readonly CollectionObjectiveDefinition[];
  rootSeed: string;
  difficultyId: CollectionDifficultyId;
  gameSequence: number;
  team: CollectionActiveTeam;
  selectedObjectiveId: CollectionObjectiveId | null;
}): CollectionObjectiveFacts {
  const feasibility = collectionObjectiveFeasibilityFactsOf(input.team);
  const feasible = input.definitions.filter(
    (definition) =>
      feasibility.benchPlayerCount >= definition.feasibility.minimumBenchPlayers &&
      feasibility.plannedBenchMinutes >= definition.feasibility.minimumPlannedBenchMinutes,
  );
  if (feasible.length < 3) {
    throw new CollectionCommandError(
      'infeasible-objective',
      `only ${String(feasible.length)} objective definitions are feasible`,
    );
  }
  const seed = collectionObjectiveOfferSeed(input.rootSeed, input.difficultyId, input.gameSequence);
  const ranked = [...feasible].sort((left, right) => {
    const leftKey = objectiveRankingKey(seed, left.objectiveId);
    const rightKey = objectiveRankingKey(seed, right.objectiveId);
    if (leftKey < rightKey) return -1;
    if (leftKey > rightKey) return 1;
    return 0;
  });
  const offers = ranked.slice(0, 3).map((definition) =>
    collectionObjectiveOfferSchema.parse({
      objectiveVersion: definition.objectiveVersion,
      objectiveId: definition.objectiveId,
      title: definition.title,
      condition: definition.condition,
    }),
  );
  if (input.selectedObjectiveId !== null) {
    const declared = input.definitions.find(
      (definition) => definition.objectiveId === input.selectedObjectiveId,
    );
    if (declared === undefined) {
      throw new CollectionCommandError(
        'objective-not-offered',
        `unknown objective ${input.selectedObjectiveId}`,
      );
    }
    if (!feasible.includes(declared)) {
      throw new CollectionCommandError(
        'infeasible-objective',
        `objective ${input.selectedObjectiveId} is not feasible for this roster`,
      );
    }
    if (!offers.some((offer) => offer.objectiveId === input.selectedObjectiveId)) {
      throw new CollectionCommandError(
        'objective-not-offered',
        `objective ${input.selectedObjectiveId} is not in the seeded offer set`,
      );
    }
  }
  return {
    objectiveVersion: 'collection-objectives-v1',
    seedPath: ['collection', 'objectives', input.difficultyId, String(input.gameSequence)],
    offers,
    selectedObjectiveId: input.selectedObjectiveId,
    feasibility,
  };
}

type CompletedResult = Extract<CollectionGameResult, { outcome: 'completed' }>;
type CompletedSide = CompletedResult['home'];
type CompletedPlayer = CompletedSide['players'][number];

function totalRebounds(side: CompletedSide): number {
  return side.box.rebounds.offensive + side.box.rebounds.defensive;
}

type DoubleStatCategory = 'points' | 'totalRebounds' | 'assists' | 'steals' | 'blocks';

function doubleStatValue(player: CompletedPlayer, category: DoubleStatCategory): number {
  switch (category) {
    case 'points':
      return player.points;
    case 'totalRebounds':
      return player.rebounds.total;
    case 'assists':
      return player.assists;
    case 'steals':
      return player.steals;
    case 'blocks':
      return player.blocks;
  }
}

function playerCategories(
  player: CompletedPlayer,
  threshold: number,
  order: readonly DoubleStatCategory[],
): Array<{ category: DoubleStatCategory; value: number }> {
  return order
    .map((category) => ({ category, value: doubleStatValue(player, category) }))
    .filter((entry) => entry.value >= threshold);
}

const DOUBLE_STAT_ORDER = ['points', 'totalRebounds', 'assists', 'steals', 'blocks'] as const;

interface EvaluatedObjective {
  condition: CollectionObjectiveCondition;
  threshold: number;
  actualValue: number;
  success: boolean;
  supportingCardIds: string[];
  supportingFacts: Array<{
    cardId: string;
    category: DoubleStatCategory;
    value: number;
  }>;
  explanation: string;
}

function evaluateCondition(
  condition: CollectionObjectiveCondition,
  result: Extract<CollectionGameResult, { outcome: 'completed' }>,
  prepared: CollectionPreparedGameV2,
): EvaluatedObjective {
  const home = result.home;
  const away = result.away;
  switch (condition.kind) {
    case 'player-team-three-pointers-made': {
      const actual = home.box.threes.made;
      const supportingCardIds = home.players
        .filter((player) => player.threes.made > 0)
        .map((player) => player.cardId)
        .sort();
      return {
        condition,
        threshold: condition.threshold,
        actualValue: actual,
        success: actual >= condition.threshold,
        supportingCardIds,
        supportingFacts: [],
        explanation: `Your team made ${String(actual)} three-pointers (need ${String(condition.threshold)}).`,
      };
    }
    case 'cpu-team-points-at-most': {
      const actual = away.score;
      return {
        condition,
        threshold: condition.threshold,
        actualValue: actual,
        success: actual <= condition.threshold,
        supportingCardIds: [],
        supportingFacts: [],
        explanation: `The CPU scored ${String(actual)} points (limit ${String(condition.threshold)}).`,
      };
    }
    case 'player-bench-points-at-least': {
      const benchIds = new Set(prepared.playerTeam.bench);
      const benchPlayers = home.players.filter((player) => benchIds.has(player.cardId));
      const actual = benchPlayers.reduce((sum, player) => sum + player.points, 0);
      return {
        condition,
        threshold: condition.threshold,
        actualValue: actual,
        success: actual >= condition.threshold,
        supportingCardIds: benchPlayers
          .filter((player) => player.points > 0)
          .map((player) => player.cardId)
          .sort(),
        supportingFacts: benchPlayers
          .filter((player) => player.points > 0)
          .map((player) => ({
            cardId: player.cardId,
            category: 'points' as const,
            value: player.points,
          }))
          .sort((left, right) => (left.cardId < right.cardId ? -1 : 1)),
        explanation: `Your bench scored ${String(actual)} points (need ${String(condition.threshold)}).`,
      };
    }
    case 'cpu-team-turnovers-at-least': {
      const actual = away.box.turnovers;
      return {
        condition,
        threshold: condition.threshold,
        actualValue: actual,
        success: actual >= condition.threshold,
        supportingCardIds: [],
        supportingFacts: [],
        explanation: `The CPU committed ${String(actual)} turnovers (need ${String(condition.threshold)}).`,
      };
    }
    case 'player-rebound-margin-at-least': {
      const actual = totalRebounds(home) - totalRebounds(away);
      return {
        condition,
        threshold: condition.threshold,
        actualValue: actual,
        success: actual >= condition.threshold,
        supportingCardIds: [],
        supportingFacts: [],
        explanation: `Your rebound margin was ${actual >= 0 ? '+' : ''}${String(actual)} (need +${String(condition.threshold)}).`,
      };
    }
    case 'player-double-stat': {
      const perPlayer = home.players.map((player) => {
        const facts = playerCategories(player, condition.threshold, DOUBLE_STAT_ORDER);
        return { cardId: player.cardId, facts };
      });
      const winner = perPlayer.reduce((best, candidate) => {
        if (candidate.facts.length > best.facts.length) return candidate;
        if (candidate.facts.length < best.facts.length) return best;
        return candidate.cardId < best.cardId ? candidate : best;
      });
      const actual = perPlayer.reduce((max, entry) => Math.max(max, entry.facts.length), 0);
      return {
        condition,
        threshold: condition.threshold,
        actualValue: actual,
        success: actual >= condition.categories,
        supportingCardIds: winner.facts.length > 0 ? [winner.cardId] : [],
        supportingFacts: winner.facts.map((fact) => ({
          cardId: winner.cardId,
          category: fact.category,
          value: fact.value,
        })),
        explanation:
          winner.facts.length > 0
            ? `${winner.cardId} recorded ${String(winner.facts.length)} categories of ${String(condition.threshold)}+ (need ${String(condition.categories)}).`
            : `No player reached ${String(condition.threshold)} in two categories.`,
      };
    }
  }
}

export function evaluateCollectionObjective(input: {
  prepared: CollectionPreparedGameV2;
  result: CollectionGameResult;
}): CollectionObjectiveEvaluation {
  const selection = input.prepared.objectives;
  if (selection.selectedObjectiveId === null) {
    return collectionObjectiveEvaluationSchema.parse({ kind: 'not-selected' });
  }
  const offer = selection.offers.find(
    (candidate) => candidate.objectiveId === selection.selectedObjectiveId,
  );
  if (offer === undefined) {
    throw new CollectionCommandError(
      'objective-not-offered',
      `selected objective ${selection.selectedObjectiveId} is not in the offer snapshot`,
    );
  }
  if (input.result.outcome === 'forfeit') {
    return collectionObjectiveEvaluationSchema.parse({
      kind: 'forfeit',
      objectiveId: offer.objectiveId,
      success: false,
      explanation: 'The game ended in a forfeit, so the objective failed.',
    });
  }
  const evaluated = evaluateCondition(offer.condition, input.result, input.prepared);
  return collectionObjectiveEvaluationSchema.parse({
    kind: 'evaluated',
    objectiveId: offer.objectiveId,
    condition: evaluated.condition,
    threshold: evaluated.threshold,
    actualValue: evaluated.actualValue,
    success: evaluated.success,
    supportingCardIds: evaluated.supportingCardIds,
    supportingFacts: evaluated.supportingFacts,
    explanation: evaluated.explanation,
  });
}
