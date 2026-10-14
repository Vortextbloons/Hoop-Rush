import { describe, expect, it } from 'vitest';
import type {
  HavocEvent,
  HavocScoringEntry,
  SimulationRatings,
  SimulationTendencies,
} from '@hoop-rush/data-contracts';
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

const FOUL_MAGNET: Partial<SimulationTendencies> = {
  ...HIGH_USAGE,
  usageRate: 20,
  shotRate: 30,
  foulRate: 20,
};

function scenarioSlot(
  slot: ScenarioSlot['slot'],
  mutations: ScenarioSlot['mutations'],
  overrides: Partial<ScenarioSlot> = {},
): ScenarioSlot {
  return { slot, mutations, ratings: RIM_ATTACK, tendencies: HIGH_USAGE, ...overrides };
}

function plainSlots(): ScenarioSlot[] {
  return [
    { slot: 'PG', mutations: [], ratings: RIM_ATTACK, tendencies: HIGH_USAGE },
    { slot: 'SG', mutations: [], ratings: RIM_ATTACK, tendencies: HIGH_USAGE },
    { slot: 'SF', mutations: [], ratings: RIM_ATTACK, tendencies: HIGH_USAGE },
    { slot: 'PF', mutations: [], ratings: RIM_ATTACK, tendencies: HIGH_USAGE },
    { slot: 'C', mutations: [], ratings: RIM_ATTACK, tendencies: HIGH_USAGE },
  ];
}

function humanSlotMutation(
  slot: ScenarioSlot['slot'],
  mutation: ScenarioSlot['mutations'][number],
): ScenarioSlot[] {
  return plainSlots().map((entry) =>
    entry.slot === slot ? scenarioSlot(slot, [mutation]) : entry,
  );
}

function eventsOf(run: ScenarioRun, kind: HavocEvent['kind']): HavocEvent[] {
  return run.tape.events.filter((event) => event.kind === kind);
}

function entryOf(run: ScenarioRun, sequence: number | null): HavocScoringEntry | undefined {
  if (sequence === null) return undefined;
  return run.tape.scoring.find((entry) => entry.sequence === sequence);
}

