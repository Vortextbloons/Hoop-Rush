import { describe, expect, it } from 'bun:test';
import type {
  HavocEvent,
  HavocScoringEntry,
  SimulationRatings,
  SimulationTendencies,
} from '@hoop-rush/data-contracts';
import { SIMULATION_RATINGS, SIMULATION_TENDENCIES } from '@hoop-rush/data-contracts';
import { applyHavocMutationPackage } from './transform.ts';
import { buildHavocSourcePlayer } from '@hoop-rush/test-fixtures';
import {
  buildScenarioTeam,
  runScenario,
  searchScenario,
  type ScenarioRun,
  type ScenarioSlot,
} from './runtime-test-support.ts';

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
  freeThrowRate: 90,
  turnoverRate: 22,
  isolationRate: 45,
  pickAndRollBallHandlerRate: 40,
  pickAndRollRollManRate: 20,
  spotUpRate: 10,
  transitionRate: 30,
  cutRate: 20,
  foulRate: 35,
  stealAttemptRate: 15,
  blockAttemptRate: 10,
  crashOffensiveGlassRate: 90,
  passRate: 5,
};

function slot(
  position: ScenarioSlot['slot'],
  mutations: ScenarioSlot['mutations'],
  overrides: Partial<ScenarioSlot> = {},
): ScenarioSlot {
  return { slot: position, mutations, ratings: RIM_ATTACK, tendencies: HIGH_USAGE, ...overrides };
}

function plainSlots(): ScenarioSlot[] {
  return [slot('PG', []), slot('SG', []), slot('SF', []), slot('PF', []), slot('C', [])];
}

function sourceWith(
  overrides: {
    ratings?: Partial<SimulationRatings>;
    tendencies?: Partial<SimulationTendencies>;
  } = {},
) {
  return buildHavocSourcePlayer({
    profile: {
      ratings: { ...SIMULATION_RATINGS, ...overrides.ratings },
      tendencies: { ...SIMULATION_TENDENCIES, ...overrides.tendencies },
    },
    physical: { heightInches: 76, weightLbs: 200 },
  });
}

function eventsOf(run: ScenarioRun, kind: HavocEvent['kind']): HavocEvent[] {
  return run.tape.events.filter((event) => event.kind === kind);
}

function entryOf(run: ScenarioRun, sequence: number | null): HavocScoringEntry | undefined {
  if (sequence === null) return undefined;
  return run.tape.scoring.find((entry) => entry.sequence === sequence);
}

describe('new tier-1 mutations', () => {
  it('adds 35 to every scoring rating and lifts shot and usage rate for Glass Cannon', () => {
    const source = sourceWith({ ratings: { speed: 88 } });
    const effective = applyHavocMutationPackage(source, [{ mutationId: 'glass-cannon' }]);
    for (const field of [
      'insideScoring',
      'closeShot',
      'midrange',
      'threePoint',
      'freeThrow',
    ] as const) {
      expect(effective.ratings[field], field).toBe(
        Math.min(100, source.profile.ratings[field] + 35),
      );
    }
    for (const field of [
      'perimeterDefense',
      'interiorDefense',
      'steal',
      'block',
      'defensiveIq',
    ] as const) {
      expect(effective.ratings[field], field).toBe(20);
    }
    expect(effective.tendencies.shotRate).toBe(
      Math.min(100, source.profile.tendencies.shotRate + 45),
    );
    expect(effective.tendencies.usageRate).toBe(
      Math.min(100, source.profile.tendencies.usageRate + 35),
    );
    expect(effective.ratings.speed).toBe(88);
  });

  it('turns The Pacifist into a non-shooter with elite vision', () => {
    const effective = applyHavocMutationPackage(sourceWith(), [{ mutationId: 'the-pacifist' }]);
    expect(effective.ratings.passing).toBe(99);
    expect(effective.ratings.offensiveIq).toBe(99);
    expect(effective.ratings.defensiveIq).toBe(99);
    expect(effective.ratings.offensiveRebound).toBe(90);
    expect(effective.ratings.defensiveRebound).toBe(90);
    expect(effective.tendencies.passRate).toBe(99);
    expect(effective.tendencies.shotRate).toBe(0);
    for (const field of [
      'insideScoring',
      'closeShot',
      'midrange',
      'threePoint',
      'freeThrow',
    ] as const) {
      expect(effective.ratings[field], field).toBeLessThanOrEqual(40);
    }
  });

  it('adds height and perimeter skill but strips strength and glass from Paper Giant', () => {
    const source = sourceWith();
    const effective = applyHavocMutationPackage(source, [{ mutationId: 'paper-giant' }]);
    expect(effective.physical.heightInches).toBe((source.physical.heightInches ?? 76) + 12);
    expect(effective.ratings.threePoint).toBe(
      Math.min(100, source.profile.ratings.threePoint + 30),
    );
    expect(effective.ratings.ballHandling).toBe(
      Math.min(100, source.profile.ratings.ballHandling + 25),
    );
    expect(effective.ratings.strength).toBe(Math.max(0, source.profile.ratings.strength - 35));
    expect(effective.ratings.offensiveRebound).toBe(
      Math.max(0, source.profile.ratings.offensiveRebound - 30),
    );
    expect(effective.ratings.defensiveRebound).toBe(
      Math.max(0, source.profile.ratings.defensiveRebound - 30),
    );
    expect(effective.tendencies.threePointRate).toBe(
      Math.min(100, source.profile.tendencies.threePointRate + 30),
    );
  });
});

