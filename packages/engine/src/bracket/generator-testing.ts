import type { OpponentBracket, SimulationPlayer } from '@hoop-rush/data-contracts';
import { playerIdSchema, seedSchema } from '@hoop-rush/data-contracts';
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
import { createEngineContext } from '../sim/kernel.ts';
function candidatePlayer(
  franchiseId: string,
  index: number,
  positions: SimulationPlayer['positions'],
  score: number,
): BracketCandidatePlayer {
  const sim = buildSimulationPlayer({
    playerId: playerIdSchema.parse(`p-${franchiseId}-${String(index)}`),
    displayName: `${franchiseId} ${String(index)}`,
    positions,
  });
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
function candidatesFor(franchiseId: string, rank: number): FranchiseCandidates {
  const players: BracketCandidatePlayer[] = [];
  let index = 0;
  // Each franchise gets its own quality offset so the fixture has a real
  // strength ordering, the way the packaged pools do.
  const tierOffset = 14 - (rank / (FRANCHISES.length - 1)) * 26;
  const ladder = [92, 89, 86, 83, 80, 77, 74, 71, 68, 65, 62, 59, 56, 53, 50, 47];
  const groups: Array<{
    position: SimulationPlayer['positions'];
    count: number;
    offset: number;
  }> = [
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
      const base = ladder[(offset + i) % ladder.length];
      if (base === undefined) {
        throw new Error(`candidate ladder missing score at index ${String(offset + i)}`);
      }
      const score = Math.max(20, Math.min(98, Math.round(base + tierOffset)));
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
    seed: seedSchema.parse(seedFromString('fixture-bracket')),
    dataVersion: 'data-v1',
    generationVersion: 'bracket-m3-v1',
    profile: buildEraSimulationProfile(),
    openingOpponent: opening,
    difficulty,
    candidates: FRANCHISES.map((franchiseId, rank) => candidatesFor(franchiseId, rank)),
    gamesPerPair: 4,
    minPlayerScore: 45,
    engineContext: createEngineContext(),
    ...overrides,
  };
}
let sharedBracket: OpponentBracket | null = null;
export function fixtureBracket(): OpponentBracket {
  if (sharedBracket === null) {
    sharedBracket = generateBracket(generationOptions());
  }
  return sharedBracket;
}