describe('havoc tier-2 rules', () => {
  it('cancels the first turnover of a half without an opposing steal', () => {
    const human = buildScenarioTeam('human', humanSlotMutation('PG', 'possession-refund'));
    const run = searchScenario(
      24,
      human,
      buildScenarioTeam('opponent', plainSlots()),
      (candidate) => candidate.tape.events.some((event) => event.kind === 'turnover-cancelled'),
    );
    expect(run, 'expected a canceled turnover').not.toBeNull();
    if (run === null) return;
    const cancellation = eventsOf(run, 'turnover-cancelled')[0];
    if (cancellation?.kind !== 'turnover-cancelled') throw new Error('missing cancellation');
    const turnover = run.tape.events.find(
      (event) => event.sequence === cancellation.originalSequence,
    );
    expect(turnover?.kind).toBe('turnover');
    const refund = eventsOf(run, 'possession-refund')[0];
    expect(refund?.kind).toBe('possession-refund');
    const after = run.tape.events.filter((event) => event.sequence > cancellation.sequence);
    const nextPossession = after.find((event) => event.kind === 'possession-start');
    const samePossessionEvents = after.filter(
      (event) =>
        event.kind !== 'possession-start' || event.possessionId === cancellation.possessionId,
    );
    expect(nextPossession).toBeDefined();
    expect(samePossessionEvents.length).toBeGreaterThan(0);
    const line = run.result.home.participants.find(
      (participant) => participant.instanceId === cancellation.playerInstanceId,
    );
    const officialTurnovers = run.tape.events.filter(
      (event) =>
        event.kind === 'turnover' &&
        event.playerInstanceId === cancellation.playerInstanceId &&
        !run.tape.events.some(
          (candidate2) =>
            candidate2.kind === 'turnover-cancelled' &&
            candidate2.originalSequence === event.sequence,
        ),
    ).length;
    expect(line?.turnovers).toBe(officialTurnovers);
  });

  it('grants and consumes a rebound-loop extra possession', () => {
    const human = buildScenarioTeam('human', humanSlotMutation('PG', 'rebound-loop'));
    const run = searchScenario(
      96,
      human,
      buildScenarioTeam('opponent', plainSlots()),
      (candidate) => candidate.tape.events.some((event) => event.kind === 'rebound-loop'),
    );
    expect(run, 'expected a rebound-loop grant').not.toBeNull();
    if (run === null) return;
    const loop = eventsOf(run, 'rebound-loop')[0];
    if (loop?.kind !== 'rebound-loop') throw new Error('missing rebound loop');
    expect(loop.reboundOrdinal % 4).toBe(0);
    expect(loop.granted).toBeGreaterThanOrEqual(1);
    const started = run.tape.events.find(
      (event) => event.kind === 'extra-possession' && event.outcome === 'started',
    );
    expect(started).toBeDefined();
    if (started?.kind === 'extra-possession' && started.possessionId !== null) {
      const possessionStart = run.tape.events.find(
        (event) => event.kind === 'possession-start' && event.possessionId === started.possessionId,
      );
      expect(possessionStart).toBeDefined();
      if (possessionStart?.kind === 'possession-start') {
        expect(possessionStart.offenseSide).toBe(started.side);
      }
    }
    expect(loop.ownerInstanceId).toBe(run.input.home.starters[0]?.instanceId);
  });

  it('grants two free throws on an and-one', () => {
    const human = buildScenarioTeam('human', humanSlotMutation('PG', 'and-one-machine'));
    const run = searchScenario(
      48,
      human,
      buildScenarioTeam('opponent', plainSlots()),
      (candidate) => candidate.tape.events.some((event) => event.kind === 'and-one-bonus'),
    );
    expect(run, 'expected an and-one').not.toBeNull();
    if (run === null) return;
    const bonus = eventsOf(run, 'and-one-bonus')[0];
    if (bonus?.kind !== 'and-one-bonus') throw new Error('missing and-one');
    expect(bonus.bonusFreeThrows).toBe(1);
    const foul = run.tape.events.find((event) => event.sequence === bonus.foulSequence);
    if (foul?.kind !== 'foul') throw new Error('missing foul');
    expect(foul.shooting).toBe(true);
    expect(foul.freeThrowsAwarded).toBe(2);
    const attempts = run.tape.events.filter(
      (event) =>
        event.kind === 'free-throw-attempt' &&
        event.shooterInstanceId === bonus.shooterInstanceId &&
        event.possessionId === foul.possessionId &&
        event.sequence > foul.sequence,
    );
    const firstTrip = attempts.slice(0, 2);
    expect(firstTrip.length).toBeGreaterThanOrEqual(2);
    expect(
      firstTrip.filter((event) => event.kind === 'free-throw-attempt' && event.bonus).length,
    ).toBe(1);
  });

  it('arms the bounty only on the highest-ranked opponent starter', () => {
    const blockerRatings: Partial<SimulationRatings> = {
      ...RIM_ATTACK,
      block: 99,
      interiorDefense: 99,
      vertical: 99,
      perimeterDefense: 40,
    };
    const human = buildScenarioTeam('human', [
      scenarioSlot('PG', ['the-bounty'], { ratings: blockerRatings }),
      ...plainSlots().slice(1),
    ]);
    const awaySlots: ScenarioSlot[] = plainSlots().map((entry, index) => ({
      ...entry,
      overall: index === 4 ? 99 : 70 + index,
    }));
    const away = buildScenarioTeam('opponent', awaySlots);
    const topTarget = away.starters.find((starter) => starter.source.originalOverall === 99);
    expect(topTarget).toBeDefined();
    const run = searchScenario(96, human, away, (candidate) =>
      candidate.tape.events.some((event) => event.kind === 'bounty' && event.outcome === 'armed'),
    );
    expect(run, 'expected a bounty arm').not.toBeNull();
    if (run === null) return;
    const armed = eventsOf(run, 'bounty').filter(
      (event) => event.kind === 'bounty' && event.outcome === 'armed',
    );
    for (const event of armed) {
      if (event.kind !== 'bounty') continue;
      expect(event.blockedInstanceId).toBe(topTarget?.instanceId);
    }
    const consumed = run.tape.events.find(
      (event) => event.kind === 'bounty' && event.outcome === 'consumed',
    );
    if (consumed?.kind === 'bounty') {
      const entry = entryOf(run, consumed.scoringSequence);
      expect(entry?.multipliers).toContainEqual({ source: 'the-bounty', factor: 3 });
    }
  });

  it('relieves charged fouls with foul thief without erasing history', () => {
    const human = buildScenarioTeam('human', humanSlotMutation('PG', 'foul-thief'));
    const run = searchScenario(
      96,
      human,
      buildScenarioTeam('opponent', plainSlots()),
      (candidate) => candidate.tape.events.some((event) => event.kind === 'foul-relief'),
    );
    expect(run, 'expected foul-thief relief').not.toBeNull();
    if (run === null) return;
    const relief = eventsOf(run, 'foul-relief')[0];
    if (relief?.kind !== 'foul-relief') throw new Error('missing relief');
    const drawn = run.tape.events.filter(
      (event, index) =>
        event.kind === 'foul' &&
        index < run.tape.events.indexOf(relief) &&
        event.shooting &&
        event.shooterInstanceId === relief.ownerInstanceId,
    );
    expect(drawn.length % 2).toBe(0);
    const line = run.result.home.participants.find(
      (participant) => participant.instanceId === relief.ownerInstanceId,
    );
    expect(line?.chargedFouls).toBeLessThanOrEqual(line?.fouls ?? 0);
  });
});

