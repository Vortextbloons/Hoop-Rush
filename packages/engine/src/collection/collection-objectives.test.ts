import { describe, expect, it } from 'vitest';
import {
  type CollectionGameResult,
  type CollectionObjectiveDefinition,
  type CollectionObjectiveId,
  type CollectionPreparedGame,
} from '@hoop-rush/data-contracts';
import { DEFAULT_ERA_SIM_PROFILE } from '@hoop-rush/test-fixtures';
import { simulateCollectionGame } from './game.ts';
import { buildCollectionObjectiveFacts, evaluateCollectionObjective } from './objectives.ts';
import {
  prepareV2Fixture,
  v2Catalog,
  v2Definitions,
  v2Team,
  withSelectedObjective,
} from './v2-fixtures.ts';

const DIFFICULTY = 'pro' as const;

function preparedWithObjective(objectiveId: CollectionObjectiveId | null): CollectionPreparedGame {
  const base = prepareV2Fixture({ difficultyId: DIFFICULTY }).prepared;
  if (objectiveId === null) return base;
  return withSelectedObjective(base, objectiveId);
}

function simulatedResult(
  prepared: CollectionPreparedGame,
): Extract<CollectionGameResult, { outcome: 'completed' }> {
  const simulation = simulateCollectionGame(prepared, v2Catalog(), DEFAULT_ERA_SIM_PROFILE);
  if (
    simulation.result.outcome !== 'completed' ||
    simulation.result.gameVersion !== 'collection-game-v2'
  ) {
    throw new Error('expected a completed v2 game');
  }
  return simulation.result;
}

function cloneResult(
  result: Extract<CollectionGameResult, { outcome: 'completed' }>,
  mutate: (draft: {
    home: Record<string, unknown> & { players: Array<Record<string, unknown>> };
    away: Record<string, unknown> & { players: Array<Record<string, unknown>> };
    winner: 'home' | 'away';
  }) => void,
): Extract<CollectionGameResult, { outcome: 'completed' }> {
  const draft = structuredClone(result) as unknown as {
    home: Record<string, unknown> & { players: Array<Record<string, unknown>> };
    away: Record<string, unknown> & { players: Array<Record<string, unknown>> };
    winner: 'home' | 'away';
  };
  mutate(draft);
  return draft as unknown as Extract<CollectionGameResult, { outcome: 'completed' }>;
}

interface BoxSide {
  score: number;
  box: {
    threes: { made: number; attempted: number };
    turnovers: number;
    rebounds: { offensive: number; defensive: number };
  };
  players: Array<Record<string, unknown>>;
}

