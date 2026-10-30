import {
  capRushLeagueSlotGames,
  createEngineContext,
  simulateCapRushGame,
  simulateCapRushLeagueGame,
  simulateCapRushPlayoffGame,
} from './src/index.ts';
import { buildScratchLocked, playoffPlans } from './.scratch-shared.ts';

const locked = buildScratchLocked();
const context = createEngineContext();
const timings: Record<string, number> = {};

function phase(key: string, fn: () => void): void {
  const started = performance.now();
  fn();
  timings[key] = (timings[key] ?? 0) + (performance.now() - started);
}

let seasonTapeDigest = '';
phase('season', () => {
  for (let gameNumber = 1; gameNumber <= 82; gameNumber += 1) {
    const simulation = simulateCapRushGame({ locked, gameNumber, context });
    if (!simulation.audit.ok) throw new Error(`season audit failed at ${String(gameNumber)}`);
    if (gameNumber === 82) seasonTapeDigest = simulation.summary.resultDigest;
  }
});

phase('league', () => {
  for (let slot = 1; slot <= 82; slot += 1) {
    for (const entry of capRushLeagueSlotGames(locked, slot)) {
      const game = simulateCapRushLeagueGame({ locked, entry, context });
      if (game.homePoints <= 0) throw new Error('league game failed');
    }
  }
});

const plans = playoffPlans(locked);
phase('playoffs', () => {
  for (const plan of plans) {
    const simulation = simulateCapRushPlayoffGame({ locked, plan, context });
    if (!simulation.game.audit.ok) throw new Error('playoff audit failed');
  }
});

const total = Object.values(timings).reduce((sum, value) => sum + value, 0);
console.log(
  JSON.stringify({
    timings,
    totalMs: Math.round(total * 10) / 10,
    playoffGames: plans.length,
    marker: seasonTapeDigest.slice(0, 8),
  }),
);