describe('havoc fouls and replacements', () => {
  it('replaces a six-foul starter and awards technical free throws afterwards', () => {
    const foulProne: Partial<SimulationTendencies> = { ...FOUL_MAGNET, foulRate: 20 };
    const humanSlots: ScenarioSlot[] = plainSlots().map((entry, index) =>
      index === 4
        ? scenarioSlot('C', [], {
            ratings: { ...RIM_ATTACK, strength: 99, interiorDefense: 99, defensiveIq: 10 },
            tendencies: foulProne,
          })
        : scenarioSlot(entry.slot, [], {
            ratings: { ...RIM_ATTACK, strength: 25, interiorDefense: 25, defensiveIq: 60 },
            tendencies: { ...entry.tendencies, foulRate: 0 },
          }),
    );
    const human = buildScenarioTeam('human', humanSlots);
    const away = buildScenarioTeam('opponent', plainSlots());
    const run = searchScenario(96, human, away, (candidate) =>
      candidate.tape.events.some(
        (event) =>
          event.kind === 'substitution' &&
          event.reason === 'foul-out' &&
          human.starters.some((starter) => starter.instanceId === event.outInstanceId),
      ),
    );
    expect(run, 'expected a six-foul substitution').not.toBeNull();
    if (run === null) return;
    const substitution = eventsOf(run, 'substitution').find(
      (event) =>
        event.kind === 'substitution' &&
        event.reason === 'foul-out' &&
        human.starters.some((starter) => starter.instanceId === event.outInstanceId),
    );
    if (substitution?.kind !== 'substitution') throw new Error('missing substitution');
    const replacement = run.input.home.replacements.find(
      (candidate) => candidate.instanceId === substitution.inInstanceId,
    );
    expect(replacement).toBeDefined();
    expect(replacement?.kind).toBe('replacement');
    expect(replacement?.ownerInstanceId).toBe(substitution.outInstanceId);
    const outLine = run.result.home.participants.find(
      (participant) => participant.instanceId === substitution.outInstanceId,
    );
    expect(outLine?.fouls).toBeGreaterThanOrEqual(6);
    const replacementLine = run.result.home.participants.find(
      (participant) => participant.instanceId === substitution.inInstanceId,
    );
    expect(replacementLine).toBeDefined();

    const technicalRun = searchScenario(
      160,
      human,
      away,
      (candidate) =>
        candidate.tape.events.some(
          (event) => event.kind === 'foul' && event.technicalFreeThrows === 1,
        ),
      'havoc-tech',
    );
    if (technicalRun !== null) {
      const technical = technicalRun.tape.events.find(
        (event) => event.kind === 'foul' && event.technicalFreeThrows === 1,
      );
      if (technical?.kind === 'foul') {
        const fouler = [
          ...technicalRun.input.home.starters,
          ...technicalRun.input.home.replacements,
          ...technicalRun.input.away.starters,
          ...technicalRun.input.away.replacements,
        ].find((participant) => participant.instanceId === technical.foulerInstanceId);
        expect(fouler?.kind).toBe('replacement');
      }
    }
  });
});

