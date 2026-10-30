import { createEngineContext, simulateCapRushGame } from './src/index.ts';
import { buildLockedForScratch } from './.scratch-lock.ts';
const locked = buildLockedForScratch();
console.log('schedule', locked.schedule.length, 'opponents', locked.opponents.length, 'human', locked.human.teamId);
try {
  const game = simulateCapRushGame({ locked, gameNumber: 1, context: createEngineContext() });
  console.log(game.summary);
} catch (error) {
  console.log('FAILED', error instanceof Error ? error.message : error);
  console.log((error as { issues?: unknown }).issues);
}
