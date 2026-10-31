import { readFileSync } from 'node:fs';
import { parseSeasonDraftCatalog } from './packages/data-contracts/src/loaders/draft-catalog.ts';
import { opponentBracketSchema, capRushLockedInputsSchema } from './packages/data-contracts/src/index.ts';
import { createEngineContext } from './packages/engine/src/sim/kernel.ts';
import { simulateCapRushPlayoffGame } from './packages/engine/src/modes/cap-rush/playoff-sim.ts';
import { capRushPlayoffPerformanceOf } from './packages/engine/src/modes/cap-rush/playoff.ts';
import {
  eraSimulationProfileSchema,
  capRushPlayoffGameSeed,
} from './packages/data-contracts/src/index.ts';

const catalog = parseSeasonDraftCatalog(
  JSON.parse(readFileSync('apps/web/static/data/draft-catalog.json', 'utf8')),
);
const profiles = new Map(
  catalog.candidates.flatMap((c) =>
    c.playoffPerformance === undefined ? [] : ([[c.playerVersionId, c.playoffPerformance]] as const),
  ),
);

// Use the packaged 2010s era profile and two real historical lineups from the catalog,
// built the way the historical field builds them, so this measures the shipped path.
const profile = eraSimulationProfileSchema.parse(
  JSON.parse(readFileSync('apps/web/static/data/era-sim/2010s.json', 'utf8')),
);
const bracket = opponentBracketSchema.parse(
  JSON.parse(readFileSync('apps/web/static/data/opponents/bracket.json', 'utf8')),
);

const locked = capRushLockedInputsSchema.parse(
  JSON.parse(readFileSync('.scratch-locked-fixture.json', 'utf8')),
);
console.log('human', locked.human.teamId, locked.human.displayName);
console.log('pinned rows', locked.playoffPerformance?.players.length ?? 0);

const context = createEngineContext();

function run(lockedInput: typeof locked, count: number) {
  let homePoints = 0;
  let awayPoints = 0;
  let homeWins = 0;
  for (let index = 1; index <= count; index += 1) {
    const plan = {
      seriesId: 'crs-4-0' as const,
      round: 4,
      seriesSlot: 0,
      gameOrdinal: ((index - 1) % 7) + 1,
      homeTeamId: lockedInput.human.teamId,
      awayTeamId: lockedInput.opponents[0]!.team.teamId,
      homeSeed: 1,
      awaySeed: 2,
      userSide: 'home' as const,
      isFinals: true,
      seed: capRushPlayoffGameSeed(lockedInput.runSeed, index % 4 + 1, 0, ((index - 1) % 7) + 1),
    };
    const simulation = simulateCapRushPlayoffGame({ locked: lockedInput, plan, context });
    if (!simulation.game.audit.ok) throw new Error(`audit failed at ${index}`);
    homePoints += simulation.game.summary.homePoints;
    awayPoints += simulation.game.summary.awayPoints;
    if (simulation.game.summary.winnerTeamId === lockedInput.human.teamId) homeWins += 1;
  }
  return {
    home: homePoints / count,
    away: awayPoints / count,
    winRate: homeWins / count,
  };
}

const plain = { ...locked, playoffPerformance: undefined };
const N = 120;
const baseline = run(plain, N);
const adjusted = run(locked, N);
console.log('baseline', baseline);
console.log('adjusted', adjusted);
console.log('delta home pts', (adjusted.home - baseline.home).toFixed(2));
console.log('delta away pts', (adjusted.away - baseline.away).toFixed(2));
console.log('delta win rate', (adjusted.winRate - baseline.winRate).toFixed(3));
void profile;
void bracket;
void capRushPlayoffPerformanceOf;