describe('havoc tier-3 rules', () => {
  it('runs clone army participants with independent identity', () => {
    const human = buildScenarioTeam('human', [
      scenarioSlot('PG', ['clone-army']),
      scenarioSlot('SG', ['clone-army']),
      ...plainSlots().slice(2),
    ]);
    const run = runScenario(human, buildScenarioTeam('opponent', plainSlots()), 'havoc-clones-0');
    const entered = run.tape.events.filter(
      (event) => event.kind === 'clone' && event.outcome === 'entered',
    );
    expect(entered.length).toBe(2);
    expect(run.result.home.participants.length).toBe(7);
    const clones = run.result.home.participants.filter((line) => line.kind === 'clone');
    expect(clones.length).toBe(2);
    for (const clone of clones) {
      expect(clone.ownerInstanceId).not.toBeNull();
      expect(clone.secondsPlayed).toBeGreaterThan(0);
    }
    const cloneInstances = new Set([
      ...run.result.home.participants.map((line) => line.instanceId),
      ...run.result.away.participants.map((line) => line.instanceId),
    ]);
    expect(cloneInstances.size).toBe(
      run.result.home.participants.length + run.result.away.participants.length,
    );
    for (const assist of run.tape.events) {
      if (assist.kind !== 'assist') continue;
      expect(assist.assisterInstanceId).not.toBe(assist.scorerInstanceId);
    }
  });

  it('applies time lord 30/12 clocks with real 12-second violations at fixture pace', () => {
    const human = buildScenarioTeam('human', humanSlotMutation('PG', 'time-lord'));
    const away = buildScenarioTeam('opponent', plainSlots());
    let violations = 0;
    let twelveSecondViolations = 0;
    for (let index = 0; index < 8; index += 1) {
      const run = runScenario(human, away, `havoc-time-${String(index)}`);
      const tipoffEvents = run.tape.events.filter(
        (event) => event.kind === 'time-lord' && event.source === 'tipoff',
      );
      expect(tipoffEvents.length).toBe(2);
      for (const event of tipoffEvents) {
        if (event.kind !== 'time-lord') continue;
        expect(event.fullSeconds).toBe(event.side === 'human' ? 30 : 12);
        expect(event.reboundSeconds).toBeLessThanOrEqual(event.fullSeconds);
      }
      for (const event of run.tape.events) {
        if (event.kind !== 'shot-clock-violation') continue;
        violations += 1;
        expect([12, 24, 30]).toContain(event.limitSeconds);
        if (event.limitSeconds === 12) twelveSecondViolations += 1;
      }
    }
    expect(twelveSecondViolations, 'expected the 12-second side to violate').toBeGreaterThan(0);
    expect(violations).toBeGreaterThanOrEqual(twelveSecondViolations);
  });

  it('turns shortened-clock possessions into rushed attempts instead of automatic violations', () => {
    const human = buildScenarioTeam('human', humanSlotMutation('PG', 'time-lord'));
    const away = buildScenarioTeam('opponent', plainSlots());
    const seeds = 8;
    let opponentAttempts = 0;
    let opponentViolations = 0;
    let opponentPoints = 0;
    for (let index = 0; index < seeds; index += 1) {
      const run = runScenario(human, away, `havoc-rush-${String(index)}`);
      for (const event of run.tape.events) {
        if (event.kind === 'shot-attempt' && event.side === 'opponent') opponentAttempts += 1;
        if (event.kind === 'shot-clock-violation' && event.limitSeconds === 12) {
          opponentViolations += 1;
        }
      }
      opponentPoints += run.result.away.points;
    }
    expect(opponentAttempts).toBeGreaterThan(opponentViolations * 4);
    expect(opponentPoints / seeds).toBeGreaterThan(50);
  });

  it('keeps shortened-clock outcomes healthy across pace profiles', () => {
    const human = buildScenarioTeam('human', humanSlotMutation('PG', 'time-lord'));
    const away = buildScenarioTeam('opponent', plainSlots());
    for (const pace of [92, 100, 108]) {
      let attempts = 0;
      let violations = 0;
      for (let index = 0; index < 6; index += 1) {
        const run = runScenario(
          human,
          away,
          `havoc-rush-pace-${String(pace)}-${String(index)}`,
          1,
          {
            pace,
          },
        );
        for (const event of run.tape.events) {
          if (event.kind === 'shot-attempt' && event.side === 'opponent') attempts += 1;
          if (event.kind === 'shot-clock-violation' && event.limitSeconds === 12) {
            violations += 1;
          }
        }
      }
      expect(attempts, `pace ${String(pace)}`).toBeGreaterThan(violations);
    }
  });

  it('applies and ends body snatcher without retargeting', () => {
    const ownerTendencies: Partial<SimulationTendencies> = { ...FOUL_MAGNET, foulRate: 20 };
    const human = buildScenarioTeam('human', [
      scenarioSlot('PG', ['body-snatcher'], { tendencies: ownerTendencies }),
      ...plainSlots().slice(1),
    ]);
    const awaySlots: ScenarioSlot[] = plainSlots().map((entry, index) => ({
      ...entry,
      overall: index === 4 ? 95 : 70 + index,
    }));
    const away = buildScenarioTeam('opponent', awaySlots);
    const run = searchScenario(96, human, away, (candidate) =>
      candidate.tape.events.some(
        (event) => event.kind === 'body-snatcher' && event.outcome === 'applied',
      ),
    );
    expect(run, 'expected a body snatcher application').not.toBeNull();
    if (run === null) return;
    const applied = eventsOf(run, 'body-snatcher').filter(
      (event) => event.kind === 'body-snatcher' && event.outcome === 'applied',
    );
    expect(applied.length).toBe(1);
    const firstApplied = applied[0];
    if (firstApplied?.kind !== 'body-snatcher') throw new Error('missing applied event');
    const target = away.starters.find((starter) => starter.source.originalOverall === 95);
    expect(firstApplied.targetInstanceId).toBe(target?.instanceId);
    const targetId = firstApplied.targetInstanceId;
    const targetReplaced = run.tape.events.some(
      (event) => event.kind === 'substitution' && event.outInstanceId === targetId,
    );
    if (targetReplaced) {
      expect(
        run.tape.events.filter(
          (event) => event.kind === 'body-snatcher' && event.outcome === 'applied',
        ).length,
      ).toBe(1);
    }
    const ownerExited = run.tape.events.some(
      (event) =>
        event.kind === 'substitution' && event.outInstanceId === firstApplied.ownerInstanceId,
    );
    if (ownerExited) {
      expect(
        run.tape.events.some(
          (event) => event.kind === 'body-snatcher' && event.outcome === 'ended',
        ),
      ).toBe(true);
    }
  });

  it('caps opponents with the great equalizer but never teammates', () => {
    const human = buildScenarioTeam('human', humanSlotMutation('PG', 'the-great-equalizer'));
    const away = buildScenarioTeam('opponent', plainSlots());
    const run = runScenario(human, away, 'havoc-equalizer');
    const applied = run.tape.events.find(
      (event) => event.kind === 'great-equalizer' && event.outcome === 'applied',
    );
    expect(applied).toBeDefined();
    if (applied?.kind !== 'great-equalizer') throw new Error('missing equalizer');
    const opponentStarters = new Set(away.starters.map((starter) => starter.instanceId));
    for (const capped of applied.cappedInstanceIds) {
      expect(opponentStarters.has(capped)).toBe(true);
    }
    const teammateIds = new Set(run.input.home.starters.map((starter) => starter.instanceId));
    for (const capped of applied.cappedInstanceIds) {
      expect(teammateIds.has(capped)).toBe(false);
    }
  });
});

