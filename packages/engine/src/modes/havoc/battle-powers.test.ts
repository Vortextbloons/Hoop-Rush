import { describe, expect, it } from 'vitest';
import type {
  HavocBattleEvent,
  HavocBattleInput,
  HavocTeamInput,
  Position,
  Seed,
  SimulationRatings,
  SimulationTendencies,
} from '@hoop-rush/data-contracts';
import { havocBattleInputSchema, seedFromString, seedSchema } from '@hoop-rush/data-contracts';
import { buildHavocLockedInputs } from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../../sim/kernel.ts';
import { auditHavocBattleGame } from './core/battle-audit.ts';
import { havocBattleGameResultDigest, havocBattleGameTapeDigest } from './core/battle-digests.ts';
import { simulateHavocBattleGame } from './core/battle-game.ts';
import { havocBattleCapabilityTargets } from './core/battle-targets.ts';
import { buildHavocGameInput } from './input.ts';
import { buildScenarioTeam, type ScenarioSlot } from './runtime-test-support.ts';

/**
 * Two-sided opposing-power semantics on the neutral battle contracts. Every
 * scenario relabels the `buildScenarioTeam` human/opponent teams to home/away
 * and parses the result with `havocBattleInputSchema`, exactly like
 * `battle-runtime.test.ts`.
 */

type BattleSimulation = ReturnType<typeof simulateHavocBattleGame>;

interface BattleRun {
  input: HavocBattleInput;
  result: BattleSimulation['result'];
  tape: BattleSimulation['tape'];
  audit: ReturnType<typeof auditHavocBattleGame>;
}

interface SeedHit {
  index: number;
  seed: Seed;
  run: BattleRun;
}

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

/** Draws most of a side's defensive fouls so a chosen player fouls out early. */
const FOUL_MAGNET_RATINGS: Partial<SimulationRatings> = {
  ...RIM_ATTACK,
  strength: 99,
  interiorDefense: 99,
};

const FOUL_MAGNET: Partial<SimulationTendencies> = { ...HIGH_USAGE, foulRate: 20 };

/** Barely commits fouls so a chosen player survives the whole game. */
const QUIET_RATINGS: Partial<SimulationRatings> = {
  ...RIM_ATTACK,
  strength: 25,
  interiorDefense: 25,
};

const QUIET_TENDENCIES: Partial<SimulationTendencies> = { ...HIGH_USAGE, foulRate: 0 };

const BLOCKER_RATINGS: Partial<SimulationRatings> = {
  ...RIM_ATTACK,
  block: 99,
  interiorDefense: 99,
  vertical: 99,
  perimeterDefense: 40,
};

function slot(
  name: Position,
  mutations: ScenarioSlot['mutations'],
  overrides: Partial<ScenarioSlot> = {},
): ScenarioSlot {
  return { slot: name, mutations, ratings: RIM_ATTACK, tendencies: HIGH_USAGE, ...overrides };
}

function plainSlots(): ScenarioSlot[] {
  return (['PG', 'SG', 'SF', 'PF', 'C'] as const).map((name) => slot(name, []));
}

function magnetSlot(
  name: Position,
  mutations: ScenarioSlot['mutations'] = [],
  overrides: Partial<ScenarioSlot> = {},
): ScenarioSlot {
  return slot(name, mutations, {
    ratings: FOUL_MAGNET_RATINGS,
    tendencies: FOUL_MAGNET,
    ...overrides,
  });
}

function quietSlot(
  name: Position,
  mutations: ScenarioSlot['mutations'] = [],
  overrides: Partial<ScenarioSlot> = {},
): ScenarioSlot {
  return slot(name, mutations, {
    ratings: QUIET_RATINGS,
    tendencies: QUIET_TENDENCIES,
    ...overrides,
  });
}

function battleInput(home: HavocTeamInput, away: HavocTeamInput, seed: Seed): HavocBattleInput {
  const locked = buildHavocLockedInputs();
  const base = buildHavocGameInput({ locked, gameNumber: 1, variant: 'havoc' });
  return havocBattleInputSchema.parse({
    ...base,
    seed,
    home: { ...home, side: 'home' },
    away: { ...away, side: 'away' },
  });
}

function runBattle(input: HavocBattleInput): BattleRun {
  const simulation = simulateHavocBattleGame(input, createEngineContext());
  return {
    input,
    result: simulation.result,
    tape: simulation.tape,
    audit: auditHavocBattleGame(input, simulation.result, simulation.tape),
  };
}

function eventsOf<K extends HavocBattleEvent['kind']>(
  run: BattleRun,
  kind: K,
): Array<Extract<HavocBattleEvent, { kind: K }>> {
  return run.tape.events.filter(
    (event): event is Extract<HavocBattleEvent, { kind: K }> => event.kind === kind,
  );
}

function searchSeeds(
  label: string,
  maxSeeds: number,
  build: (seed: Seed) => HavocBattleInput,
  predicate: (run: BattleRun) => boolean,
): SeedHit | null {
  for (let index = 0; index < maxSeeds; index += 1) {
    const seed = seedSchema.parse(seedFromString(`${label}-${String(index)}`));
    const run = runBattle(build(seed));
    if (predicate(run)) return { index, seed, run };
  }
  return null;
}

