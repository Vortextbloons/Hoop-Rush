import type { OpponentBracket, SimulationPlayer } from '@hoop-rush/data-contracts';
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
} from './generator.ts';
import { generateBracket } from './generator.ts';
import { createEngineContext } from '../sim/context.ts';

/**
 * Shared fixtures for bracket generation tests (spec/01, spec/06). A small
 * synthetic catalog keeps the suite fast while exercising the full
 * propose-review-freeze workflow. The generation is deterministic, so the
 * bracket is computed once per worker and reused by every test that asserts
 * properties of it; the regeneration tests in generator-regeneration.test.ts
 * still generate independently.
 */

function candidatePlayer(
  franchiseId: string,
  index: number,
  positions: SimulationPlayer['positions'],
  score: number,
): BracketCandidatePlayer {
  const sim = buildSimulationPlayer({
    playerId: `p-${franchiseId}-${String(index)}`,
    displayName: `${franchiseId} ${String(index)}`,
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
      { position: ['PG'], count: 8, offset: 0 },
      { position: ['SG'], count: 8, offset: 8 },
      { position: ['SF'], count: 8, offset: 16 },
      { position: ['PF'], count: 8, offset: 24 },
      { position: ['C'], count: 5, offset: 32 },
      { position: ['PG', 'SF'], count: 2, offset: 37 },
      { position: ['PF', 'C'], count: 1, offset: 39 },
    ];
  for (const { position, count, offset } of groups) {
    for (let i = 0; i < count; i += 1) {
      const score = ladder[(offset + i) % ladder.length];
      if (score === undefined) {
        throw new Error(`candidate ladder missing score at index ${String(offset + i)}`);
      }
      players.push(candidatePlayer(franchiseId, index, position, score));
      index += 1;
    }
  }
  return { franchiseId, displayName: `Fixture ${franchiseId}`, players };
}

export function generationOptions(
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
    proposalsPerFranchise: 12,
    samplesPerBenchmark: 4,
    minPlayerScore: 45,
    engineContext: createEngineContext(),
    ...overrides,
  };
}

/**
 * The fixture generation is deterministic, and most tests only assert
 * properties of that single artifact. Computing it once keeps the suite fast
 * (each generation measures ~360 proposals against the benchmark matrix);
 * the byte-identity test regenerates independently. The proposal and
 * benchmark counts are the minimum that still spans the strength band:
 * 8 proposals collapse every team to the same percentile.
 */
let sharedBracket: OpponentBracket | null = null;
export function fixtureBracket(): OpponentBracket {
  if (sharedBracket === null) {
    sharedBracket = generateBracket(generationOptions());
  }
  return sharedBracket;
}