describe('havoc overtime and free throws', () => {
  it('plays overtime periods with powers preserved', () => {
    const human = buildScenarioTeam('human', humanSlotMutation('PG', 'the-great-equalizer'));
    const away = buildScenarioTeam('opponent', plainSlots());
    const run = searchScenario(
      384,
      human,
      away,
      (candidate) => candidate.result.overtimePeriods > 0,
      'havoc-ot',
    );
    expect(run, 'expected an overtime game').not.toBeNull();
    if (run === null) return;
    expect(run.result.home.periods.length).toBe(4 + run.result.overtimePeriods);
    expect(run.result.away.periods.length).toBe(4 + run.result.overtimePeriods);
    expect(run.result.home.points).not.toBe(run.result.away.points);
    const otPeriod = run.result.home.periods.length;
    const otEntries = run.tape.scoring.filter((entry) => entry.period === otPeriod);
    expect(otEntries.length).toBeGreaterThan(0);
  });

  it('penalizes misses by one under double or nothing without doubling free throws', () => {
    const human = buildScenarioTeam('human', [
      scenarioSlot('PG', ['double-or-nothing']),
      ...plainSlots().slice(1),
    ]);
    const run = searchScenario(
      24,
      human,
      buildScenarioTeam('opponent', plainSlots()),
      (candidate) =>
        candidate.tape.scoring.some(
          (entry) =>
            entry.kind === 'adjustment' &&
            entry.addends.some(
              (addend) => addend.source === 'double-or-nothing' && addend.points === -1,
            ),
        ),
    );
    expect(run, 'expected a double-or-nothing penalty').not.toBeNull();
    if (run === null) return;
    const missed = run.tape.scoring.find(
      (entry) =>
        entry.kind === 'adjustment' &&
        entry.addends.some(
          (addend) => addend.source === 'double-or-nothing' && addend.points === -1,
        ),
    );
    expect(missed?.points).toBe(-1);
    for (const entry of run.tape.scoring) {
      if (entry.kind !== 'free-throw') continue;
      expect(entry.points).toBe(1);
      expect(entry.multipliers).toEqual([]);
    }
  });

  it('grants the opponent an extra free throw on double or nothing fouls', () => {
    const human = buildScenarioTeam('human', humanSlotMutation('PG', 'double-or-nothing'));
    const ownerInstanceId = human.starters[0]?.instanceId ?? '';
    const run = searchScenario(
      48,
      human,
      buildScenarioTeam('opponent', plainSlots()),
      (candidate) => candidate.tape.events.some((event) => event.kind === 'double-or-nothing-foul'),
    );
    expect(run, 'expected a double or nothing foul gift').not.toBeNull();
    if (run === null) return;
    const gifts = eventsOf(run, 'double-or-nothing-foul');
    expect(gifts.length).toBeGreaterThan(0);
    for (const gift of gifts) {
      if (gift.kind !== 'double-or-nothing-foul') continue;
      expect(gift.ownerInstanceId).toBe(ownerInstanceId);
      expect(gift.freeThrowsGranted).toBe(1);
      const foul = run.tape.events.find((event) => event.sequence === gift.foulSequence);
      if (foul?.kind !== 'foul') throw new Error('missing foul');
      expect(foul.side).toBe(gift.side);
      const attempts = run.tape.events.filter(
        (event) =>
          event.kind === 'free-throw-attempt' &&
          event.side !== foul.side &&
          event.possessionId === foul.possessionId &&
          event.sequence > foul.sequence,
      );
      expect(attempts.length).toBeGreaterThanOrEqual(
        foul.freeThrowsAwarded + foul.technicalFreeThrows + 1,
      );
    }
  });

  it('records a four-point dunk without double or nothing', () => {
    const human = buildScenarioTeam('human', [
      scenarioSlot('PG', ['four-point-dunk']),
      scenarioSlot('SG', ['reverse-basketball']),
      ...plainSlots().slice(2),
    ]);
    const run = searchScenario(
      48,
      human,
      buildScenarioTeam('opponent', plainSlots()),
      (candidate) => candidate.tape.events.some((event) => event.kind === 'four-point-dunk'),
    );
    expect(run, 'expected a four-point dunk scenario').not.toBeNull();
    if (run === null) return;
    const event = eventsOf(run, 'four-point-dunk')[0];
    if (event?.kind !== 'four-point-dunk') throw new Error('missing dunk');
    const entry = entryOf(run, event.scoringSequence);
    expect(entry?.points).toBe(4);
    expect(entry?.multipliers).toEqual([]);
  });
});