function starterIds(team: HavocTeamInput): string[] {
  return team.starters.map((starter) => starter.instanceId);
}

describe('havoc battle opposing powers', () => {
  it('runs opposing time lords: 30/30 tipoff, survivor stays 30, exiting side drops to 12', () => {
    const scenario = 'time-lord both';
    const home = buildScenarioTeam('human', [
      magnetSlot('PG', ['time-lord']),
      ...plainSlots().slice(1),
    ]);
    const away = buildScenarioTeam('opponent', [
      quietSlot('PG', ['time-lord']),
      ...plainSlots().slice(1),
    ]);
    const homeOwner = home.starters[0]?.instanceId ?? '';
    const awayOwner = away.starters[0]?.instanceId ?? '';

    const hit = searchSeeds(
      'battle-powers-time-lord-both',
      64,
      (seed) => battleInput(home, away, seed),
      (run) => {
        if (!run.audit.ok) return false;
        const tipoff = eventsOf(run, 'time-lord').filter((event) => event.source === 'tipoff');
        const exited = eventsOf(run, 'substitution').some(
          (event) => event.outInstanceId === homeOwner && event.reason === 'foul-out',
        );
        const awayExit = eventsOf(run, 'substitution').some(
          (event) => event.outInstanceId === awayOwner,
        );
        const dropped = eventsOf(run, 'time-lord').some(
          (event) =>
            event.side === 'home' && event.source === 'owner-exit' && event.fullSeconds === 12,
        );
        return (
          exited &&
          !awayExit &&
          dropped &&
          tipoff.length === 2 &&
          tipoff.every((event) => event.fullSeconds === 30)
        );
      },
    );
    expect(
      hit,
      `${scenario}: no seed within 64 produced a home owner foul-out with 30/30 tipoff and a 12-second drop`,
    ).not.toBeNull();
    if (hit === null) return;
    const { run, seed } = hit;

    const tipoff = eventsOf(run, 'time-lord').filter((event) => event.source === 'tipoff');
    expect(tipoff, `${scenario} seed ${seed} tipoff records`).toHaveLength(2);
    for (const side of ['home', 'away'] as const) {
      const record = tipoff.find((event) => event.side === side);
      expect(record?.fullSeconds, `${scenario} seed ${seed} ${side} tipoff clock`).toBe(30);
      expect(record?.reboundSeconds, `${scenario} seed ${seed} ${side} tipoff rebound clock`).toBe(
        14,
      );
    }

    const substitution = eventsOf(run, 'substitution').find(
      (event) => event.outInstanceId === homeOwner && event.reason === 'foul-out',
    );
    expect(substitution, `${scenario} seed ${seed} home owner foul-out`).toBeDefined();

    const exits = eventsOf(run, 'time-lord').filter((event) => event.source === 'owner-exit');
    expect(exits, `${scenario} seed ${seed} owner-exit records`).toHaveLength(1);
    const exit = exits[0];
    if (exit === undefined || substitution === undefined) {
      throw new Error(`${scenario} seed ${seed}: missing time-lord records`);
    }
    expect(exit.side, `${scenario} seed ${seed} exiting side`).toBe('home');
    expect(exit.fullSeconds, `${scenario} seed ${seed} exiting clock`).toBe(12);
    expect(exit.reboundSeconds, `${scenario} seed ${seed} exiting rebound clock`).toBe(12);
    expect(exit.sequence, `${scenario} seed ${seed} record ordering`).toBeGreaterThan(
      substitution.sequence,
    );
    expect(
      eventsOf(run, 'time-lord').some(
        (event) => event.side === 'away' && event.source === 'owner-exit',
      ),
      `${scenario} seed ${seed} surviving side stays 30`,
    ).toBe(false);
    expect(run.audit.findings, `${scenario} seed ${seed} audit`).toEqual([]);

    // The side-consistent audit rejects a tampered clock: the exiting side must
    // read 12 while the opposing owner is still active.
    const tampered = structuredClone(run.tape);
    const tamperedExit = tampered.events.find(
      (event): event is Extract<HavocBattleEvent, { kind: 'time-lord' }> =>
        event.kind === 'time-lord' && event.sequence === exit.sequence,
    );
    if (tamperedExit !== undefined) tamperedExit.fullSeconds = 30;
    expect(
      auditHavocBattleGame(run.input, run.result, tampered).findings.some(
        (finding) => finding.code === 'time-lord',
      ),
      `${scenario} seed ${seed} audit rejects a side-inconsistent exit clock`,
    ).toBe(true);
  });

  it('records the great equalizer separately per side and updates only the affected side', () => {
    const scenario = 'great-equalizer both';
    const home = buildScenarioTeam('human', [
      slot('PG', ['the-great-equalizer']),
      magnetSlot('SG'),
      ...plainSlots().slice(2),
    ]);
    const away = buildScenarioTeam('opponent', [
      quietSlot('PG', ['the-great-equalizer']),
      ...plainSlots().slice(1),
    ]);
    const homeOwner = home.starters[0]?.instanceId ?? '';
    const awayOwner = away.starters[0]?.instanceId ?? '';
    const homeSub = home.starters[1]?.instanceId ?? '';

    const hit = searchSeeds(
      'battle-powers-equalizer-both',
      64,
      (seed) => battleInput(home, away, seed),
      (run) => {
        if (!run.audit.ok) return false;
        const equalizer = eventsOf(run, 'great-equalizer');
        const applied = equalizer.filter((event) => event.outcome === 'applied');
        const updated = equalizer.filter((event) => event.outcome === 'updated');
        return (
          applied.length === 2 &&
          new Set(applied.map((event) => event.ownerInstanceId)).size === 2 &&
          updated.length === 1 &&
          updated[0]?.ownerInstanceId === awayOwner &&
          eventsOf(run, 'substitution').some(
            (event) => event.outInstanceId === homeSub && event.reason === 'foul-out',
          )
        );
      },
    );
    expect(
      hit,
      `${scenario}: no seed within 64 produced two tipoff records plus exactly one away-side update`,
    ).not.toBeNull();
    if (hit === null) return;
    const { run, seed } = hit;

    const equalizer = eventsOf(run, 'great-equalizer');
    const applied = equalizer.filter((event) => event.outcome === 'applied');
    const updated = equalizer.filter((event) => event.outcome === 'updated');
    expect(applied, `${scenario} seed ${seed} tipoff records`).toHaveLength(2);
    expect(updated, `${scenario} seed ${seed} update records`).toHaveLength(1);

    const homeRecord = applied.find((event) => event.ownerInstanceId === homeOwner);
    const awayRecord = applied.find((event) => event.ownerInstanceId === awayOwner);
    expect(homeRecord, `${scenario} seed ${seed} home owner record`).toBeDefined();
    expect(awayRecord, `${scenario} seed ${seed} away owner record`).toBeDefined();
    if (homeRecord === undefined || awayRecord === undefined) {
      throw new Error(`${scenario} seed ${seed}: missing equalizer records`);
    }
    expect([...homeRecord.cappedInstanceIds].sort(), `${scenario} seed ${seed} home caps`).toEqual(
      [...starterIds(away)].sort(),
    );
    expect([...awayRecord.cappedInstanceIds].sort(), `${scenario} seed ${seed} away caps`).toEqual(
      [...starterIds(home)].sort(),
    );

    const update = updated[0];
    if (update === undefined) throw new Error(`${scenario} seed ${seed}: missing update record`);
    expect(update.ownerInstanceId, `${scenario} seed ${seed} update owner`).toBe(awayOwner);
    const replacement = home.replacements.find(
      (candidate) => candidate.ownerInstanceId === homeSub,
    );
    expect(replacement, `${scenario} seed ${seed} home replacement`).toBeDefined();
    expect(
      update.cappedInstanceIds,
      `${scenario} seed ${seed} update contains the replacement`,
    ).toContain(replacement?.instanceId);
    expect(
      update.cappedInstanceIds,
      `${scenario} seed ${seed} update drops the substituted starter`,
    ).not.toContain(homeSub);

    const rollups = run.result.rollups.filter(
      (rollup) => rollup.mutationId === 'the-great-equalizer',
    );
    expect(rollups, `${scenario} seed ${seed} equalizer rollups`).toHaveLength(2);
    expect(
      rollups.find((rollup) => rollup.ownerInstanceId === homeOwner)?.triggers,
      `${scenario} seed ${seed} home owner triggers`,
    ).toBe(1);
    expect(
      rollups.find((rollup) => rollup.ownerInstanceId === awayOwner)?.triggers,
      `${scenario} seed ${seed} away owner triggers`,
    ).toBe(2);
    expect(run.audit.findings, `${scenario} seed ${seed} audit`).toEqual([]);
  });

  it('runs opposing clone armies: a foul-out removes only that side’s clone and never respawns', () => {
    const scenario = 'clone-army both';
    const home = buildScenarioTeam('human', [
      magnetSlot('PG', ['clone-army']),
      ...plainSlots().slice(1),
    ]);
    const awaySlots = plainSlots().map((entry) =>
      entry.slot === 'SG' ? quietSlot('SG', ['clone-army']) : entry,
    );
    const away = buildScenarioTeam('opponent', awaySlots);
    const homeOwner = home.starters[0]?.instanceId ?? '';
    const awayOwner = away.starters[1]?.instanceId ?? '';
    const homeClone =
      home.clones.find((clone) => clone.ownerInstanceId === homeOwner)?.instanceId ?? '';
    const awayClone =
      away.clones.find((clone) => clone.ownerInstanceId === awayOwner)?.instanceId ?? '';

    const hit = searchSeeds(
      'battle-powers-clone-both',
      64,
      (seed) => battleInput(home, away, seed),
      (run) => {
        if (!run.audit.ok) return false;
        const entered = eventsOf(run, 'clone').filter((event) => event.outcome === 'entered');
        const homeExit = eventsOf(run, 'clone').some(
          (event) =>
            event.outcome === 'exited' &&
            event.cloneInstanceId === homeClone &&
            event.reason === 'owner-exited',
        );
        const awayExit = eventsOf(run, 'clone').some(
          (event) => event.outcome === 'exited' && event.cloneInstanceId === awayClone,
        );
        return entered.length === 2 && homeExit && !awayExit;
      },
    );
    expect(
      hit,
      `${scenario}: no seed within 64 produced both clones entering and only the home clone exiting with the owner`,
    ).not.toBeNull();
    if (hit === null) return;
    const { run, seed } = hit;

    const entered = eventsOf(run, 'clone').filter((event) => event.outcome === 'entered');
    expect(entered, `${scenario} seed ${seed} entered clones`).toHaveLength(2);
    expect(
      new Set(entered.map((event) => event.side)),
      `${scenario} seed ${seed} both sides field clones`,
    ).toEqual(new Set(['home', 'away']));

    const homeEvents = eventsOf(run, 'clone').filter(
      (event) => event.cloneInstanceId === homeClone,
    );
    expect(
      homeEvents.map((event) => event.outcome),
      `${scenario} seed ${seed} home clone lifecycle`,
    ).toEqual(['entered', 'exited']);
    const exit = homeEvents[1];
    if (exit === undefined) {
      throw new Error(`${scenario} seed ${seed}: missing clone exit`);
    }
    expect(exit.reason, `${scenario} seed ${seed} home clone exit reason`).toBe('owner-exited');
    expect(
      eventsOf(run, 'substitution').some(
        (event) => event.outInstanceId === homeOwner && event.reason === 'foul-out',
      ),
      `${scenario} seed ${seed} home owner foul-out`,
    ).toBe(true);
    expect(
      eventsOf(run, 'clone')
        .filter((event) => event.cloneInstanceId === awayClone)
        .map((event) => event.outcome),
      `${scenario} seed ${seed} away clone lifecycle`,
    ).toEqual(['entered']);

    expect(
      run.result.home.participants.find((line) => line.instanceId === homeClone)?.kind,
      `${scenario} seed ${seed} home clone line`,
    ).toBe('clone');
    expect(
      run.result.away.participants.find((line) => line.instanceId === awayClone)?.kind,
      `${scenario} seed ${seed} away clone line`,
    ).toBe('clone');
    expect(run.audit.findings, `${scenario} seed ${seed} audit`).toEqual([]);
  });

  it('runs opposing bounties: each side arms its ranked target, consumes a triple, and expires on schedule', () => {
    const scenario = 'the-bounty both';
    const homeSlots: ScenarioSlot[] = [
      slot('PG', ['the-bounty'], { ratings: BLOCKER_RATINGS, overall: 80 }),
      slot('SG', [], { overall: 70 }),
      slot('SF', [], { overall: 65 }),
      slot('PF', [], { overall: 60 }),
      slot('C', [], { overall: 99 }),
    ];
    const awaySlots: ScenarioSlot[] = [
      slot('PG', ['the-bounty'], { ratings: BLOCKER_RATINGS, overall: 80 }),
      slot('SG', [], { overall: 70 }),
      slot('SF', [], { overall: 65 }),
      slot('PF', [], { overall: 60 }),
      slot('C', [], { overall: 99 }),
    ];
    const home = buildScenarioTeam('human', homeSlots);
    const away = buildScenarioTeam('opponent', awaySlots);
    const homeOwner = home.starters[0]?.instanceId ?? '';
    const awayOwner = away.starters[0]?.instanceId ?? '';

    const hit = searchSeeds(
      'battle-powers-bounty-both',
      64,
      (seed) => battleInput(home, away, seed),
      (run) => {
        if (!run.audit.ok) return false;
        const bounty = eventsOf(run, 'bounty');
        const targets = havocBattleCapabilityTargets(run.input).bounty;
        const armed = (ownerId: string, targetId: string | null): boolean =>
          targetId !== null &&
          bounty.some(
            (event) =>
              event.outcome === 'armed' &&
              event.ownerInstanceId === ownerId &&
              event.blockedInstanceId === targetId,
          );
        const consumed = (ownerId: string): boolean =>
          bounty.some((event) => event.outcome === 'consumed' && event.ownerInstanceId === ownerId);
        const tripled = (ownerId: string): boolean =>
          run.tape.scoring.some(
            (entry) =>
              entry.owners.includes(ownerId) &&
              entry.multipliers.some(
                (multiplier) => multiplier.source === 'the-bounty' && multiplier.factor === 3,
              ),
          );
        return (
          armed(homeOwner, targets[0]) &&
          armed(awayOwner, targets[1]) &&
          consumed(homeOwner) &&
          consumed(awayOwner) &&
          tripled(homeOwner) &&
          tripled(awayOwner)
        );
      },
    );
    expect(hit, `${scenario}: no seed within 64 produced arm+consume on both sides`).not.toBeNull();
    if (hit === null) return;
    const { run, seed } = hit;

    const targets = havocBattleCapabilityTargets(run.input);
    expect(targets.bounty[0], `${scenario} seed ${seed} home target ranking`).toBe(
      away.starters[4]?.instanceId,
    );
    expect(targets.bounty[1], `${scenario} seed ${seed} away target ranking`).toBe(
      home.starters[4]?.instanceId,
    );
    const bounty = eventsOf(run, 'bounty');
    for (const [ownerId, targetId] of [
      [homeOwner, targets.bounty[0]],
      [awayOwner, targets.bounty[1]],
    ] as const) {
      expect(
        bounty.some(
          (event) =>
            event.outcome === 'armed' &&
            event.ownerInstanceId === ownerId &&
            event.blockedInstanceId === targetId,
        ),
        `${scenario} seed ${seed} ${ownerId} armed on its frozen ranked target`,
      ).toBe(true);
      expect(
        bounty.some((event) => event.outcome === 'consumed' && event.ownerInstanceId === ownerId),
        `${scenario} seed ${seed} ${ownerId} consumed`,
      ).toBe(true);
      expect(
        run.tape.scoring.some(
          (entry) =>
            entry.owners.includes(ownerId) &&
            entry.multipliers.some(
              (multiplier) => multiplier.source === 'the-bounty' && multiplier.factor === 3,
            ),
        ),
        `${scenario} seed ${seed} ${ownerId} triple`,
      ).toBe(true);
    }
    expect(run.audit.findings, `${scenario} seed ${seed} audit`).toEqual([]);

    const expiry = searchSeeds(
      'battle-powers-bounty-expiry',
      24,
      (seed) => battleInput(home, away, seed),
      (candidate) =>
        candidate.audit.ok &&
        eventsOf(candidate, 'bounty').some((event) => event.outcome === 'expired'),
    );
    expect(expiry, `${scenario}: no seed within 24 produced a bounty expiry`).not.toBeNull();
    if (expiry === null) return;
    const expired = eventsOf(expiry.run, 'bounty').find((event) => event.outcome === 'expired');
    if (expired === undefined) throw new Error(`${scenario} seed ${expiry.seed}: missing expiry`);
    const armedBefore = eventsOf(expiry.run, 'bounty')
      .filter(
        (event) =>
          event.outcome === 'armed' &&
          event.ownerInstanceId === expired.ownerInstanceId &&
          event.sequence < expired.sequence,
      )
      .at(-1);
    expect(
      armedBefore,
      `${scenario} seed ${expiry.seed} expiry follows an arm for the same owner`,
    ).toBeDefined();
    if (armedBefore === undefined) return;
    const possessionsBetween = expiry.run.tape.events.filter(
      (event) =>
        event.kind === 'possession-start' &&
        event.sequence > armedBefore.sequence &&
        event.sequence < expired.sequence,
    ).length;
    expect(
      possessionsBetween,
      `${scenario} seed ${expiry.seed} expiry after the possession window`,
    ).toBeGreaterThanOrEqual(3);
  });

  it('runs opposing body snatchers with reciprocal swaps and immutable targets', () => {
    const scenario = 'body-snatcher both';
    const home = buildScenarioTeam('human', [
      quietSlot('PG', ['body-snatcher'], { overall: 99 }),
      quietSlot('SG', ['body-snatcher'], { overall: 80 }),
      quietSlot('SF', [], { overall: 70 }),
      quietSlot('PF', [], { overall: 65 }),
      quietSlot('C', [], { overall: 60 }),
    ]);
    const away = buildScenarioTeam('opponent', [
      magnetSlot('PG', ['body-snatcher'], { overall: 99 }),
      quietSlot('SG', ['body-snatcher'], { overall: 80 }),
      slot('SF', [], { overall: 70 }),
      slot('PF', [], { overall: 65 }),
      slot('C', [], { overall: 60 }),
    ]);
    const homeOwner = home.starters[0]?.instanceId ?? '';
    const homeSecond = home.starters[1]?.instanceId ?? '';
    const awayOwner = away.starters[0]?.instanceId ?? '';
    const awaySecond = away.starters[1]?.instanceId ?? '';

    const hit = searchSeeds(
      'battle-powers-body-snatcher-both',
      64,
      (seed) => battleInput(home, away, seed),
      (run) => {
        if (!run.audit.ok) return false;
        const applied = eventsOf(run, 'body-snatcher').filter(
          (event) => event.outcome === 'applied',
        );
        const expected = havocBattleCapabilityTargets(run.input).bodySnatcher;
        if (applied.length !== expected.size) return false;
        for (const event of applied) {
          if (expected.get(event.ownerInstanceId) !== event.targetInstanceId) return false;
        }
        const ended = eventsOf(run, 'body-snatcher').filter((event) => event.outcome === 'ended');
        const endedEvent = ended[0];
        return (
          ended.length === 1 &&
          endedEvent !== undefined &&
          endedEvent.ownerInstanceId === homeOwner &&
          endedEvent.targetInstanceId === awayOwner &&
          eventsOf(run, 'substitution').some(
            (event) => event.outInstanceId === homeOwner && event.reason === 'foul-out',
          )
        );
      },
    );
    expect(
      hit,
      `${scenario}: no seed within 64 produced per-team assignments plus a single home owner exit`,
    ).not.toBeNull();
    if (hit === null) return;
    const { run, seed } = hit;

    const applied = eventsOf(run, 'body-snatcher').filter((event) => event.outcome === 'applied');
    expect(applied, `${scenario} seed ${seed} applied assignments`).toHaveLength(4);
    const expected = new Map<string, string>([
      [homeOwner, awayOwner],
      [homeSecond, awaySecond],
      [awayOwner, homeOwner],
      [awaySecond, homeSecond],
    ]);
    for (const [ownerId, targetId] of expected) {
      const event = applied.find((candidate) => candidate.ownerInstanceId === ownerId);
      expect(event?.targetInstanceId, `${scenario} seed ${seed} ${ownerId} assignment`).toBe(
        targetId,
      );
    }
    // Reciprocal A<->B with A also a target: its outgoing assignment exists and
    // its own source-profile precedence is exercised by the shared runtime path.
    expect(
      applied.some(
        (event) => event.ownerInstanceId === homeOwner && event.targetInstanceId === awayOwner,
      ),
      `${scenario} seed ${seed} home outgoing`,
    ).toBe(true);
    expect(
      applied.some(
        (event) => event.ownerInstanceId === awayOwner && event.targetInstanceId === homeOwner,
      ),
      `${scenario} seed ${seed} away reciprocal`,
    ).toBe(true);
    expect(
      applied.some((event) => event.targetInstanceId === homeOwner),
      `${scenario} seed ${seed} home owner is also a target`,
    ).toBe(true);

    const ended = eventsOf(run, 'body-snatcher').filter((event) => event.outcome === 'ended');
    expect(ended, `${scenario} seed ${seed} ended assignments`).toHaveLength(1);
    expect(ended[0]?.ownerInstanceId, `${scenario} seed ${seed} ended owner`).toBe(homeOwner);
    expect(ended[0]?.targetInstanceId, `${scenario} seed ${seed} ended target`).toBe(awayOwner);
    expect(
      eventsOf(run, 'body-snatcher').some(
        (event) => event.outcome === 'ended' && event.ownerInstanceId === awayOwner,
      ),
      `${scenario} seed ${seed} away assignment survives`,
    ).toBe(false);

    const replacement = home.replacements.find(
      (candidate) => candidate.ownerInstanceId === homeOwner,
    );
    expect(replacement, `${scenario} seed ${seed} home owner replacement`).toBeDefined();
    expect(
      eventsOf(run, 'body-snatcher').some(
        (event) => event.targetInstanceId === replacement?.instanceId,
      ),
      `${scenario} seed ${seed} replacement never becomes a target`,
    ).toBe(false);
    expect(
      eventsOf(run, 'body-snatcher').filter((event) => event.outcome === 'applied'),
      `${scenario} seed ${seed} no re-application after the exit`,
    ).toHaveLength(4);
    expect(run.audit.findings, `${scenario} seed ${seed} audit`).toEqual([]);
  });

  it('runs opposing fusion dances: each team pairs independently and one exit ends only its own', () => {
    const scenario = 'fusion-dance both';
    const homeSlots: ScenarioSlot[] = [
      magnetSlot('PG', ['fusion-dance'], { overall: 80 }),
      slot('SG', [], { overall: 70 }),
      slot('SF', [], { overall: 90 }),
      slot('PF', [], { overall: 85 }),
      slot('C', [], { overall: 75 }),
    ];
    const awaySlots: ScenarioSlot[] = [
      quietSlot('PG', ['fusion-dance'], { overall: 80 }),
      slot('SG', [], { overall: 70 }),
      slot('SF', [], { overall: 90 }),
      slot('PF', [], { overall: 85 }),
      slot('C', [], { overall: 75 }),
    ];
    const home = buildScenarioTeam('human', homeSlots);
    const away = buildScenarioTeam('opponent', awaySlots);
    const homeOwner = home.starters[0]?.instanceId ?? '';
    const homeDonor = home.starters[2]?.instanceId ?? '';
    const awayOwner = away.starters[0]?.instanceId ?? '';
    const awayDonor = away.starters[2]?.instanceId ?? '';

    const hit = searchSeeds(
      'battle-powers-fusion-both',
      64,
      (seed) => battleInput(home, away, seed),
      (run) => {
        if (!run.audit.ok) return false;
        const applied = eventsOf(run, 'fusion-dance').filter(
          (event) => event.outcome === 'applied',
        );
        const ended = eventsOf(run, 'fusion-dance').filter((event) => event.outcome === 'ended');
        return (
          applied.length === 2 &&
          applied.some(
            (event) => event.ownerInstanceId === homeOwner && event.donorInstanceId === homeDonor,
          ) &&
          applied.some(
            (event) => event.ownerInstanceId === awayOwner && event.donorInstanceId === awayDonor,
          ) &&
          ended.length === 1 &&
          ended[0]?.ownerInstanceId === homeOwner &&
          eventsOf(run, 'substitution').some(
            (event) => event.outInstanceId === homeOwner && event.reason === 'foul-out',
          )
        );
      },
    );
    expect(
      hit,
      `${scenario}: no seed within 64 produced both pairings plus a single home owner exit`,
    ).not.toBeNull();
    if (hit === null) return;
    const { run, seed } = hit;

    const applied = eventsOf(run, 'fusion-dance').filter((event) => event.outcome === 'applied');
    expect(applied, `${scenario} seed ${seed} applied pairings`).toHaveLength(2);
    const homePairing = applied.find((event) => event.ownerInstanceId === homeOwner);
    const awayPairing = applied.find((event) => event.ownerInstanceId === awayOwner);
    expect(homePairing?.donorInstanceId, `${scenario} seed ${seed} home donor`).toBe(homeDonor);
    expect(awayPairing?.donorInstanceId, `${scenario} seed ${seed} away donor`).toBe(awayDonor);
    expect(homePairing?.side, `${scenario} seed ${seed} home side`).toBe('home');
    expect(awayPairing?.side, `${scenario} seed ${seed} away side`).toBe('away');

    const ended = eventsOf(run, 'fusion-dance').filter((event) => event.outcome === 'ended');
    expect(ended, `${scenario} seed ${seed} ended pairings`).toHaveLength(1);
    expect(ended[0]?.ownerInstanceId, `${scenario} seed ${seed} ended owner`).toBe(homeOwner);
    expect(ended[0]?.donorInstanceId, `${scenario} seed ${seed} ended donor`).toBe(homeDonor);
    expect(
      eventsOf(run, 'fusion-dance').some(
        (event) => event.outcome === 'ended' && event.ownerInstanceId === awayOwner,
      ),
      `${scenario} seed ${seed} away pairing survives`,
    ).toBe(false);

    const rollups = run.result.rollups.filter((rollup) => rollup.mutationId === 'fusion-dance');
    expect(rollups, `${scenario} seed ${seed} fusion rollups`).toHaveLength(2);
    for (const ownerId of [homeOwner, awayOwner]) {
      const rollup = rollups.find((candidate) => candidate.ownerInstanceId === ownerId);
      expect(rollup?.triggers, `${scenario} seed ${seed} ${ownerId} trigger`).toBe(1);
      expect(
        rollup?.swapSeconds,
        `${scenario} seed ${seed} ${ownerId} swap seconds`,
      ).toBeGreaterThan(0);
    }
    expect(run.audit.findings, `${scenario} seed ${seed} audit`).toEqual([]);
  });

  it('runs opposing darwinism owners: one reduction per make, every owner counted', () => {
    const scenario = 'basketball-darwinism both';
    const home = buildScenarioTeam('human', [
      quietSlot('PG', ['basketball-darwinism']),
      ...plainSlots().slice(1),
    ]);
    const away = buildScenarioTeam('opponent', [
      quietSlot('PG', ['basketball-darwinism']),
      ...plainSlots().slice(1),
    ]);
    const homeOwner = home.starters[0]?.instanceId ?? '';
    const awayOwner = away.starters[0]?.instanceId ?? '';

    const hit = searchSeeds(
      'battle-powers-darwinism-both',
      48,
      (seed) => battleInput(home, away, seed),
      (run) => {
        if (!run.audit.ok) return false;
        const darwinism = eventsOf(run, 'darwinism');
        if (darwinism.length === 0) return false;
        const ownersSurvive = !eventsOf(run, 'substitution').some(
          (event) => event.outInstanceId === homeOwner || event.outInstanceId === awayOwner,
        );
        const homeShooters = new Set(starterIds(home));
        const awayShooters = new Set(starterIds(away));
        const bothSides =
          darwinism.some((event) => homeShooters.has(event.shooterInstanceId)) &&
          darwinism.some((event) => awayShooters.has(event.shooterInstanceId));
        return ownersSurvive && bothSides;
      },
    );
    expect(
      hit,
      `${scenario}: no seed within 48 kept both owners active with makes from both sides`,
    ).not.toBeNull();
    if (hit === null) return;
    const { run, seed } = hit;

    const darwinism = eventsOf(run, 'darwinism');
    const madeShots = eventsOf(run, 'shot-attempt').filter((event) => event.made);
    expect(darwinism.length, `${scenario} seed ${seed} one decay per made field goal`).toBe(
      madeShots.length,
    );

    const seenPerShooter = new Map<string, number>();
    for (const event of darwinism) {
      const count = (seenPerShooter.get(event.shooterInstanceId) ?? 0) + 1;
      seenPerShooter.set(event.shooterInstanceId, count);
      expect(
        event.shooterReductionsAfter,
        `${scenario} seed ${seed} shooter ${event.shooterInstanceId} reduction ordinal`,
      ).toBe(count);
    }
    for (const [shooterId, count] of seenPerShooter) {
      const makes = madeShots.filter((event) => event.shooterInstanceId === shooterId).length;
      expect(count, `${scenario} seed ${seed} shooter ${shooterId} reductions match makes`).toBe(
        makes,
      );
    }

    const rollups = run.result.rollups.filter(
      (rollup) => rollup.mutationId === 'basketball-darwinism',
    );
    expect(rollups, `${scenario} seed ${seed} darwinism rollups`).toHaveLength(2);
    for (const ownerId of [homeOwner, awayOwner]) {
      const rollup = rollups.find((candidate) => candidate.ownerInstanceId === ownerId);
      expect(rollup?.triggers, `${scenario} seed ${seed} ${ownerId} triggers`).toBe(
        darwinism.length,
      );
      expect(rollup?.ratingChanges, `${scenario} seed ${seed} ${ownerId} rating changes`).toBe(
        5 * darwinism.length,
      );
    }
    const homeShooters = new Set(starterIds(home));
    const awayShooters = new Set(starterIds(away));
    expect(
      darwinism.some((event) => homeShooters.has(event.shooterInstanceId)),
      `${scenario} seed ${seed} home shooter decays`,
    ).toBe(true);
    expect(
      darwinism.some((event) => awayShooters.has(event.shooterInstanceId)),
      `${scenario} seed ${seed} away shooter decays`,
    ).toBe(true);
    expect(run.audit.findings, `${scenario} seed ${seed} audit`).toEqual([]);
  });

  it('runs a mixed two-sided game with negative scoring, a team bonus, and deterministic digests', () => {
    const scenario = 'mixed negative scoring both';
    const home = buildScenarioTeam('human', [
      slot('PG', ['double-or-nothing']),
      slot('SG', ['charity-casino'], {
        ratings: { ...RIM_ATTACK, freeThrow: 10 },
        tendencies: { ...HIGH_USAGE, freeThrowRate: 99 },
      }),
      ...plainSlots().slice(2),
    ]);
    const away = buildScenarioTeam('opponent', [
      slot('PG', ['reverse-basketball'], {
        ratings: { ...RIM_ATTACK, threePoint: 99 },
        tendencies: { ...HIGH_USAGE, threePointRate: 99, rimFrequency: 5 },
      }),
      ...plainSlots().slice(1),
    ]);

    const hit = searchSeeds(
      'battle-powers-mixed-both',
      48,
      (seed) => battleInput(home, away, seed),
      (run) => {
        if (!run.audit.ok) return false;
        const negative = run.tape.scoring.filter((entry) => entry.points < 0);
        const bonus = run.tape.scoring.filter((entry) => entry.kind === 'bonus');
        const charityMiss = eventsOf(run, 'charity-casino').some(
          (event) => event.outcome === 'missed',
        );
        const reversePenalty = run.tape.scoring.some(
          (entry) =>
            entry.side === 'away' &&
            entry.addends.some(
              (addend) => addend.source === 'reverse-basketball' && addend.points === -2,
            ),
        );
        return (
          negative.some((entry) => entry.side === 'home') &&
          reversePenalty &&
          bonus.some((entry) => entry.side === 'away') &&
          charityMiss
        );
      },
    );
    expect(
      hit,
      `${scenario}: no seed within 48 produced negative scoring on both sides plus a bonus`,
    ).not.toBeNull();
    if (hit === null) return;
    const { run, seed } = hit;

    const negative = run.tape.scoring.filter((entry) => entry.points < 0);
    const homeNegative = negative.find(
      (entry) =>
        entry.side === 'home' &&
        entry.addends.some((addend) => addend.source === 'double-or-nothing'),
    );
    const awayNegative = run.tape.scoring.find(
      (entry) =>
        entry.side === 'away' &&
        entry.addends.some(
          (addend) => addend.source === 'reverse-basketball' && addend.points === -2,
        ),
    );
    expect(homeNegative, `${scenario} seed ${seed} double-or-nothing penalty`).toBeDefined();
    expect(awayNegative, `${scenario} seed ${seed} reverse-basketball penalty`).toBeDefined();
    const bonus = run.tape.scoring.find((entry) => entry.kind === 'bonus');
    expect(bonus, `${scenario} seed ${seed} team bonus`).toBeDefined();
    expect(bonus?.points, `${scenario} seed ${seed} bonus points`).toBe(2);
    expect(
      run.result.away.teamBonusPoints,
      `${scenario} seed ${seed} bonus ledger`,
    ).toBeGreaterThan(0);

    const replay = runBattle(run.input);
    expect(
      havocBattleGameResultDigest(replay.result),
      `${scenario} seed ${seed} result digest`,
    ).toBe(havocBattleGameResultDigest(run.result));
    expect(havocBattleGameTapeDigest(replay.tape), `${scenario} seed ${seed} tape digest`).toBe(
      havocBattleGameTapeDigest(run.tape),
    );
    expect(
      havocBattleGameResultDigest(run.result),
      `${scenario} seed ${seed} digest shape`,
    ).toMatch(/^[0-9a-f]{32}$/);
    expect(run.audit.findings, `${scenario} seed ${seed} audit`).toEqual([]);
  });
});
