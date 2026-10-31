import { readFileSync } from 'node:fs';
import {
  eraSimulationProfileSchema,
  capRushPlayoffGameSeed,
  capRushLockedInputsSchema,
} from './packages/data-contracts/src/index.ts';
import { createEngineContext } from './packages/engine/src/sim/kernel.ts';
import { simulateCapRushPlayoffGame } from './packages/engine/src/modes/cap-rush/playoff-sim.ts';
import { capRushPlayoffPerformanceOf } from './packages/engine/src/modes/cap-rush/playoff.ts';

const locked = capRushLockedInputsSchema.parse(
  JSON.parse(readFileSync('.scratch-locked-fixture.json', 'utf8')),
);
const context = createEngineContext();
void eraSimulationProfileSchema;

console.log(
  'pinned rows',
  locked.playoffPerformance?.players.map((row) => ({
    id: row.playerId,
    season: row.seasonKey,
    weight: Number(row.weight.toFixed(2)),
    ts: row.observed.tsPct === null ? null : Number((row.observed.tsPct * 100).toFixed(2)),
    pts: row.observed.pointsPer36 === null ? null : Number(row.observed.pointsPer36.toFixed(2)),
    tov: row.observed.turnoversPer36 === null ? null : Number(row.observed.turnoversPer36.toFixed(2)),
    appliedFg: Number((row.applied.fieldGoalPct * 100).toFixed(2)),
    appliedFga: Number(row.applied.fieldGoalAttemptsPerGame.toFixed(2)),
    appliedTov: Number(row.applied.turnoverRate.toFixed(2)),
  })),
);

function run(input: typeof locked, count: number, mirror: boolean) {
  let home = 0;
  let away = 0;
  let homeWins = 0;
  for (let index = 1; index <= count; index += 1) {
    const plan = {
      seriesId: 'crs-4-0' as const,
      round: 4,
      seriesSlot: 0,
      gameOrdinal: ((index - 1) % 7) + 1,
      homeTeamId: input.human.teamId,
      awayTeamId: input.opponents[0]!.team.teamId,
      homeSeed: 1,
      awaySeed: 2,
      userSide: 'home' as const,
      isFinals: true,
      seed: capRushPlayoffGameSeed(input.runSeed, (index % 4) + 1, 0, ((index - 1) % 7) + 1),
    };
    const simulation = simulateCapRushPlayoffGame({ locked: input, plan, context });
    if (!simulation.game.audit.ok) throw new Error(`audit failed at ${index}`);
    home += simulation.game.summary.homePoints;
    away += simulation.game.summary.awayPoints;
    if (simulation.game.summary.winnerTeamId === input.human.teamId) homeWins += 1;
  }
  void mirror;
  return { home: home / count, away: away / count, winRate: homeWins / count };
}

const N = 240;
const plain = { ...locked, playoffPerformance: undefined };
const baseline = run(plain, N, false);
const adjusted = run(locked, N, false);
console.log('baseline ', baseline);
console.log('adjusted ', adjusted);
console.log('per-team points', {
  human: +(adjusted.home - baseline.home).toFixed(2),
  opponent: +(adjusted.away - baseline.away).toFixed(2),
  total: +(adjusted.home + adjusted.away - baseline.home - baseline.away).toFixed(2),
  winRate: +(adjusted.winRate - baseline.winRate).toFixed(3),
});

// Symmetric check: give both sides the same five pinned rows, then only the home side should
// move if the mapping were biased. Expect a near-zero net shift.
const symmetric = {
  ...locked,
  opponents: locked.opponents.map((entry) => ({
    ...entry,
    team: {
      ...entry.team,
      starters: entry.team.starters.map((starter, index) => {
        const humanStarter = locked.human.starters[index]!;
        return {
          ...starter,
          source: {
            ...starter.source,
            playerVersionId: humanStarter.source.playerVersionId,
            playerId: humanStarter.source.playerId,
            seasonKey: humanStarter.source.seasonKey,
          },
        };
      }),
      replacements: entry.team.replacements.map((replacement, index) => {
        const humanReplacement = locked.human.replacements[index]!;
        return {
          ...replacement,
          source: {
            ...replacement.source,
            playerVersionId: humanReplacement.source.playerVersionId,
            playerId: humanReplacement.source.playerId,
            seasonKey: humanReplacement.source.seasonKey,
          },
        };
      }),
    },
  })),
};
const mirrorPlain = { ...symmetric, playoffPerformance: undefined };
const mirrorBase = run(mirrorPlain, N, true);
const mirrorAdj = run(symmetric, N, true);
console.log('mirror baseline', mirrorBase);
console.log('mirror adjusted', mirrorAdj);
console.log('mirror delta', {
  total: +(mirrorAdj.home + mirrorAdj.away - mirrorBase.home - mirrorBase.away).toFixed(2),
  home: +(mirrorAdj.home - mirrorBase.home).toFixed(2),
  away: +(mirrorAdj.away - mirrorBase.away).toFixed(2),
});

// Confirm the rows were actually built from the same profiles both sides.
void capRushPlayoffPerformanceOf;
