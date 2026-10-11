import { it } from 'vitest';
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

it('scratch havoc seed search', () => {
  const cloneHuman = buildScenarioTeam('human', [
    scenarioSlot('PG', ['clone-army']),
    scenarioSlot('SG', ['clone-army']),
    ...plainSlots().slice(2),
  ]);
  const cloneAway = buildScenarioTeam('opponent', plainSlots());
  const cleanClones: string[] = [];
  for (let i = 0; i < 60 && cleanClones.length < 5; i += 1) {
    const seed = i === 0 ? 'havoc-clones' : `havoc-clones-${String(i - 1)}`;
    const r = runScenario(cloneHuman, cloneAway, seed);
    const entered = r.tape.events.filter(
      (event) => event.kind === 'clone' && event.outcome === 'entered',
    );
    const clones = r.result.home.participants.filter((line) => line.kind === 'clone');
    if (r.result.home.participants.length === 7 && entered.length === 2 && clones.length === 2) {
      cleanClones.push(seed);
    }
  }
  console.log('CLEAN_CLONE_SEEDS', JSON.stringify(cleanClones));

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
  const eqMutations = (): ScenarioSlot[] => {
    const slots = plainSlots();
    const pg = slots[0];
    if (pg === undefined) throw new Error('missing pg');
    slots[0] = { ...pg, mutations: ['the-great-equalizer'] };
    return slots;
  };
  const otHuman = buildScenarioTeam('human', eqMutations());
  const otAway = buildScenarioTeam('opponent', plainSlots());
  const n = 384;
  let otCount = 0;
  let firstOt = -1;
  let totalMargin = 0;
  for (let i = 0; i < n; i += 1) {
    const r = runScenario(otHuman, otAway, `havoc-ot-${String(i)}`);
    if (r.result.overtimePeriods > 0) {
      otCount += 1;
      if (firstOt < 0) firstOt = i;
    }
    totalMargin += Math.abs(r.result.home.points - r.result.away.points);
  }
  console.log(
    'EQUALIZER_OT_RATE',
    `${String(otCount)}/${String(n)}`,
    'FIRST_OT_INDEX',
    String(firstOt),
    'AVG_MARGIN',
    (totalMargin / n).toFixed(1),
  );
});
