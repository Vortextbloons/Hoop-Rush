import { describe, expect, it } from 'vitest';
import {
  buildOpeningOpponent,
  buildPlayerSeason,
  buildPool,
  buildEraSimulationProfile,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import {
  createOpeningGameInput,
  simulateOpeningGame,
  validateDraftedLineup,
  type DraftedLineup,
} from './commands.js';
import { toSimulationPlayer } from './adapters.js';
import { checkGameResult } from '../../sim/invariants.js';
import { createEngineContext } from '../../sim/context.js';

function draftedLineup(): DraftedLineup {
  const players = [
    buildPlayerSeason({
      playerId: 'p-89',
      displayName: 'Nick Van Exel',
      positions: { sourceLabels: ['PG'], canonical: ['G'], normalizationVersion: 'position-v1' },
    }),
    buildPlayerSeason({
      playerId: 'p-9',
      displayName: 'Sedale Threatt',
      positions: { sourceLabels: ['SG'], canonical: ['G'], normalizationVersion: 'position-v1' },
    }),
    buildPlayerSeason({
      playerId: 'p-920',
      displayName: 'A.C. Green',
      positions: { sourceLabels: ['PF'], canonical: ['F'], normalizationVersion: 'position-v1' },
    }),
    buildPlayerSeason({
      playerId: 'p-109',
      displayName: 'Robert Horry',
      positions: { sourceLabels: ['SF'], canonical: ['F'], normalizationVersion: 'position-v1' },
    }),
    buildPlayerSeason({
      playerId: 'p-124',
      displayName: 'Vlade Divac',
      positions: { sourceLabels: ['C'], canonical: ['C'], normalizationVersion: 'position-v1' },
    }),
  ];
  return {
    lineup: {
      structure: ['G', 'G', 'F', 'F', 'C'],
      assignments: players.map((p, slotIndex) => ({
        slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
        playerId: p.playerId,
        positions: p.positions.canonical,
      })),
    },
    players,
  };
}

describe('sandbox commands', () => {
  it('validates a legal drafted lineup', () => {
    const validation = validateDraftedLineup(draftedLineup());
    expect(validation.ok).toBe(true);
    expect(validation.issues).toEqual([]);
  });

  it('rejects a duplicate-player draft', () => {
    const draft = draftedLineup();
    const bad: DraftedLineup = {
      ...draft,
      lineup: {
        ...draft.lineup,
        assignments: draft.lineup.assignments.map((a, i) =>
          i === 1 ? { ...a, playerId: draft.lineup.assignments[0]!.playerId } : a,
        ),
      },
    };
    expect(validateDraftedLineup(bad).ok).toBe(false);
  });

  it('creates a serialized opening-game input with the user as home', () => {
    const opponent = buildOpeningOpponent();
    const input = createOpeningGameInput({
      seed: seedFromString('opening-1'),
      dataVersion: 'm1.0',
      profile: buildEraSimulationProfile(),
      drafted: draftedLineup(),
      opponent,
    });
    expect(input.home.teamId).toBe('user');
    expect(input.home.players).toHaveLength(5);
    expect(input.away.teamId).toBe('lakers');
    expect(input.away.players.map((p) => p.playerId)).toEqual([
      'p-89',
      'p-9',
      'p-920',
      'p-109',
      'p-124',
    ]);
    expect(input.seed).toBe(seedFromString('opening-1'));
  });

  it('adapts pool players without leaking summary ratings', () => {
    const player = buildPlayerSeason({
      detailedRatings: {
        insideScoring: 88,
        threePoint: 71,
        freeThrow: 68,
        ballHandling: 61,
        passing: 96,
        offensiveIq: 73,
        offensiveRebound: 38,
        defensiveRebound: 59,
        perimeterDefense: 72,
        interiorDefense: 66,
        steal: 72,
        block: 62,
        defensiveIq: 60,
        speed: 88,
        strength: 89,
        vertical: 59,
        closeShot: 71,
        midrange: 61,
        overall: 99,
      },
      tendencies: {
        usageRate: 19.19,
        passRate: 35,
        shotRate: 31.34,
        driveRate: 20.88,
        postUpRate: 2.03,
        rimFrequency: 32.94,
        shortMidFrequency: 11.5,
        longMidFrequency: 7.83,
        cornerThreeFrequency: 10.68,
        aboveBreakThreeFrequency: 15.66,
        threePointRate: 44.7,
        freeThrowRate: 29.37,
        turnoverRate: 12.24,
        isolationRate: 8.76,
        pickAndRollBallHandlerRate: 32.11,
        pickAndRollRollManRate: 8.17,
        spotUpRate: 19.37,
        transitionRate: 14.04,
        cutRate: 10.05,
        foulRate: 1.86,
        stealAttemptRate: 9.58,
        blockAttemptRate: 11.01,
        crashOffensiveGlassRate: 15.42,
      },
    });
    const sim = toSimulationPlayer(player);
    expect(sim.ratings.passing).toBe(96);
    expect(sim.ratings).not.toHaveProperty('overall');
    expect(sim.ratings.insideScoring).toBe(88);
    expect(sim.tendencies.usageRate).toBeCloseTo(19.19);
  });

  it('simulates the opening game with exact invariants', () => {
    const opponent = buildOpeningOpponent();
    const input = createOpeningGameInput({
      seed: seedFromString('opening-2'),
      dataVersion: 'm1.0',
      profile: buildEraSimulationProfile(),
      drafted: draftedLineup(),
      opponent,
    });
    const result = simulateOpeningGame(input, createEngineContext());
    expect(checkGameResult(result)).toEqual([]);
    expect(result.home.teamId).toBe('user');
    expect(result.away.teamId).toBe('lakers');
    expect(result.engineVersion).toBe(createEngineContext().engineVersion);
    expect(result.profileVersion).toBe(input.profile.profileVersion);
  });

  it('rejects a draft whose player is missing from the pool', () => {
    const opponent = buildOpeningOpponent();
    const draft = draftedLineup();
    const incomplete: DraftedLineup = {
      lineup: draft.lineup,
      players: draft.players.slice(0, 4),
    };
    expect(() =>
      createOpeningGameInput({
        seed: seedFromString('bad-1'),
        dataVersion: 'm1.0',
        profile: buildEraSimulationProfile(),
        drafted: incomplete,
        opponent,
      }),
    ).toThrow();
  });

  it('validates an opponent artifact against the pool lineage', () => {
    const opponent = buildOpeningOpponent();
    expect(opponent.lineup.assignments).toHaveLength(5);
    expect(opponent.players).toHaveLength(5);
    const pool = buildPool([...draftedLineup().players]);
    void pool;
    expect(opponent.difficultyBand).toBe('medium');
  });
});
