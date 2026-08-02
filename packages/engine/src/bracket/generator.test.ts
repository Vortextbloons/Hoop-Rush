import { describe, expect, it } from 'vitest';
import type {
  EraSimulationProfile,
  OpponentBracket,
  SimulationPlayer,
} from '@hoop-rush/data-contracts';
import {
  buildEraSimulationProfile,
  buildFixtureBracket,
  buildOpeningOpponent,
  buildSimulationPlayer,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import type {
  BracketCandidatePlayer,
  BracketGenerationOptions,
  FranchiseCandidates,
} from './generator.js';
import { generateBracket } from './generator.js';
import { createEngineContext } from '../sim/context.js';
import { validateBracketContent } from '../challenge/commands.js';
import { evaluateLineupBalance } from '../challenge/lineup-eval.js';
import { scheduleInvariants } from './schedule.js';

/**
 * Bracket generation tests (spec/01, spec/06): deterministic regeneration,
 * unchanged opening opponent, balance constraints, strength bands, schedule
 * distribution, and no immediate repeats. A small synthetic catalog keeps the
 * suite fast while exercising the full propose-review-freeze workflow.
 */

function candidatePlayer(
  franchiseId: string,
  index: number,
  positions: SimulationPlayer['positions'],
  score: number,
): BracketCandidatePlayer {
  const sim = buildSimulationPlayer({
    playerId: `p-${franchiseId}-${String(index)}`,
    displayName: `${franchiseId} ${index}`,
    positions,
  });
  // Scale the possession ratings with the score so proposals span the
  // strength spectrum (the score alone only drives proposal sampling).
  // Tendencies scale too: the m3 engine differentiates on creation, spacing,
  // and shot volume, so score-flat tendencies would compress win rates.
  const delta = score - 65;
  const shifted = Object.fromEntries(
    Object.entries(sim.ratings).map(([key, value]) => [
      key,
      Math.max(30, Math.min(95, value + delta)),
    ]),
  ) as SimulationPlayer['ratings'];
  const shiftedTendencies = {
    ...sim.tendencies,
    usageRate: Math.max(5, Math.min(40, sim.tendencies.usageRate + delta * 0.7)),
    shotRate: Math.max(5, Math.min(50, sim.tendencies.shotRate + delta * 0.6)),
    passRate: Math.max(5, Math.min(50, sim.tendencies.passRate + delta * 0.5)),
    threePointRate: Math.max(0, Math.min(50, sim.tendencies.threePointRate + delta * 0.6)),
    freeThrowRate: Math.max(0, Math.min(50, sim.tendencies.freeThrowRate + delta * 0.3)),
  };
  return {
    playerId: sim.playerId,
    displayName: sim.displayName,
    positions: sim.positions,
    heightInches: sim.heightInches,
    weightLbs: sim.weightLbs,
    ratings: shifted,
    tendencies: shiftedTendencies,
    seasonKey: '1995-96',
    score,
  };
}

const FRANCHISES = [
  'hawks',
  'celtics',
  'nets',
  'hornets',
  'bulls',
  'cavaliers',
  'mavericks',
  'nuggets',
  'pistons',
  'warriors',
  'rockets',
  'pacers',
  'clippers',
  'lakers',
  'grizzlies',
  'heat',
  'bucks',
  'timberwolves',
  'pelicans',
  'knicks',
  'thunder',
  'magic',
  'sixers',
  'suns',
  'blazers',
  'kings',
  'spurs',
  'raptors',
  'jazz',
  'wizards',
];

/** One franchise with candidates spread evenly across the strength spectrum. */
function candidatesFor(franchiseId: string): FranchiseCandidates {
  const players: BracketCandidatePlayer[] = [];
  let index = 0;
  const ladder = [92, 89, 86, 83, 80, 77, 74, 71, 68, 65, 62, 59, 56, 53, 50, 47];
  const groups: Array<{ position: SimulationPlayer['positions']; count: number; offset: number }> =
    [
      { position: ['G'], count: 8, offset: 0 },
      { position: ['G'], count: 8, offset: 8 },
      { position: ['F'], count: 8, offset: 16 },
      { position: ['F'], count: 8, offset: 24 },
      { position: ['C'], count: 5, offset: 32 },
      { position: ['G', 'F'], count: 2, offset: 37 },
      { position: ['F', 'C'], count: 1, offset: 39 },
    ];
  for (const { position, count, offset } of groups) {
    for (let i = 0; i < count; i += 1) {
      const score = ladder[(offset + i) % ladder.length]!;
      players.push(
        candidatePlayer(franchiseId, index, position as SimulationPlayer['positions'], score),
      );
      index += 1;
    }
  }
  return { franchiseId, displayName: `Fixture ${franchiseId}`, players };
}

function generationOptions(
  overrides: Partial<BracketGenerationOptions> = {},
): BracketGenerationOptions {
  const difficulty = buildFixtureBracket().difficulty;
  const opening = buildOpeningOpponent();
  return {
    seed: seedFromString('fixture-bracket'),
    dataVersion: 'data-v1',
    generationVersion: 'bracket-m3-v1',
    profile: buildEraSimulationProfile(),
    openingOpponent: opening,
    difficulty,
    candidates: FRANCHISES.map(candidatesFor),
    proposalsPerFranchise: 24,
    samplesPerBenchmark: 6,
    minPlayerScore: 45,
    engineContext: createEngineContext(),
    ...overrides,
  };
}

/**
 * The fixture generation is deterministic, and six tests only assert
 * properties of that single artifact. Computing it once keeps the suite fast
 * (each generation measures ~700 proposals against the benchmark matrix);
 * the byte-identity test below still regenerates independently.
 */
let sharedBracket: OpponentBracket | null = null;
function fixtureBracket(): OpponentBracket {
  if (sharedBracket === null) {
    sharedBracket = generateBracket(generationOptions());
  }
  return sharedBracket;
}

describe('generateBracket (propose-review-freeze)', () => {
  it('generates a validated 30-team bracket with the fixed 82-game schedule', () => {
    const bracket = fixtureBracket();
    expect(bracket.opponents).toHaveLength(30);
    expect(bracket.schedule).toHaveLength(82);
    expect(validateBracketContent(bracket)).toEqual([]);
    expect(scheduleInvariants(bracket.schedule)).toEqual([]);
    expect(bracket.schedule[0]?.opponentId).toBe('lakers-1990s-opening');
    expect(bracket.generation.seed).toBe(seedFromString('fixture-bracket'));
  }, 40_000);

  it('keeps the opening opponent unchanged', () => {
    const opening = buildOpeningOpponent();
    const bracket = fixtureBracket();
    const entry = bracket.opponents.find((o) => o.opponentId === 'lakers-1990s-opening');
    expect(entry).toBeDefined();
    expect(entry!.teamId).toBe(opening.teamId);
    expect(entry!.displayName).toBe(opening.displayName);
    expect(JSON.stringify(entry!.lineup)).toBe(JSON.stringify(opening.lineup));
    expect(JSON.stringify(entry!.players)).toBe(JSON.stringify(opening.players));
  }, 40_000);

  it('regenerates byte-identically with the same seed and inputs', () => {
    const a = fixtureBracket();
    const b = generateBracket(generationOptions());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  }, 60_000);

  it('regenerates differently with a different seed', () => {
    const a = fixtureBracket();
    const b = generateBracket(generationOptions({ seed: seedFromString('fixture-bracket-2') }));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  }, 60_000);

  it('only selects balanced legal lineups with no internal duplicates', () => {
    const bracket = fixtureBracket();
    const usedPlayers = new Set<string>();
    for (const opponent of bracket.opponents) {
      const team = {
        teamId: opponent.teamId,
        displayName: opponent.displayName,
        players: opponent.players,
      };
      const balance = evaluateLineupBalance(team);
      expect(balance.ok).toBe(true);
      const ids = opponent.players.map((p) => p.playerId);
      expect(new Set(ids).size).toBe(5);
      for (const id of ids) {
        expect(usedPlayers.has(id)).toBe(false);
        usedPlayers.add(id);
      }
      const assignmentIds = opponent.lineup.assignments.map((a) => a.playerId);
      expect(assignmentIds).toEqual(ids);
    }
  }, 40_000);

  it('spans the team percentile band with the league median inside its band', () => {
    const bracket = fixtureBracket();
    const percentiles = bracket.opponents
      .filter((o) => o.opponentId !== 'lakers-1990s-opening')
      .map((o) => o.strength.percentile)
      .sort((a, b) => a - b);
    const band = bracket.difficulty.teamPercentileBand;
    expect(Math.min(...percentiles)).toBeGreaterThanOrEqual(band[0] - 0.001);
    expect(Math.max(...percentiles)).toBeLessThanOrEqual(band[1] + 0.001);
    const all = bracket.opponents.map((o) => o.strength.percentile).sort((a, b) => a - b);
    const median = (all[14]! + all[15]!) / 2;
    const medianBand = bracket.difficulty.leagueMedianPercentileBand;
    expect(median).toBeGreaterThanOrEqual(medianBand[0]);
    expect(median).toBeLessThanOrEqual(medianBand[1]);
  }, 40_000);

  it('records committed generation metadata', () => {
    const bracket = fixtureBracket();
    expect(bracket.generation.generationVersion).toBe('bracket-m3-v1');
    expect(bracket.generation.dataVersion).toBe('data-v1');
    expect(bracket.generation.targetBands.teamPercentileBand).toEqual([0.25, 0.65]);
    expect(bracket.bracketVersion).toBe('bracket-m3-v1');
    expect(bracket.scheduleVersion).toBe('schedule-v1');
    expect(bracket.difficulty.name).toBe('medium');
  }, 40_000);

  it('throws when a franchise cannot form a legal lineup', () => {
    const options = generationOptions();
    const broken = options.candidates.map((candidate) =>
      candidate.franchiseId === 'hawks'
        ? {
            ...candidate,
            players: candidate.players.filter((p) => p.positions.includes('G')),
          }
        : candidate,
    );
    expect(() => generateBracket({ ...options, candidates: broken })).toThrow(
      /cannot form a legal lineup/,
    );
  }, 60_000);
});