describe('cold blooded runtime', () => {
  const away = buildScenarioTeam('opponent', plainSlots());

  it('converts a miss streak into a capped bonus on the next make', () => {
    const human = buildScenarioTeam('human', [
      slot('PG', ['cold-blooded']),
      ...plainSlots().slice(1),
    ]);
    const run = searchScenario(
      96,
      human,
      away,
      (candidate) => {
        const owners = candidate.tape.scoring.filter((entry) =>
          entry.addends.some((addend) => addend.source === 'cold-blooded' && addend.points > 0),
        );
        return owners.length > 0;
      },
      'havoc-cold-blooded',
    );
    expect(run, 'expected a cold blooded payout').not.toBeNull();
    if (run === null) return;
    const payouts = run.tape.scoring.filter((entry) =>
      entry.addends.some((addend) => addend.source === 'cold-blooded' && addend.points > 0),
    );
    const consumed = eventsOf(run, 'cold-blooded').filter(
      (event) => event.kind === 'cold-blooded' && event.outcome === 'consumed',
    );
    expect(consumed.length).toBeGreaterThan(0);
    for (const event of consumed) {
      if (event.kind !== 'cold-blooded') continue;
      expect(event.missStreak).toBeGreaterThan(0);
      expect(event.missStreak).toBeLessThanOrEqual(5);
      const entry = entryOf(run, event.scoringSequence);
      expect(entry?.addends).toContainEqual({
        source: 'cold-blooded',
        points: Math.min(5, event.missStreak),
      });
    }
    expect(payouts.length).toBeGreaterThan(0);
  });

  it('awards the opponent a point on every second consecutive miss', () => {
    const human = buildScenarioTeam('human', [
      slot('PG', ['cold-blooded']),
      ...plainSlots().slice(1),
    ]);
    const run = searchScenario(
      96,
      human,
      away,
      (candidate) =>
        candidate.tape.events.some(
          (event) => event.kind === 'cold-blooded' && event.outcome === 'penalty',
        ),
      'havoc-cold-blooded-penalty',
    );
    expect(run, 'expected a cold blooded penalty').not.toBeNull();
    if (run === null) return;
    for (const event of eventsOf(run, 'cold-blooded')) {
      if (event.kind !== 'cold-blooded' || event.outcome !== 'penalty') continue;
      expect(event.missStreak % 2).toBe(0);
      const entry = entryOf(run, event.scoringSequence);
      expect(entry?.kind).toBe('bonus');
      expect(entry?.points).toBe(1);
      expect(entry?.side).toBe('opponent');
    }
    expect(run.result.away.teamBonusPoints).toBeGreaterThan(0);
  });
});

