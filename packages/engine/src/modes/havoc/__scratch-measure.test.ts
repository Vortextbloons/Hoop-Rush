import { it } from 'vitest';
import {
  buildHavocGameInput as buildFixtureGameInput,
  buildHavocLockedInputs,
} from '@hoop-rush/test-fixtures';
import { buildHavocGameInput } from './input.ts';
import { createEngineContext } from '../../sim/kernel.ts';
import { simulateHavocGame } from './game.ts';
import { havocGameResultDigest, havocGameTapeDigest } from './digests.ts';
import { buildScenarioTeam, runScenario, type ScenarioSlot } from './runtime-test-support.ts';
import type { SimulationRatings, SimulationTendencies } from '@hoop-rush/data-contracts';

const RIM_ATTACK: Partial<SimulationRatings> = {
  insideScoring: 99,
  closeShot: 95,
  midrange: 80,
  threePoint: 55,
  freeThrow: 90,
  ballHandling: 95,
  passing: 75,
  offensiveIq: 90,
  offensiveRebound: 90,
  defensiveRebound: 60,
  perimeterDefense: 70,
  interiorDefense: 60,
  steal: 65,
  block: 55,
  defensiveIq: 70,
  speed: 99,
  strength: 85,
  vertical: 99,
};

const HIGH_USAGE: Partial<SimulationTendencies> = {
  usageRate: 45,
  shotRate: 99,
  driveRate: 95,
  rimFrequency: 100,
  shortMidFrequency: 35,
  longMidFrequency: 5,
  cornerThreeFrequency: 5,
  aboveBreakThreeFrequency: 5,
  threePointRate: 10,
  freeThrowRate: 95,
  turnoverRate: 35,
  isolationRate: 45,
  pickAndRollBallHandlerRate: 40,
  pickAndRollRollManRate: 20,
  spotUpRate: 10,
  transitionRate: 30,
  cutRate: 20,
  foulRate: 35,
  stealAttemptRate: 15,
  blockAttemptRate: 10,
  crashOffensiveGlassRate: 95,
  passRate: 5,
};

function scenarioSlot(
  slot: ScenarioSlot['slot'],
  mutations: ScenarioSlot['mutations'],
): ScenarioSlot {
  return { slot, mutations, ratings: RIM_ATTACK, tendencies: HIGH_USAGE };
}

function plainSlots(): ScenarioSlot[] {
  return (['PG', 'SG', 'SF', 'PF', 'C'] as const).map((slot) => ({
    slot,
    mutations: [],
    ratings: RIM_ATTACK,
    tendencies: HIGH_USAGE,
  }));
}

it('scratch havoc measure', () => {
  const context = createEngineContext();
  const fixture = simulateHavocGame(buildFixtureGameInput(), context);
  console.log('DEFAULT_RESULT', havocGameResultDigest(fixture.result));
  console.log('DEFAULT_TAPE', havocGameTapeDigest(fixture.tape));
  const locked = buildHavocLockedInputs();
  const hv = simulateHavocGame(
    buildHavocGameInput({ locked, gameNumber: 1, variant: 'havoc' }),
    context,
  );
  const nm = simulateHavocGame(
    buildHavocGameInput({ locked, gameNumber: 1, variant: 'normal' }),
    context,
  );
  console.log('LOCKED_HAVOC_RESULT', havocGameResultDigest(hv.result));
  console.log('LOCKED_HAVOC_TAPE', havocGameTapeDigest(hv.tape));
  console.log('LOCKED_NORMAL_RESULT', havocGameResultDigest(nm.result));
  console.log('LOCKED_NORMAL_TAPE', havocGameTapeDigest(nm.tape));

  const cloneHuman = buildScenarioTeam('human', [
    scenarioSlot('PG', ['clone-army']),
    scenarioSlot('SG', ['clone-army']),
    ...plainSlots().slice(2),
  ]);
  const cloneAway = buildScenarioTeam('opponent', plainSlots());
  const cloneRun = runScenario(cloneHuman, cloneAway, 'havoc-clones');
  for (const line of cloneRun.result.home.participants) {
    console.log(
      'PART',
      line.kind,
      line.instanceId.slice(0, 14),
      'owner=' + String(line.ownerInstanceId?.slice(0, 14)),
      'secs=' + String(Math.round(line.secondsPlayed)),
    );
  }
  console.log('AWAY_PARTS', cloneRun.result.away.participants.length);
  const cloneLengths = new Map<number, number>();
  for (let i = 0; i < 24; i += 1) {
    const r = runScenario(cloneHuman, cloneAway, `havoc-clones-${String(i)}`);
    const key = r.result.home.participants.length;
    cloneLengths.set(key, (cloneLengths.get(key) ?? 0) + 1);
  }
  console.log('CLONE_HOME_PARTS_DIST', JSON.stringify(Object.fromEntries(cloneLengths)));

  const mutations = (withPower: boolean): ScenarioSlot[] => [
    {
      slot: 'PG',
      mutations: withPower ? ['reverse-basketball'] : [],
      ratings: RIM_ATTACK,
      tendencies: HIGH_USAGE,
    },
    { slot: 'SG', mutations: [], ratings: RIM_ATTACK, tendencies: HIGH_USAGE },
    { slot: 'SF', mutations: [], ratings: RIM_ATTACK, tendencies: HIGH_USAGE },
    { slot: 'PF', mutations: [], ratings: RIM_ATTACK, tendencies: HIGH_USAGE },
    { slot: 'C', mutations: [], ratings: RIM_ATTACK, tendencies: HIGH_USAGE },
  ];
  const otHuman = buildScenarioTeam('human', mutations(true));
  const otAway = buildScenarioTeam('opponent', mutations(false));
  const n = 96;
  let otCount = 0;
  let totalMargin = 0;
  for (let i = 0; i < n; i += 1) {
    const r = runScenario(otHuman, otAway, `havoc-ot-${String(i)}`);
    if (r.result.overtimePeriods > 0) otCount += 1;
    totalMargin += Math.abs(r.result.home.points - r.result.away.points);
  }
  console.log(
    'OT_RATE',
    `${String(otCount)}/${String(n)}`,
    'AVG_MARGIN',
    (totalMargin / n).toFixed(1),
  );
});