describe('havoc team-wide powers and physical mechanisms', () => {
  it('applies a repeated team-wide power once with a coalesced owner list', () => {
    const human = buildScenarioTeam('human', [
      scenarioSlot('PG', ['double-or-nothing']),
      scenarioSlot('SG', ['double-or-nothing']),
      ...plainSlots().slice(2),
    ]);
    const away = buildScenarioTeam('opponent', plainSlots());
    const run = searchScenario(8, human, away, (candidate) =>
      candidate.tape.scoring.some(
        (entry) =>
          entry.kind === 'field-goal' &&
          entry.multipliers.some((multiplier) => multiplier.source === 'double-or-nothing'),
      ),
    );
    expect(run, 'expected a doubled field goal').not.toBeNull();
    if (run === null) return;
    const doubled = run.tape.scoring.find(
      (entry) =>
        entry.kind === 'field-goal' &&
        entry.multipliers.some((multiplier) => multiplier.source === 'double-or-nothing'),
    );
    expect(doubled).toBeDefined();
    if (doubled === undefined) return;
    expect(
      doubled.multipliers.filter((multiplier) => multiplier.source === 'double-or-nothing').length,
    ).toBe(1);
    expect(doubled.owners.length).toBe(2);
  });

  it('keeps a team-wide power active while another owner remains', () => {
    const foulProne: Partial<SimulationTendencies> = { ...FOUL_MAGNET, foulRate: 20 };
    const human = buildScenarioTeam('human', [
      scenarioSlot('PG', ['double-or-nothing'], {
        ratings: { ...RIM_ATTACK, strength: 99, interiorDefense: 99, defensiveIq: 10 },
        tendencies: foulProne,
      }),
      scenarioSlot('SG', ['double-or-nothing']),
      ...plainSlots().slice(2),
    ]);
    const away = buildScenarioTeam('opponent', plainSlots());
    const pgInstanceId = human.starters[0]?.instanceId ?? '';
    const run = searchScenario(96, human, away, (candidate) => {
      const substitution = candidate.tape.events.find(
        (event) => event.kind === 'substitution' && event.outInstanceId === pgInstanceId,
      );
      if (substitution === undefined) return false;
      return candidate.tape.scoring.some(
        (entry) =>
          entry.multipliers.some((multiplier) => multiplier.source === 'double-or-nothing') &&
          entry.originalEventSequence !== null &&
          entry.originalEventSequence > substitution.sequence,
      );
    });
    expect(run, 'expected a game where one double owner exits').not.toBeNull();
    if (run === null) return;
    const substitution = run.tape.events.find(
      (event) => event.kind === 'substitution' && event.outInstanceId === pgInstanceId,
    );
    if (substitution === undefined) return;
    const laterEntries = run.tape.scoring.filter(
      (entry) =>
        entry.multipliers.some((multiplier) => multiplier.source === 'double-or-nothing') &&
        entry.originalEventSequence !== null &&
        entry.originalEventSequence > substitution.sequence,
    );
    expect(laterEntries.length).toBeGreaterThan(0);
    for (const entry of laterEntries) {
      expect(entry.owners).not.toContain(pgInstanceId);
    }
  });

  it('changes simulation outcomes when runtime mechanisms are active', () => {
    const away = buildScenarioTeam('opponent', plainSlots());
    const without = buildScenarioTeam('human', plainSlots());
    const cases: Array<{
      label: string;
      build: () => ReturnType<typeof buildScenarioTeam>;
    }> = [
      {
        label: 'body-snatcher',
        build: () =>
          buildScenarioTeam('human', [
            scenarioSlot('PG', ['body-snatcher']),
            ...plainSlots().slice(1),
          ]),
      },
      {
        label: 'the-great-equalizer',
        build: () =>
          buildScenarioTeam('human', [
            scenarioSlot('PG', ['the-great-equalizer']),
            ...plainSlots().slice(1),
          ]),
      },
      {
        label: 'time-lord',
        build: () =>
          buildScenarioTeam('human', [scenarioSlot('PG', ['time-lord']), ...plainSlots().slice(1)]),
      },
      {
        label: 'clone-army',
        build: () =>
          buildScenarioTeam('human', [
            scenarioSlot('PG', ['clone-army']),
            ...plainSlots().slice(1),
          ]),
      },
      {
        label: 'reach',
        build: () =>
          buildScenarioTeam(
            'human',
            plainSlots().map((entry) => ({
              ...entry,
              physical: { reachUnits: 2, wingspanDeltaInches: 18 },
            })),
          ),
      },
      {
        label: 'height',
        build: () =>
          buildScenarioTeam(
            'human',
            plainSlots().map((entry) => ({ ...entry, physical: { heightInches: 86 } })),
          ),
      },
    ];
    for (const scenario of cases) {
      let differed = false;
      for (let seedIndex = 0; seedIndex < 4 && !differed; seedIndex += 1) {
        const seed = `havoc-mechanism-${scenario.label}-${String(seedIndex)}`;
        const withMechanism = runScenario(scenario.build(), away, seed);
        const baseline = runScenario(without, away, seed);
        if (withMechanism.tapeDigest !== baseline.tapeDigest) differed = true;
      }
      expect(differed, `${scenario.label} did not change the simulation`).toBe(true);
    }
  });
});
