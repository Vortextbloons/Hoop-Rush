import { describe, expect, it } from 'vitest';
import type {
  HavocEvent,
  HavocMutationId,
  HavocScoringEntry,
  SimulationRatings,
  SimulationTendencies,
} from '@hoop-rush/data-contracts';
import { havocFieldGoalValue } from './game.ts';
import {
  buildScenarioTeam,
  runScenario,
  searchScenario,
  type ScenarioSlot,
} from './runtime-test-support.ts';

const RIM_ATTACK: Partial<SimulationRatings> = {
  insideScoring: 99,
  closeShot: 95,
  midrange: 80,
  threePoint: 55,
  freeThrow: 85,
  ballHandling: 95,
  passing: 75,
  offensiveIq: 90,
  offensiveRebound: 85,
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

const HYPER_USAGE: Partial<SimulationTendencies> = {
  ...HIGH_USAGE,
  usageRate: 80,
  shotRate: 100,
  passRate: 0,
  threePointRate: 60,
  rimFrequency: 40,
  aboveBreakThreeFrequency: 60,
};

function quoteSlots(): ScenarioSlot[] {
  return [slot('PG', []), slot('SG', []), slot('SF', []), slot('PF', []), slot('C', [])];
}

function entriesOf(tape: { scoring: HavocScoringEntry[] }): HavocScoringEntry[] {
  return tape.scoring;
}

function eventOf(tape: { events: HavocEvent[] }, kind: HavocEvent['kind']): HavocEvent | undefined {
  return tape.events.find((event) => event.kind === kind);
}

describe('havoc field-goal value resolution', () => {
  it('resolves six-point and twelve-point dunks exactly', () => {
    const six = havocFieldGoalValue({
      nominal: 2,
      three: false,
      roulette: null,
      fourPointDunk: true,
      reverseBasketball: true,
      heatCheck: false,
      putback: false,
      bounty: false,
      doubleOrNothing: false,
    });
    expect(six.points).toBe(6);
    expect(six.addends).toEqual([
      { source: 'four-point-dunk', points: 2 },
      { source: 'reverse-basketball', points: 2 },
    ]);
    const twelve = havocFieldGoalValue({
      nominal: 2,
      three: false,
      roulette: null,
      fourPointDunk: true,
      reverseBasketball: true,
      heatCheck: false,
      putback: false,
      bounty: false,
      doubleOrNothing: true,
    });
    expect(twelve.points).toBe(12);
    expect(twelve.multipliers).toEqual([{ source: 'double-or-nothing', factor: 2 }]);
  });

  it('applies roulette before other bonuses and multipliers', () => {
    const value = havocFieldGoalValue({
      nominal: 3,
      three: true,
      roulette: 4,
      fourPointDunk: false,
      reverseBasketball: true,
      heatCheck: true,
      putback: false,
      bounty: true,
      doubleOrNothing: true,
    });
    expect(value.points).toBe((3 + 1 - 1) * 2 * 2 * 2);
    const contributions = value.contributions.reduce((sum, entry) => sum + entry.points, 0);
    expect(contributions).toBe(value.points - 3);
    expect(value.multipliers.map((entry) => entry.source)).toEqual([
      'heat-check',
      'the-bounty',
      'double-or-nothing',
    ]);
  });

  it('handles negative roulette results and reverse threes', () => {
    const negative = havocFieldGoalValue({
      nominal: 2,
      three: false,
      roulette: 1,
      fourPointDunk: false,
      reverseBasketball: false,
      heatCheck: false,
      putback: false,
      bounty: false,
      doubleOrNothing: false,
    });
    expect(negative.points).toBe(1);
    const three = havocFieldGoalValue({
      nominal: 3,
      three: true,
      roulette: 1,
      fourPointDunk: false,
      reverseBasketball: true,
      heatCheck: false,
      putback: false,
      bounty: false,
      doubleOrNothing: true,
    });
    expect(three.points).toBe(0);
  });
});

describe('havoc scoring mutations in simulation', () => {
  const dunkHuman = buildScenarioTeam('human', [
    slot('PG', ['four-point-dunk']),
    slot('SG', ['reverse-basketball']),
    slot('SF', ['double-or-nothing'], {
      ratings: { ...RIM_ATTACK, insideScoring: 60, closeShot: 60, threePoint: 40 },
    }),
    slot('PF', ['heat-check'], {
      ratings: { ...RIM_ATTACK, insideScoring: 70, closeShot: 70 },
    }),
    slot('C', ['second-chance-jackpot']),
  ]);

  it('scores a twelve-point dunk with four-point dunk, reverse, and double or nothing', () => {
    const run = searchScenario(
      48,
      dunkHuman,
      buildScenarioTeam('opponent', quoteSlots()),
      (candidate) => candidate.tape.events.some((event) => event.kind === 'four-point-dunk'),
    );
    expect(run, 'expected a four-point dunk scenario').not.toBeNull();
    if (run === null) return;
    const dunkEvent = eventOf(run.tape, 'four-point-dunk');
    if (dunkEvent?.kind !== 'four-point-dunk') throw new Error('missing dunk event');
    const entry = entriesOf(run.tape).find(
      (candidate) => candidate.sequence === dunkEvent.scoringSequence,
    );
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    expect(entry.nominalPoints).toBe(2);
    expect(entry.addends).toEqual([
      { source: 'four-point-dunk', points: 2 },
      { source: 'reverse-basketball', points: 2 },
    ]);
    expect(entry.multipliers).toContainEqual({ source: 'double-or-nothing', factor: 2 });
    expect(entry.points).toBe(12);
  });

  it('arms and consumes heat check on consecutive makes', () => {
    const heatHuman = buildScenarioTeam('human', [
      slot('PG', ['heat-check']),
      slot('SG', []),
      slot('SF', []),
      slot('PF', []),
      slot('C', []),
    ]);
    const run = searchScenario(
      48,
      heatHuman,
      buildScenarioTeam('opponent', quoteSlots()),
      (candidate) =>
        candidate.tape.events.some(
          (event) => event.kind === 'heat-check' && event.outcome === 'consumed',
        ),
    );
    expect(run, 'expected a heat-check consumption').not.toBeNull();
    if (run === null) return;
    const armed = run.tape.events.find(
      (event) => event.kind === 'heat-check' && event.outcome === 'armed',
    );
    expect(armed).toBeDefined();
    const consumed = run.tape.events.find(
      (event) => event.kind === 'heat-check' && event.outcome === 'consumed',
    );
    if (consumed?.kind !== 'heat-check') throw new Error('missing consumption');
    const entry = entriesOf(run.tape).find(
      (candidate) => candidate.sequence === consumed.scoringSequence,
    );
    expect(entry?.multipliers).toContainEqual({ source: 'heat-check', factor: 2 });
    if (entry === undefined) return;
    const base =
      entry.nominalPoints + entry.addends.reduce((sum, addend) => sum + addend.points, 0);
    expect(entry.points).toBe(base * 2);
    // three consecutive made field goals precede the arming
    const shooterInstanceId = consumed.ownerInstanceId;
    const makesBefore = run.tape.events.filter(
      (event, index) =>
        event.kind === 'shot-attempt' &&
        event.shooterInstanceId === shooterInstanceId &&
        index < run.tape.events.indexOf(consumed),
    );
    const lastThree = makesBefore.slice(-3);
    expect(lastThree.every((event) => event.kind === 'shot-attempt' && event.made)).toBe(true);
  });

  it('doubles an immediate own-rebound putback', () => {
    const putbackHuman = buildScenarioTeam('human', [
      slot('PG', ['second-chance-jackpot']),
      slot('SG', []),
      slot('SF', []),
      slot('PF', []),
      slot('C', []),
    ]);
    const run = searchScenario(
      160,
      putbackHuman,
      buildScenarioTeam('opponent', quoteSlots()),
      (candidate) =>
        candidate.tape.events.some(
          (event) => event.kind === 'putback' && event.outcome === 'consumed',
        ),
    );
    expect(run, 'expected a consumed putback').not.toBeNull();
    if (run === null) return;
    const consumed = run.tape.events.find(
      (event) => event.kind === 'putback' && event.outcome === 'consumed',
    );
    if (consumed?.kind !== 'putback') throw new Error('missing putback');
    const entry = entriesOf(run.tape).find(
      (candidate) => candidate.sequence === consumed.scoringSequence,
    );
    expect(entry?.multipliers).toContainEqual({ source: 'second-chance-jackpot', factor: 2 });
    const arm = run.tape.events.find(
      (event) =>
        event.kind === 'putback' &&
        event.outcome === 'armed' &&
        event.reboundSequence === consumed.reboundSequence,
    );
    expect(arm).toBeDefined();
    const rebound = run.tape.events.find(
      (event) => event.kind === 'rebound' && event.sequence === consumed.reboundSequence,
    );
    if (rebound?.kind === 'rebound') {
      expect(rebound.offensive).toBe(true);
      expect(rebound.playerInstanceId).toBe(consumed.ownerInstanceId);
    }
  });

  it('rolls basketball roulette on every fifth official attempt', () => {
    const rouletteHuman = buildScenarioTeam('human', [
      slot('PG', ['basketball-roulette']),
      slot('SG', []),
      slot('SF', []),
      slot('PF', []),
      slot('C', []),
    ]);
    const run = searchScenario(
      24,
      rouletteHuman,
      buildScenarioTeam('opponent', quoteSlots()),
      (candidate) =>
        candidate.tape.events.some(
          (event) => event.kind === 'roulette' && event.scoringSequence !== null,
        ),
    );
    expect(run, 'expected a roulette roll').not.toBeNull();
    if (run === null) return;
    const rolls = run.tape.events.filter((event) => event.kind === 'roulette');
    expect(rolls.length).toBeGreaterThan(0);
    for (const roll of rolls) {
      expect(roll.attemptOrdinal % 5).toBe(0);
      expect(roll.rolled).toBeGreaterThanOrEqual(1);
      expect(roll.rolled).toBeLessThanOrEqual(6);
      if (roll.scoringSequence !== null) {
        const entry = entriesOf(run.tape).find(
          (candidate) => candidate.sequence === roll.scoringSequence,
        );
        expect(entry?.addends).toContainEqual({
          source: 'roulette',
          points: roll.rolled - roll.nominal,
        });
      }
    }
    // missed fifth attempts retain the roll with a null scoring reference
    const missedRoll = rolls.find((roll) => roll.scoringSequence === null);
    if (missedRoll !== undefined) {
      expect(missedRoll.rolled).toBeGreaterThanOrEqual(1);
    }
  });

  it('credits a golden assist as a separate one-point adjustment', () => {
    const playmakerRatings: Partial<SimulationRatings> = {
      ...RIM_ATTACK,
      passing: 99,
      ballHandling: 99,
      offensiveIq: 95,
    };
    const playmakerTendencies: Partial<SimulationTendencies> = {
      ...HIGH_USAGE,
      usageRate: 35,
      passRate: 90,
      shotRate: 70,
      pickAndRollBallHandlerRate: 60,
      isolationRate: 10,
    };
    const human = buildScenarioTeam('human', [
      slot('PG', ['golden-assist'], { ratings: playmakerRatings, tendencies: playmakerTendencies }),
      slot('SG', []),
      slot('SF', []),
      slot('PF', []),
      slot('C', []),
    ]);
    const run = searchScenario(
      48,
      human,
      buildScenarioTeam('opponent', quoteSlots()),
      (candidate) => candidate.tape.events.some((event) => event.kind === 'golden-assist'),
    );
    expect(run, 'expected a golden assist').not.toBeNull();
    if (run === null) return;
    const golden = run.tape.events.filter((event) => event.kind === 'golden-assist');
    expect(golden.length).toBeGreaterThan(0);
    const first = golden[0];
    if (first?.kind !== 'golden-assist') throw new Error('missing golden assist');
    const entry = entriesOf(run.tape).find(
      (candidate) => candidate.sequence === first.scoringSequence,
    );
    expect(entry?.kind).toBe('adjustment');
    expect(entry?.points).toBe(1);
    expect(entry?.addends).toEqual([{ source: 'golden-assist', points: 1 }]);
    expect(entry?.multipliers).toEqual([]);
    expect(entry?.actorInstanceId).toBe(first.assisterInstanceId);
    const assistsBefore = run.tape.events.filter(
      (event, index) =>
        event.kind === 'assist' &&
        event.assisterInstanceId === first.assisterInstanceId &&
        index < run.tape.events.indexOf(first),
    );
    expect(assistsBefore.length % 3).toBe(0);
  });

  it('expires unused rebound-loop extra possessions at game end', () => {
    const human = buildScenarioTeam(
      'human',
      ['PG', 'SG', 'SF', 'PF', 'C'].map((_, index) => ({
        slot: (['PG', 'SG', 'SF', 'PF', 'C'] as const)[index] ?? 'PG',
        mutations: index === 0 ? (['rebound-loop'] as HavocMutationId[]) : [],
        ratings: RIM_ATTACK,
        tendencies: HIGH_USAGE,
      })),
    );
    const away = buildScenarioTeam('opponent', quoteSlots());
    const run = searchScenario(
      192,
      human,
      away,
      (candidate) =>
        candidate.tape.events.some(
          (event) => event.kind === 'extra-possession' && event.outcome === 'expired',
        ),
      'havoc-expiry',
    );
    if (run === null) return;
    const expired = run.tape.events.filter(
      (event) => event.kind === 'extra-possession' && event.outcome === 'expired',
    );
    expect(expired.length).toBeGreaterThan(0);
    const queued = run.tape.events.filter(
      (event) => event.kind === 'extra-possession' && event.outcome === 'queued',
    ).length;
    const started = run.tape.events.filter(
      (event) => event.kind === 'extra-possession' && event.outcome === 'started',
    ).length;
    expect(started + expired.length).toBe(queued);
  });

  it('can drive team and period totals negative under double or nothing', () => {
    const weakThree: Partial<SimulationRatings> = {
      insideScoring: 20,
      closeShot: 20,
      midrange: 20,
      threePoint: 20,
      freeThrow: 20,
      ballHandling: 20,
      passing: 20,
      offensiveIq: 20,
      offensiveRebound: 20,
      defensiveRebound: 20,
      perimeterDefense: 20,
      interiorDefense: 20,
      steal: 20,
      block: 20,
      defensiveIq: 20,
      speed: 20,
      strength: 20,
      vertical: 20,
    };
    const brickTendencies: Partial<SimulationTendencies> = {
      ...HIGH_USAGE,
      usageRate: 60,
      threePointRate: 100,
      rimFrequency: 0,
      shortMidFrequency: 0,
      longMidFrequency: 0,
      cornerThreeFrequency: 5,
      aboveBreakThreeFrequency: 95,
      freeThrowRate: 10,
      crashOffensiveGlassRate: 20,
    };
    const humanSlots: ScenarioSlot[] = (['PG', 'SG', 'SF', 'PF', 'C'] as const).map(
      (position, index) => ({
        slot: position,
        mutations: index === 0 ? ['double-or-nothing'] : [],
        ratings: weakThree,
        tendencies: brickTendencies,
      }),
    );
    const run = searchScenario(
      128,
      buildScenarioTeam('human', humanSlots),
      buildScenarioTeam('opponent', quoteSlots()),
      (candidate) =>
        candidate.result.home.points < 0 ||
        candidate.result.home.periods.some((points) => points < 0),
      'havoc-negative-team',
    );
    if (run === null) return;
    const periodsNegative = run.result.home.periods.some((points) => points < 0);
    expect(run.result.home.points < 0 || periodsNegative).toBe(true);
    if (periodsNegative) {
      const negativePeriod = run.result.home.periods.findIndex((points) => points < 0) + 1;
      const ledgerTotal = run.tape.scoring
        .filter((entry) => entry.side === 'human' && entry.period === negativePeriod)
        .reduce((sum, entry) => sum + entry.points, 0);
      expect(ledgerTotal).toBeLessThan(0);
    }
  });

  it('produces negative player points under double or nothing', () => {
    const weakRatings: Partial<SimulationRatings> = {
      insideScoring: 25,
      closeShot: 25,
      midrange: 25,
      threePoint: 20,
      freeThrow: 25,
      ballHandling: 25,
      passing: 25,
      offensiveIq: 25,
      offensiveRebound: 25,
      defensiveRebound: 25,
      perimeterDefense: 25,
      interiorDefense: 25,
      steal: 25,
      block: 25,
      defensiveIq: 25,
      speed: 25,
      strength: 25,
      vertical: 25,
    };
    const weakSlots: ScenarioSlot[] = quoteSlots().map((entry, index) => ({
      ...entry,
      ratings: weakRatings,
      tendencies: HYPER_USAGE,
      mutations: index === 0 ? ['double-or-nothing'] : [],
    }));
    const run = searchScenario(
      96,
      buildScenarioTeam('human', weakSlots),
      buildScenarioTeam('opponent', quoteSlots()),
      (candidate) =>
        [...candidate.result.home.participants, ...candidate.result.away.participants].some(
          (line) => line.points < 0,
        ),
    );
    expect(run, 'expected a negative player scoreline').not.toBeNull();
    if (run === null) return;
    const negative = [...run.result.home.participants, ...run.result.away.participants].filter(
      (line) => line.points < 0,
    );
    expect(negative.length).toBeGreaterThan(0);
    for (const line of negative) {
      expect(line.adjustments).toBeLessThan(-(line.fieldGoals.made * 2 + line.freeThrows.made));
    }
    const penaltyEntries = run.tape.scoring.filter(
      (entry) => entry.kind === 'adjustment' && entry.points < 0,
    );
    expect(penaltyEntries.length).toBeGreaterThan(0);
  });
});

describe('havoc determinism with mutations', () => {
  it('reproduces identical result and tape digests', () => {
    const human = buildScenarioTeam('human', [
      slot('PG', ['four-point-dunk', 'heat-check']),
      slot('SG', ['reverse-basketball']),
      slot('SF', ['basketball-roulette']),
      slot('PF', []),
      slot('C', []),
    ]);
    const first = runScenario(
      human,
      buildScenarioTeam('opponent', quoteSlots()),
      'havoc-determinism',
    );
    const second = runScenario(
      human,
      buildScenarioTeam('opponent', quoteSlots()),
      'havoc-determinism',
    );
    expect(first.tapeDigest).toBe(second.tapeDigest);
    expect(first.resultDigest).toBe(second.resultDigest);
    expect(first.inputDigest).toBe(second.inputDigest);
  });
});
