import {
  type Position,
  type SeasonEffectsState,
  type SeasonHealthState,
  type SeasonRetainedGameDetail,
} from '@hoop-rush/data-contracts';
import { seasonBlockGamesOf, simulateSeasonBlockGame } from '@hoop-rush/engine';
import {
  createSeasonBlockRunner,
  runnerBlockCommand,
  runnerPipelineInput,
  type SeasonBlockRunnerState,
} from './src/commands/season-block.ts';

const MAX_BLOCK = Number(process.argv[2] ?? '1');

const state: SeasonBlockRunnerState = createSeasonBlockRunner({
  runPath: 'src/fixtures/season-run.json',
});

function sharedOptionsOf(input: ReturnType<typeof runnerPipelineInput>) {
  const staminaByVersion = new Map<string, number>();
  for (const player of input.expanded.values()) {
    const stamina = player.stamina;
    if (stamina === undefined) throw new Error('expanded player without stamina');
    staminaByVersion.set(player.playerVersionId, stamina.rating);
  }
  const durabilityByVersion = new Map<string, number>();
  for (const candidate of input.catalog.candidates) {
    durabilityByVersion.set(candidate.playerVersionId, candidate.durability.rating);
  }
  const positions = new Map<string, readonly Position[]>();
  for (const player of input.expanded.values()) {
    positions.set(player.playerVersionId, player.positions);
  }
  return { staminaByVersion, durabilityByVersion, positions };
}

const gamesPlayedByPlayer = new Map<string, number>();
const foulsByPlayer = new Map<string, number>();
const foulOutsByPlayer = new Map<string, number>();
const minutesByPlayer = new Map<string, number>();
const teamFoulsByGame: number[] = [];
let completedGames = 0;
let foulOutEventsTotal = 0;
let removalEventsTotal = 0;
let forfeits = 0;

let effects: SeasonEffectsState = state.effects;
let health: SeasonHealthState = state.health;
let previousRound = 0;

let stopped = false;
for (let blockIndex = 0; blockIndex <= MAX_BLOCK && !stopped; blockIndex += 1) {
  const command = runnerBlockCommand(state, blockIndex);
  const input = runnerPipelineInput(state, command);
  const { staminaByVersion, durabilityByVersion, positions } = sharedOptionsOf(input);
  const rotationByFranchise = new Map(
    input.run.rotations.map((rotation) => [rotation.franchiseId, rotation]),
  );
  const rosterByFranchise = new Map(
    input.run.rosters.map((roster) => [roster.franchiseId, roster]),
  );
  const gameNumberById = new Map(
    input.schedule.games.map((game, index) => [game.gameId, index + 1]),
  );
  const games = seasonBlockGamesOf(input.schedule, blockIndex);
  for (const game of games) {
    const outcome = simulateSeasonBlockGame({
      input,
      game,
      effects,
      health,
      options: {
        gameNumberById,
        rotationByFranchise,
        rosterByFranchise,
        staminaByVersion,
        durabilityByVersion,
        positions,
        skipRecoveryTick: !(previousRound !== 0 && game.round > previousRound),
      },
    });
    if ('interruption' in outcome) {
      stopped = true;
      break;
    }
    const summary = outcome.summary;
    if (summary.status === 'forfeit') {
      forfeits += 1;
      effects = outcome.effects;
      health = outcome.health;
      previousRound = game.round;
      continue;
    }
    const detail = outcome.retainedDetail as SeasonRetainedGameDetail | undefined;
    if (detail === undefined) throw new Error('retained detail missing');
    const result = detail.result;
    completedGames += 1;
    foulOutEventsTotal += result.foulOuts.length;
    removalEventsTotal += result.removals.length;
    teamFoulsByGame.push(result.home.box.fouls + result.away.box.fouls);
    for (const side of [result.home, result.away]) {
      for (const player of side.players) {
        gamesPlayedByPlayer.set(
          player.playerVersionId,
          (gamesPlayedByPlayer.get(player.playerVersionId) ?? 0) + 1,
        );
        foulsByPlayer.set(
          player.playerVersionId,
          (foulsByPlayer.get(player.playerVersionId) ?? 0) + player.fouls,
        );
        minutesByPlayer.set(
          player.playerVersionId,
          (minutesByPlayer.get(player.playerVersionId) ?? 0) + player.seconds / 60,
        );
      }
    }
    for (const foulOut of result.foulOuts) {
      foulOutsByPlayer.set(
        foulOut.playerVersionId,
        (foulOutsByPlayer.get(foulOut.playerVersionId) ?? 0) + 1,
      );
    }
    effects = outcome.effects;
    health = outcome.health;
    previousRound = game.round;
  }
}

console.log(
  `completedGames=${String(completedGames)} forfeits=${String(forfeits)} foulOutEvents=${String(foulOutEventsTotal)} injuryRemovals=${String(removalEventsTotal)}`,
);
const totalGames = completedGames + forfeits;
console.log(
  `foul-outs per game = ${(foulOutEventsTotal / totalGames).toFixed(2)}; injury removals per game = ${(removalEventsTotal / totalGames).toFixed(3)}`,
);

const playerRows = [...gamesPlayedByPlayer.entries()]
  .map(([playerVersionId, games]) => ({
    playerVersionId,
    games,
    fouls: foulsByPlayer.get(playerVersionId) ?? 0,
    foulOuts: foulOutsByPlayer.get(playerVersionId) ?? 0,
    minutes: minutesByPlayer.get(playerVersionId) ?? 0,
  }))
  .sort((a, b) => b.foulOuts - a.foulOuts || b.fouls - a.fouls);
const teamFoulSamples: number[] = teamFoulsByGame;
console.log(
  `team fouls per game: mean=${(teamFoulSamples.reduce((a, b) => a + b, 0) / Math.max(1, teamFoulSamples.length)).toFixed(2)} (target 21 ± 2.5)`,
);

console.log(`players tracked: ${String(playerRows.length)}`);
console.log('top foul-out players:');
for (const row of playerRows.slice(0, 15)) {
  console.log(
    `  ${row.playerVersionId} games=${String(row.games)} foulOuts=${String(row.foulOuts)} (${((row.foulOuts / row.games) * 100).toFixed(0)}%) fouls=${String(row.fouls)} foulsPerGame=${(row.fouls / row.games).toFixed(2)} minPerGame=${(row.minutes / row.games).toFixed(1)}`,
  );
}
const foulOutCounts = new Map<number, number>();
for (const row of playerRows) {
  foulOutCounts.set(row.foulOuts, (foulOutCounts.get(row.foulOuts) ?? 0) + 1);
}
console.log(
  `foul-out distribution across players: ${[...foulOutCounts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([count, players]) => `${String(count)}x:${String(players)}`)
    .join(' ')}`,
);