describe('triple threat runtime', () => {
  const away = buildScenarioTeam('opponent', plainSlots());

  it('earns six bonus points for a rim, midrange, and three in one quarter', () => {
    const human = buildScenarioTeam(
      'human',
      plainSlots().map((entry, index) =>
        index === 0
          ? slot('PG', ['triple-threat'], {
              ratings: { ...RIM_ATTACK, threePoint: 95, midrange: 95 },
              tendencies: {
                ...HIGH_USAGE,
                rimFrequency: 35,
                shortMidFrequency: 30,
                longMidFrequency: 25,
                threePointRate: 40,
                aboveBreakThreeFrequency: 45,
                cornerThreeFrequency: 40,
              },
            })
          : entry,
      ),
    );
    const run = searchScenario(
      128,
      human,
      away,
      (candidate) =>
        candidate.tape.events.some(
          (event) => event.kind === 'triple-threat' && event.outcome === 'earned',
        ),
      'havoc-triple-threat',
    );
    expect(run, 'expected an earned triple threat').not.toBeNull();
    if (run === null) return;
    const earned = eventsOf(run, 'triple-threat').filter(
      (event) => event.kind === 'triple-threat' && event.outcome === 'earned',
    );
    expect(earned.length).toBeGreaterThan(0);
    for (const event of earned) {
      if (event.kind !== 'triple-threat') continue;
      const entry = entryOf(run, event.scoringSequence);
      expect(entry?.addends).toContainEqual({ source: 'triple-threat', points: 6 });
    }
  });

  it('resets quarter progress on any missed field goal', () => {
    const human = buildScenarioTeam('human', [
      slot('PG', ['triple-threat']),
      ...plainSlots().slice(1),
    ]);
    const run = searchScenario(
      48,
      human,
      away,
      (candidate) =>
        candidate.tape.events.some(
          (event) => event.kind === 'triple-threat' && event.outcome === 'reset',
        ),
      'havoc-triple-threat-reset',
    );
    expect(run, 'expected a triple threat reset').not.toBeNull();
  });
});

describe('oops all centers runtime', () => {
  it('resizes all five starters and caps team speed, handling, and threes', () => {
    const human = buildScenarioTeam('human', [
      slot('PG', ['oops-all-centers']),
      ...plainSlots().slice(1),
    ]);
    const away = buildScenarioTeam('opponent', plainSlots());
    const run = runScenario(human, away, 'havoc-oops-all-centers');
    const applied = eventsOf(run, 'oops-all-centers');
    expect(applied).toHaveLength(1);
    const event = applied[0];
    if (event?.kind !== 'oops-all-centers') throw new Error('missing oops all centers');
    expect(event.resizedInstanceIds).toHaveLength(5);
    const lines = run.result.home.participants.filter((line) => line.kind === 'starter');
    expect(lines).toHaveLength(5);
  });
});

describe('hostile takeover runtime', () => {
  it("swaps the lowest teammate's ratings with the opponent's best starter", () => {
    const human = buildScenarioTeam('human', [
      slot('PG', ['hostile-takeover'], { overall: 70 }),
      slot('SG', [], { overall: 95 }),
      ...plainSlots().slice(2),
    ]);
    const away = buildScenarioTeam('opponent', [
      slot('PG', [], { overall: 60, ratings: { ...RIM_ATTACK, threePoint: 99 } }),
      slot('SG', [], { overall: 92 }),
      slot('SF', [], { overall: 90 }),
      slot('PF', [], { overall: 85 }),
      slot('C', [], { overall: 80 }),
    ]);
    const run = runScenario(human, away, 'havoc-hostile-takeover');
    const applied = eventsOf(run, 'hostile-takeover');
    expect(applied).toHaveLength(1);
    const event = applied[0];
    if (event?.kind !== 'hostile-takeover') throw new Error('missing hostile takeover');
    expect(event.fromInstanceId).toBe(human.starters[0]?.instanceId as string);
    expect(event.toInstanceId).toBe(away.starters[1]?.instanceId as string);
  });
});
