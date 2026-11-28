import type { SimulationPlayer } from '@hoop-rush/data-contracts';
import { createEngineContext } from './src/sim/kernel.ts';
import {
  simulateFullCourtGame,
  type FullCourtGameInput,
  type FullCourtGameResult,
} from './src/modes/full-court/game.ts';
import {
  fullCourtTestInput,
  fullCourtTestRoster,
} from './src/modes/full-court/game-test-support.ts';

const ctx = createEngineContext();

function withAnchors(player: SimulationPlayer, fgaPerGame: number): SimulationPlayer {
  return { ...player, anchors: { ...player.anchors, fieldGoalAttemptsPerGame: fgaPerGame } };
}

const BASE = fullCourtTestRoster('real', 9, (index) => ({
  rating: index === 0 ? 92 : index === 1 ? 84 : 72,
  usageRate: index === 0 ? 32 : index === 1 ? 27 : 17,
  minutesPerGame: index === 0 ? 35 : index === 1 ? 33 : 26,
}));
const ROSTER: SimulationPlayer[] = BASE.map((player, index) =>
  withAnchors(player, [21, 16, 12, 10, 9, 10, 8, 5, 3][index] ?? 5),
);
const IDS = ROSTER.map((player) => player.playerId);
const idAt = (index: number): string => {
  const id = IDS[index];
  if (id === undefined) throw new Error('missing');
  return id;
};
const ROTATION = {
  startingFive: IDS.slice(0, 5),
  minuteTargets: {
    [idAt(0)]: 36,
    [idAt(1)]: 34,
    [idAt(2)]: 32,
    [idAt(3)]: 30,
    [idAt(4)]: 28,
    [idAt(5)]: 30,
    [idAt(6)]: 26,
    [idAt(7)]: 18,
    [idAt(8)]: 6,
  },
};
const SEEDS = Array.from({ length: 24 }, (_v, i) => `measure2-${String(i)}`);

function inputFor(
  seed: string,
  hierarchy: FullCourtGameInput['home']['hierarchy'],
): FullCourtGameInput {
  const input = fullCourtTestInput({ seed, homeRoster: ROSTER });
  return {
    ...input,
    home: { ...input.home, rotation: ROTATION, ...(hierarchy === undefined ? {} : { hierarchy }) },
  };
}

function line(result: FullCourtGameResult, playerId: string) {
  const found = result.home.players.find((player) => player.playerId === playerId);
  if (found === undefined) throw new Error('missing player');
  return found;
}

const CONFIGS = [
  ['none', undefined],
  ['primary only', { primaryPlayerId: idAt(0) }],
  ['second only', { secondaryPlayerId: idAt(1) }],
  ['general only', { floorGeneralPlayerId: idAt(2) }],
  ['primary+second', { primaryPlayerId: idAt(0), secondaryPlayerId: idAt(1) }],
  [
    'all three',
    { primaryPlayerId: idAt(0), secondaryPlayerId: idAt(1), floorGeneralPlayerId: idAt(2) },
  ],
] as const;

for (const [label, hierarchy] of CONFIGS) {
  let star = 0,
    second = 0,
    general = 0,
    team = 0,
    starMin = 0,
    starPoints = 0;
  for (const seed of SEEDS) {
    const result = simulateFullCourtGame(inputFor(seed, hierarchy), ctx);
    const s = line(result, idAt(0));
    star += s.fieldGoals.attempted;
    second += line(result, idAt(1)).fieldGoals.attempted;
    general += line(result, idAt(2)).fieldGoals.attempted;
    starPoints += s.points;
    starMin += s.seconds / 60;
    team += result.home.box.fieldGoals.attempted;
  }
  const n = SEEDS.length;
  const share = (fga: number) => ((fga / team) * 100).toFixed(1);
  console.log(
    `${label.padEnd(15)} star ${(star / n).toFixed(1)} FGA (${share(star)}%) ${(starPoints / n).toFixed(1)} pts  ` +
      `second ${(second / n).toFixed(1)} (${share(second)}%)  ` +
      `general ${(general / n).toFixed(1)} (${share(general)}%)  ` +
      `team ${(team / n).toFixed(1)}  star/36 ${((star * 36) / starMin).toFixed(1)}`,
  );
}
