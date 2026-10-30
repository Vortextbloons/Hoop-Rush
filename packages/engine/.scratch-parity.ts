import { buildScratchLocked, playoffPlans } from './.scratch-shared.ts';
import { createEngineContext, simulateCapRushGame, simulateCapRushLeagueGame, simulateCapRushPlayoffGame, capRushLeagueSlotGames } from './src/index.ts';
import { havocBattleGameTapeDigest } from './src/modes/havoc/core/battle-digests.ts';
import { battleToSoloTape } from './src/modes/havoc/core/battle-adapters.ts';

const locked = buildScratchLocked();
const context = createEngineContext();

const out: Record<string, unknown> = {};
const games: Record<string, unknown> = {};
for (const gameNumber of [1, 2, 7, 41]) {
  const simulation = simulateCapRushGame({ locked, gameNumber, context });
  games[String(gameNumber)] = {
    summary: simulation.summary,
    audit: simulation.audit,
    result: simulation.result,
  };
}
out.season = games;

const league: unknown[] = [];
for (const entry of capRushLeagueSlotGames(locked, 1)) {
  league.push(simulateCapRushLeagueGame({ locked, entry, context }));
}
out.league = league;

const plans = playoffPlans(locked);
const playoff: unknown[] = [];
const firstPlayoff = simulateCapRushPlayoffGame({ locked, plan: plans[0]!, context });
playoff.push({
  game: firstPlayoff.game,
  inputDigest: firstPlayoff.inputDigest,
  resultDigest: firstPlayoff.resultDigest,
  tapeDigest: havocBattleGameTapeDigest(firstPlayoff.tape),
});
for (const plan of plans.slice(1, 3)) {
  const simulation = simulateCapRushPlayoffGame({ locked, plan, context });
  playoff.push({
    game: simulation.game,
    inputDigest: simulation.inputDigest,
    resultDigest: simulation.resultDigest,
    tapeDigest: havocBattleGameTapeDigest(simulation.tape),
  });
}
const userPlan = {
  ...plans[0]!,
  homeTeamId: locked.human.teamId,
  userSide: 'home' as const,
};
const userPlayoff = simulateCapRushPlayoffGame({ locked, plan: userPlan, context });
playoff.push({
  game: userPlayoff.game,
  inputDigest: userPlayoff.inputDigest,
  resultDigest: userPlayoff.resultDigest,
  tapeDigest: havocBattleGameTapeDigest(userPlayoff.tape),
});
out.playoff = playoff;

const seasonTape = simulateCapRushGame({ locked, gameNumber: 3, context });
out.seasonUserTape = havocBattleGameTapeDigest(
  (({ tape }) => tape)(seasonTape as unknown as { tape: never }),
);
out.seasonUserSoloTape = havocBattleGameTapeDigest(
  battleToSoloTape(
    (({ tape }) => tape)(seasonTape as unknown as { tape: never }),
    seasonTape.input.humanSide,
  ),
);

console.log(JSON.stringify(out));