describe('collection objective evaluation', () => {
  it('evaluates the three barrage at boundary -1 / boundary / +1', () => {
    const prepared = preparedWithObjective('obj-three-barrage-v1');
    const base = simulatedResult(prepared);
    for (const [made, expected] of [
      [11, false],
      [12, true],
      [13, true],
    ] as const) {
      const result = cloneResult(base, (draft) => {
        (draft.home as unknown as BoxSide).box.threes.made = made;
      });
      const evaluation = evaluateCollectionObjective({ prepared, result });
      expect(evaluation.kind).toBe('evaluated');
      if (evaluation.kind !== 'evaluated') continue;
      expect(evaluation.actualValue).toBe(made);
      expect(evaluation.success).toBe(expected);
      expect(evaluation.threshold).toBe(12);
    }
  });

  it('evaluates the lock score at boundary -1 / boundary / +1', () => {
    const prepared = preparedWithObjective('obj-lock-score-v1');
    const base = simulatedResult(prepared);
    for (const [score, expected] of [
      [104, true],
      [105, true],
      [106, false],
    ] as const) {
      const result = cloneResult(base, (draft) => {
        (draft.away as unknown as BoxSide).score = score;
      });
      const evaluation = evaluateCollectionObjective({ prepared, result });
      if (evaluation.kind !== 'evaluated') throw new Error('expected evaluated');
      expect(evaluation.actualValue).toBe(score);
      expect(evaluation.success).toBe(expected);
      expect(evaluation.threshold).toBe(105);
    }
  });

  it('evaluates bench spark over non-starters only', () => {
    const prepared = preparedWithObjective('obj-bench-spark-v1');
    const base = simulatedResult(prepared);
    const benchIds = prepared.playerTeam.bench;
    const starterIds = prepared.playerTeam.starters;
    const benchPlayers = benchIds.slice(0, 2);
    for (const [benchPoints, expected] of [
      [24, false],
      [25, true],
      [26, true],
    ] as const) {
      const result = cloneResult(base, (draft) => {
        const home = draft.home as unknown as BoxSide;
        for (const player of home.players) player.points = 0;
        const [firstBench] = benchPlayers;
        if (firstBench !== undefined) {
          const player = home.players.find((entry) => entry.cardId === firstBench);
          if (player !== undefined) player.points = benchPoints;
        }
        for (const cardId of starterIds) {
          const player = home.players.find((entry) => entry.cardId === cardId);
          if (player !== undefined) player.points = 50;
        }
      });
      const evaluation = evaluateCollectionObjective({ prepared, result });
      if (evaluation.kind !== 'evaluated') throw new Error('expected evaluated');
      expect(evaluation.actualValue).toBe(benchPoints);
      expect(evaluation.success).toBe(expected);
    }
  });

  it('evaluates ball pressure and rebound margin at their boundaries', () => {
    const pressure = preparedWithObjective('obj-ball-pressure-v1');
    const pressureBase = simulatedResult(pressure);
    for (const [turnovers, expected] of [
      [13, false],
      [14, true],
      [15, true],
    ] as const) {
      const result = cloneResult(pressureBase, (draft) => {
        (draft.away as unknown as BoxSide).box.turnovers = turnovers;
      });
      const evaluation = evaluateCollectionObjective({ prepared: pressure, result });
      if (evaluation.kind !== 'evaluated') throw new Error('expected evaluated');
      expect(evaluation.actualValue).toBe(turnovers);
      expect(evaluation.success).toBe(expected);
    }

    const glass = preparedWithObjective('obj-own-glass-v1');
    const glassBase = simulatedResult(glass);
    for (const [margin, expected] of [
      [9, false],
      [10, true],
      [11, true],
    ] as const) {
      const result = cloneResult(glassBase, (draft) => {
        const home = draft.home as unknown as BoxSide;
        const away = draft.away as unknown as BoxSide;
        home.box.rebounds.offensive = Math.max(0, margin);
        home.box.rebounds.defensive = 0;
        away.box.rebounds.offensive = 0;
        away.box.rebounds.defensive = 0;
      });
      const evaluation = evaluateCollectionObjective({ prepared: glass, result });
      if (evaluation.kind !== 'evaluated') throw new Error('expected evaluated');
      expect(evaluation.actualValue).toBe(margin);
      expect(evaluation.success).toBe(expected);
    }
  });

  it('evaluates the box-score star across two categories', () => {
    const prepared = preparedWithObjective('obj-box-score-star-v1');
    const base = simulatedResult(prepared);
    const starId = prepared.playerTeam.starters[0];
    if (starId === undefined) throw new Error('missing star');
    for (const [categories, expected] of [
      [1, false],
      [2, true],
      [3, true],
    ] as const) {
      const result = cloneResult(base, (draft) => {
        const home = draft.home as unknown as BoxSide;
        for (const player of home.players) {
          player.points = 0;
          (player.rebounds as { total: number }).total = 0;
          player.assists = 0;
          player.steals = 0;
          player.blocks = 0;
        }
        const star = home.players.find((entry) => entry.cardId === starId);
        if (star === undefined) throw new Error('missing star player');
        star.points = 10;
        if (categories >= 2) (star.rebounds as { total: number }).total = 11;
        if (categories >= 3) star.assists = 12;
      });
      const evaluation = evaluateCollectionObjective({ prepared, result });
      if (evaluation.kind !== 'evaluated') throw new Error('expected evaluated');
      expect(evaluation.actualValue).toBe(categories);
      expect(evaluation.success).toBe(expected);
      expect(evaluation.supportingCardIds).toEqual([starId]);
    }
  });

  it('records not-selected and forfeit evaluations', () => {
    const none = preparedWithObjective(null);
    const base = simulatedResult(none);
    expect(evaluateCollectionObjective({ prepared: none, result: base }).kind).toBe('not-selected');

    const selected = preparedWithObjective('obj-three-barrage-v1');
    const forfeit = {
      ...base,
      outcome: 'forfeit',
      losingTeamId: 'collection-player',
      trigger: 'no-legal-five-after-removal',
      homeScore: 0,
      awayScore: 2,
      winner: 'away',
    } as unknown as CollectionGameResult;
    const evaluation = evaluateCollectionObjective({ prepared: selected, result: forfeit });
    expect(evaluation.kind).toBe('forfeit');
    if (evaluation.kind !== 'forfeit') return;
    expect(evaluation.objectiveId).toBe('obj-three-barrage-v1');
    expect(evaluation.success).toBe(false);
  });

  it('excludes bench spark when there is no bench and no planned bench minutes', () => {
    const catalog = v2Catalog();
    const team = v2Team(catalog, 5);
    const definitions: CollectionObjectiveDefinition[] = v2Definitions();
    const facts = buildCollectionObjectiveFacts({
      definitions,
      rootSeed: '0'.repeat(32),
      difficultyId: 'street',
      gameSequence: 0,
      team,
      selectedObjectiveId: null,
    });
    expect(facts.feasibility.benchPlayerCount).toBe(0);
    expect(facts.feasibility.plannedBenchMinutes).toBe(0);
    expect(facts.offers.some((offer) => offer.objectiveId === 'obj-bench-spark-v1')).toBe(false);
    expect(() =>
      buildCollectionObjectiveFacts({
        definitions,
        rootSeed: '0'.repeat(32),
        difficultyId: 'street',
        gameSequence: 0,
        team,
        selectedObjectiveId: 'obj-bench-spark-v1',
      }),
    ).toThrow(/not feasible|infeasible/);
  });
});
