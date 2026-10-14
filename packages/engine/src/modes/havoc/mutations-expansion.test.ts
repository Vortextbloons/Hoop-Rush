import { describe, expect, it } from 'vitest';
import type {
  HavocEvent,
  HavocPickCardCommand,
  HavocRerollOfferCommand,
  HavocScoringEntry,
  HavocSpecialistCategory,
  SimulationRatings,
  SimulationTendencies,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_SCHEMA_VERSION,
  REQUIRED_RATING_KEYS,
  SIMULATION_RATINGS,
  SIMULATION_TENDENCIES,
  havocPickCardCommandSchema,
  havocRerollOfferCommandSchema,
  seedFromString,
  seedSchema,
} from '@hoop-rush/data-contracts';
import { buildFixtureBracket, buildHavocSourcePlayer } from '@hoop-rush/test-fixtures';
import { applyHavocMutationPackage } from './transform.ts';
import { enumerateHavocBundles } from './compatibility.ts';
import { HAVOC_MUTATION_DEFINITIONS } from './mutations.ts';
import { CreateHavocRunState } from './draft-commands.ts';
import { ApplyHavocCommand } from './run-commands.ts';
import { GenerateHavocOffer } from './offers.ts';
import type { HavocLockSources } from './api.ts';
import {
  buildHavocCatalogFixture,
  buildHavocCreateCommandFixture,
  buildHavocEnvironmentFixture,
  buildHavocEraProfileFixture,
} from './havoc-test-support.ts';
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

const FOUL_PRONE: Partial<SimulationTendencies> = {
  ...HIGH_USAGE,
  usageRate: 20,
  shotRate: 30,
  foulRate: 20,
};

const SPECIALIST_CATEGORY_FIELDS: Record<HavocSpecialistCategory, readonly string[]> = {
  scoring: ['insideScoring', 'closeShot', 'midrange', 'threePoint', 'freeThrow'],
  playmaking: ['ballHandling', 'passing', 'offensiveIq'],
  defense: ['perimeterDefense', 'interiorDefense', 'steal', 'block', 'defensiveIq'],
  rebounding: ['offensiveRebound', 'defensiveRebound'],
  athleticism: ['speed', 'strength', 'vertical'],
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

function sourceWith(
  overrides: {
    ratings?: Partial<SimulationRatings>;
    tendencies?: Partial<SimulationTendencies>;
    heightInches?: number | null;
  } = {},
) {
  return buildHavocSourcePlayer({
    profile: {
      ratings: { ...SIMULATION_RATINGS, ...overrides.ratings },
      tendencies: { ...SIMULATION_TENDENCIES, ...overrides.tendencies },
    },
    physical: {
      heightInches: overrides.heightInches === undefined ? 76 : overrides.heightInches,
      weightLbs: 200,
    },
  });
}

describe('new tier-1 transformations', () => {
  it('swaps the five strongest and weakest ratings with key-order tie breaks', () => {
    const flipped = applyHavocMutationPackage(
      sourceWith({
        ratings: {
          insideScoring: 100,
          closeShot: 100,
          midrange: 90,
          threePoint: 80,
          freeThrow: 70,
          ballHandling: 60,
          passing: 55,
          offensiveIq: 45,
          offensiveRebound: 10,
          defensiveRebound: 5,
          perimeterDefense: 0,
          interiorDefense: 0,
          steal: 0,
          block: 0,
          defensiveIq: 35,
          speed: 65,
          strength: 25,
          vertical: 75,
        },
      }),
      [{ mutationId: 'opposite-day' }],
    );
    expect(flipped.ratings.insideScoring).toBe(0);
    expect(flipped.ratings.closeShot).toBe(0);
    expect(flipped.ratings.midrange).toBe(0);
    expect(flipped.ratings.threePoint).toBe(0);
    expect(flipped.ratings.vertical).toBe(5);
    expect(flipped.ratings.perimeterDefense).toBe(100);
    expect(flipped.ratings.interiorDefense).toBe(100);
    expect(flipped.ratings.steal).toBe(90);
    expect(flipped.ratings.block).toBe(80);
    expect(flipped.ratings.defensiveRebound).toBe(75);
    expect(flipped.ratings.freeThrow).toBe(70);
    expect(flipped.ratings.ballHandling).toBe(60);
    expect(flipped.ratings.passing).toBe(55);
    expect(flipped.ratings.offensiveIq).toBe(45);
    expect(flipped.ratings.defensiveIq).toBe(35);
    expect(flipped.ratings.speed).toBe(65);
    expect(flipped.ratings.strength).toBe(25);
  });

  it('builds Tiny Titan at 62 inches with giant interior ratings and capped speed', () => {
    const titan = applyHavocMutationPackage(sourceWith({ heightInches: 79 }), [
      { mutationId: 'tiny-titan' },
    ]);
    expect(titan.physical.heightInches).toBe(62);
    expect(titan.ratings.strength).toBe(99);
    expect(titan.ratings.block).toBe(99);
    expect(titan.ratings.vertical).toBe(99);
    expect(titan.ratings.offensiveRebound).toBe(99);
    expect(titan.ratings.defensiveRebound).toBe(99);
    expect(titan.ratings.speed).toBe(40);
    const slowerSource = applyHavocMutationPackage(sourceWith({ ratings: { speed: 35 } }), [
      { mutationId: 'tiny-titan' },
    ]);
    expect(slowerSource.ratings.speed).toBe(35);
  });

  it('sets every rating to exactly 88 under Mr. Everything', () => {
    const everything = applyHavocMutationPackage(sourceWith(), [{ mutationId: 'mr-everything' }]);
    for (const field of REQUIRED_RATING_KEYS) {
      expect(everything.ratings[field]).toBe(88);
    }
    expect(everything.physical.heightInches).toBe(76);
  });

  it('raises Foul Merchant free-throw channels and caps three-point', () => {
    const merchant = applyHavocMutationPackage(
      sourceWith({
        ratings: { threePoint: 95 },
        tendencies: { driveRate: 10, freeThrowRate: 10 },
      }),
      [{ mutationId: 'foul-merchant' }],
    );
    expect(merchant.ratings.freeThrow).toBe(99);
    expect(merchant.ratings.ballHandling).toBe(99);
    expect(merchant.ratings.offensiveIq).toBe(99);
    expect(merchant.tendencies.driveRate).toBe(95);
    expect(merchant.tendencies.freeThrowRate).toBe(95);
    expect(merchant.ratings.threePoint).toBe(30);
  });

  it('specializes the sampled category at 99 and caps everything else at 45', () => {
    const categories: readonly HavocSpecialistCategory[] = [
      'scoring',
      'playmaking',
      'defense',
      'rebounding',
      'athleticism',
    ];
    for (const category of categories) {
      const effective = applyHavocMutationPackage(sourceWith(), [
        { mutationId: 'the-specialist', specialistCategory: category },
      ]);
      for (const field of REQUIRED_RATING_KEYS) {
        if (SPECIALIST_CATEGORY_FIELDS[category].includes(field)) {
          expect(effective.ratings[field], `${category} ${field}`).toBe(99);
        } else {
          expect(effective.ratings[field], `${category} ${field}`).toBeLessThanOrEqual(45);
        }
      }
    }
  });

  it('requires a sampled category for the specialist', () => {
    expect(() =>
      applyHavocMutationPackage(sourceWith(), [{ mutationId: 'the-specialist' }]),
    ).toThrow(/specialist category/);
  });
});

describe('specialist bundles and offers', () => {
  const fixture = buildHavocCatalogFixture();
  const environment = buildHavocEnvironmentFixture(fixture.adapted);

  function generateOffer(runSeed: string) {
    return GenerateHavocOffer(
      {
        catalog: fixture.adapted,
        runSeed: seedSchema.parse(seedFromString(runSeed)),
        round: 1,
        slot: 'PG',
        offerIndex: 0,
        draftedClaimKeys: [],
        rerollUsed: false,
      },
      environment,
    );
  }

  it('keeps every enumerated specialist bundle playable in at least one category', () => {
    for (const tier of [1, 2] as const) {
      for (const bundle of enumerateHavocBundles(HAVOC_MUTATION_DEFINITIONS, tier)) {
        if (!bundle.mutationIds.includes('the-specialist')) continue;
        expect(
          bundle.specialistCategories,
          `bundle ${bundle.mutationIds.join('+')} lost every category`,
        ).toBeDefined();
        expect(bundle.specialistCategories?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('samples, persists, and replays the specialist category from the card stream', () => {
    const seen = new Set<HavocSpecialistCategory>();
    let replaySeed: string | null = null;
    let replayCategory: HavocSpecialistCategory | null = null;
    for (let index = 0; index < 120; index += 1) {
      const runSeed = `havoc-specialist-${String(index)}`;
      const offer = generateOffer(runSeed);
      for (const card of offer.cards) {
        const entry = card.mutations.find((mutation) => mutation.mutationId === 'the-specialist');
        if (entry === undefined) continue;
        expect(entry.specialistCategory).toBeDefined();
        if (replaySeed === null) {
          replaySeed = runSeed;
          replayCategory = entry.specialistCategory as HavocSpecialistCategory;
        }
        seen.add(entry.specialistCategory as HavocSpecialistCategory);
        break;
      }
    }
    expect(replaySeed).not.toBeNull();
    expect(replayCategory).not.toBeNull();
    const replay = generateOffer(replaySeed as string);
    const replayed = replay.cards.flatMap((card) =>
      card.mutations.filter((mutation) => mutation.mutationId === 'the-specialist'),
    );
    expect(replayed.length).toBeGreaterThan(0);
    for (const entry of replayed) {
      expect(entry.specialistCategory).toBe(replayCategory);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('fusion-dance draft exclusion', () => {
  const fixture = buildHavocCatalogFixture();
  const environment = buildHavocEnvironmentFixture(fixture.adapted);
  const lockSources: HavocLockSources = {
    bracket: buildFixtureBracket(),
    profile: buildHavocEraProfileFixture(),
  };

  function createDraftState(runSeed: string) {
    const command = buildHavocCreateCommandFixture(fixture, {
      runSeed: seedSchema.parse(seedFromString(runSeed)),
    });
    return CreateHavocRunState(command, fixture.adapted, environment);
  }

  function pickCommand(state: ReturnType<typeof createDraftState>, cardId: string) {
    const draft = state.draft;
    if (draft === null) throw new Error('no draft');
    return havocPickCardCommandSchema.parse({
      schemaVersion: HAVOC_SCHEMA_VERSION,
      commandId: `cmd-pick-${String(state.revision)}`,
      runId: state.runId,
      expectedRevision: state.revision,
      command: 'pick-havoc-card',
      offerId: draft.offerId,
      cardId,
    }) satisfies HavocPickCardCommand;
  }

  function rerollCommand(state: ReturnType<typeof createDraftState>) {
    const draft = state.draft;
    if (draft === null) throw new Error('no draft');
    return havocRerollOfferCommandSchema.parse({
      schemaVersion: HAVOC_SCHEMA_VERSION,
      commandId: `cmd-reroll-${String(state.revision)}`,
      runId: state.runId,
      expectedRevision: state.revision,
      command: 'reroll-havoc-offer',
      offerId: draft.offerId,
    }) satisfies HavocRerollOfferCommand;
  }

  function offerContainsFusion(state: ReturnType<typeof createDraftState>): boolean {
    const draft = state.draft;
    if (draft === null) return false;
    return draft.cards.some((card) =>
      card.mutations.some((mutation) => mutation.mutationId === 'fusion-dance'),
    );
  }

  it('excludes fusion-dance from later offers and rerolls after drafting it', () => {
    let state: ReturnType<typeof createDraftState> | null = null;
    for (let index = 0; index < 240 && state === null; index += 1) {
      const candidate = createDraftState(`havoc-fusion-draft-${String(index)}`);
      if (offerContainsFusion(candidate)) state = candidate;
    }
    expect(state, 'expected a draft seed offering fusion-dance').not.toBeNull();
    if (state === null) return;
    const fusionCard = state.draft?.cards.find((card) =>
      card.mutations.some((mutation) => mutation.mutationId === 'fusion-dance'),
    );
    if (fusionCard === undefined) throw new Error('missing fusion card');
    const picked = ApplyHavocCommand(
      state,
      pickCommand(state, fusionCard.cardId),
      environment,
      lockSources,
    );
    expect(picked.result.status).toBe('accepted');
    expect(offerContainsFusion(picked.state)).toBe(false);
    if (picked.state.draft === null) return;
    const rerolled = ApplyHavocCommand(
      picked.state,
      rerollCommand(picked.state),
      environment,
      lockSources,
    );
    expect(rerolled.result.status).toBe('accepted');
    expect(offerContainsFusion(rerolled.state)).toBe(false);
  });

  it('rejects a game input with two fusion-dance owners on one team', () => {
    expect(() =>
      buildScenarioTeam('human', [
        scenarioSlot('PG', ['fusion-dance']),
        scenarioSlot('SG', ['fusion-dance']),
        ...plainSlots().slice(2),
      ]),
    ).toThrow(/fusion-dance has 2 owners/);
  });
});

describe('buzzer bandit and charity casino', () => {
  const away = buildScenarioTeam('opponent', plainSlots());

  it('doubles only late-clock makes for the buzzer bandit owner', () => {
    const human = buildScenarioTeam('human', humanSlotMutation('PG', 'buzzer-bandit'));
    const run = searchScenario(96, human, away, (candidate) =>
      candidate.tape.events.some(
        (event) => event.kind === 'buzzer-bandit' && event.outcome === 'doubled',
      ),
    );
    expect(run, 'expected a late-clock make').not.toBeNull();
    if (run === null) return;
    expect(eventsOf(run, 'buzzer-bandit').length).toBeGreaterThan(0);
    for (const event of eventsOf(run, 'buzzer-bandit')) {
      if (event.kind !== 'buzzer-bandit') continue;
      expect(event.shotClockTenths).toBeLessThanOrEqual(30);
      expect(event.ownerInstanceId).toBe(event.shooterInstanceId);
      if (event.outcome === 'doubled') {
        const entry = entryOf(run, event.scoringSequence);
        expect(entry?.kind).toBe('field-goal');
        expect(entry?.multipliers).toContainEqual({ source: 'buzzer-bandit', factor: 2 });
      } else {
        const entry = entryOf(run, event.scoringSequence);
        expect(entry?.kind).toBe('adjustment');
        expect(entry?.points).toBe(-1);
        expect(entry?.addends).toContainEqual({ source: 'buzzer-bandit', points: -1 });
      }
    }
  });

  it('stacks buzzer-bandit and double-or-nothing miss penalties on the same miss', () => {
    const human = buildScenarioTeam('human', [
      scenarioSlot('PG', ['buzzer-bandit', 'double-or-nothing']),
      ...plainSlots().slice(1),
    ]);
    const run = searchScenario(
      96,
      human,
      away,
      (candidate) => {
        return candidate.tape.events.some((event) => {
          if (event.kind !== 'buzzer-bandit' || event.outcome !== 'penalized') return false;
          const buzzerEntry = candidate.tape.scoring.find(
            (entry) => entry.sequence === event.scoringSequence,
          );
          if (buzzerEntry === undefined) return false;
          return candidate.tape.scoring.some(
            (entry) =>
              entry.kind === 'adjustment' &&
              entry.originalEventSequence === buzzerEntry.originalEventSequence &&
              entry.addends.some(
                (addend) => addend.source === 'double-or-nothing' && addend.points === -1,
              ),
          );
        });
      },
      'havoc-stack',
    );
    expect(run, 'expected a stacked double-or-nothing and buzzer-bandit miss').not.toBeNull();
    if (run === null) return;
    const stacked = eventsOf(run, 'buzzer-bandit').find(
      (event) => event.kind === 'buzzer-bandit' && event.outcome === 'penalized',
    );
    if (stacked?.kind !== 'buzzer-bandit') throw new Error('missing stacked penalty');
    const buzzerEntry = run.tape.scoring.find(
      (entry) => entry.sequence === stacked.scoringSequence,
    );
    expect(buzzerEntry?.points).toBe(-1);
    const doubleEntry = run.tape.scoring.find(
      (entry) =>
        entry.kind === 'adjustment' &&
        entry.originalEventSequence === buzzerEntry?.originalEventSequence &&
        entry.addends.some((addend) => addend.source === 'double-or-nothing'),
    );
    expect(doubleEntry?.points).toBe(-1);
    expect(doubleEntry?.sequence).not.toBe(buzzerEntry?.sequence);
  });

  it('scores charity-casino makes at three and gifts the opponent two on misses', () => {
    const human = buildScenarioTeam('human', humanSlotMutation('PG', 'charity-casino'));
    const ownerInstanceId = human.starters[0]?.instanceId ?? '';
    const run = searchScenario(48, human, away, (candidate) =>
      candidate.tape.events.some(
        (event) => event.kind === 'charity-casino' && event.outcome === 'missed',
      ),
    );
    expect(run, 'expected a missed charity free throw').not.toBeNull();
    if (run === null) return;
    for (const event of eventsOf(run, 'charity-casino')) {
      if (event.kind !== 'charity-casino') continue;
      expect(event.ownerInstanceId).toBe(ownerInstanceId);
      if (event.outcome === 'made') {
        const entry = entryOf(run, event.scoringSequence);
        expect(entry?.kind).toBe('free-throw');
        expect(entry?.points).toBe(3);
        expect(entry?.addends).toContainEqual({ source: 'charity-casino', points: 2 });
      } else {
        const bonus = entryOf(run, event.bonusSequence);
        expect(bonus?.kind).toBe('bonus');
        expect(bonus?.side).toBe('opponent');
        expect(bonus?.actorInstanceId).toBe(ownerInstanceId);
        expect(bonus?.points).toBe(2);
      }
    }
    const bonusTotal = run.tape.scoring
      .filter((entry) => entry.kind === 'bonus')
      .reduce((sum, entry) => sum + entry.points, 0);
    expect(bonusTotal).toBeGreaterThan(0);
    expect(run.result.away.teamBonusPoints).toBe(bonusTotal);
    const awayParticipantPoints = run.result.away.participants.reduce(
      (sum, line) => sum + line.points,
      0,
    );
    expect(run.result.away.points - awayParticipantPoints).toBe(bonusTotal);
  });
});

describe('fusion dance runtime', () => {
  const away = buildScenarioTeam('opponent', plainSlots());

  function fusionSlots(): ScenarioSlot[] {
    return [
      scenarioSlot('PG', ['fusion-dance'], { overall: 80, tendencies: FOUL_PRONE }),
      scenarioSlot('SG', [], { overall: 70, tendencies: FOUL_PRONE }),
      scenarioSlot('SF', [], { overall: 90, tendencies: FOUL_PRONE }),
      scenarioSlot('PF', [], { overall: 85, tendencies: FOUL_PRONE }),
      scenarioSlot('C', [], { overall: 75, tendencies: FOUL_PRONE }),
    ];
  }

  it('pairs the owner with the highest-original-overall teammate starter', () => {
    const human = buildScenarioTeam('human', fusionSlots());
    const donor = human.starters.find((starter) => starter.source.originalOverall === 90);
    expect(donor).toBeDefined();
    for (let index = 0; index < 3; index += 1) {
      const run = runScenario(human, away, `havoc-fusion-pair-${String(index)}`);
      const applied = run.tape.events.filter(
        (event) => event.kind === 'fusion-dance' && event.outcome === 'applied',
      );
      expect(applied).toHaveLength(1);
      const event = applied[0];
      if (event?.kind !== 'fusion-dance') throw new Error('missing fusion application');
      expect(event.ownerInstanceId).toBe(human.starters[0]?.instanceId);
      expect(event.donorInstanceId).toBe(donor?.instanceId);
    }
  });

  it('breaks donor ties by draft slot', () => {
    const human = buildScenarioTeam('human', [
      scenarioSlot('PG', ['fusion-dance'], { overall: 80 }),
      scenarioSlot('SG', [], { overall: 70 }),
      scenarioSlot('SF', [], { overall: 90 }),
      scenarioSlot('PF', [], { overall: 90 }),
      scenarioSlot('C', [], { overall: 75 }),
    ]);
    const donor = human.starters[2];
    const run = runScenario(human, away, 'havoc-fusion-tie');
    const applied = run.tape.events.find(
      (event) => event.kind === 'fusion-dance' && event.outcome === 'applied',
    );
    if (applied?.kind !== 'fusion-dance') throw new Error('missing fusion application');
    expect(applied.donorInstanceId).toBe(donor?.instanceId);
  });

  it('keeps fusion through a donor exit and ends it when the owner exits', () => {
    const human = buildScenarioTeam('human', fusionSlots());
    const donorExitRun = searchScenario(
      96,
      human,
      away,
      (candidate) => {
        const applied = candidate.tape.events.find(
          (event) => event.kind === 'fusion-dance' && event.outcome === 'applied',
        );
        if (applied?.kind !== 'fusion-dance') return false;
        const ownerExited = candidate.tape.events.some(
          (event) =>
            event.kind === 'substitution' && event.outInstanceId === applied.ownerInstanceId,
        );
        if (ownerExited) return false;
        return candidate.tape.events.some(
          (event) =>
            event.kind === 'substitution' && event.outInstanceId === applied.donorInstanceId,
        );
      },
      'havoc-fusion-donor',
    );
    expect(donorExitRun, 'expected a donor exit while the owner stayed').not.toBeNull();
    if (donorExitRun !== null) {
      expect(
        donorExitRun.tape.events.some(
          (event) => event.kind === 'fusion-dance' && event.outcome === 'ended',
        ),
      ).toBe(false);
    }

    const ownerExitRun = searchScenario(
      96,
      human,
      away,
      (candidate) => {
        const applied = candidate.tape.events.find(
          (event) => event.kind === 'fusion-dance' && event.outcome === 'applied',
        );
        if (applied?.kind !== 'fusion-dance') return false;
        return candidate.tape.events.some(
          (event) =>
            event.kind === 'substitution' && event.outInstanceId === applied.ownerInstanceId,
        );
      },
      'havoc-fusion-owner',
    );
    expect(ownerExitRun, 'expected an owner exit').not.toBeNull();
    if (ownerExitRun === null) return;
    expect(
      ownerExitRun.tape.events.some(
        (event) => event.kind === 'fusion-dance' && event.outcome === 'ended',
      ),
    ).toBe(true);
  });

  it('changes outcomes, replays identically, and records swap seconds', () => {
    const human = buildScenarioTeam('human', [
      scenarioSlot('PG', ['fusion-dance']),
      ...plainSlots().slice(1),
    ]);
    const baseline = buildScenarioTeam('human', plainSlots());
    let differed = false;
    for (let index = 0; index < 4 && !differed; index += 1) {
      const seed = `havoc-fusion-direction-${String(index)}`;
      const fused = runScenario(human, away, seed);
      const replay = runScenario(human, away, seed);
      expect(replay.tapeDigest).toBe(fused.tapeDigest);
      expect(replay.resultDigest).toBe(fused.resultDigest);
      const ordinary = runScenario(baseline, away, seed);
      if (fused.tapeDigest !== ordinary.tapeDigest) differed = true;
    }
    expect(differed).toBe(true);
    const fused = runScenario(human, away, 'havoc-fusion-direction-0');
    const fusionRollup = fused.result.rollups.find((entry) => entry.mutationId === 'fusion-dance');
    expect(fusionRollup).toBeDefined();
    expect(fusionRollup?.swapSeconds).toBeGreaterThan(0);
  });
});

describe('basketball darwinism runtime', () => {
  const away = buildScenarioTeam('opponent', plainSlots());

  it('records one reduction per made field goal across owners', () => {
    const human = buildScenarioTeam('human', [
      scenarioSlot('PG', ['basketball-darwinism']),
      scenarioSlot('SG', ['basketball-darwinism']),
      ...plainSlots().slice(2),
    ]);
    const run = runScenario(human, away, 'havoc-darwinism-0');
    const events = eventsOf(run, 'darwinism');
    const madeFieldGoals = run.tape.scoring.filter((entry) => entry.kind === 'field-goal');
    expect(events.length).toBe(madeFieldGoals.length);
    expect(events.length).toBeGreaterThan(0);
    const reductions = new Map<string, number>();
    for (const event of events) {
      if (event.kind !== 'darwinism') continue;
      const previous = reductions.get(event.shooterInstanceId) ?? 0;
      expect(event.shooterReductionsAfter).toBe(previous + 1);
      reductions.set(event.shooterInstanceId, event.shooterReductionsAfter);
    }
    const rollup = run.result.rollups.filter(
      (entry) => entry.mutationId === 'basketball-darwinism',
    );
    expect(rollup).toHaveLength(2);
    for (const entry of rollup) {
      expect(entry.triggers).toBeGreaterThan(0);
      expect(entry.ratingChanges).toBe(entry.triggers * 5);
    }
  });

  it('stops new reductions when the owner exits and resets next game', () => {
    const human = buildScenarioTeam('human', [
      scenarioSlot('PG', ['basketball-darwinism'], { tendencies: FOUL_PRONE }),
      ...plainSlots().slice(1),
    ]);
    const ownerInstanceId = human.starters[0]?.instanceId ?? '';
    const run = searchScenario(
      96,
      human,
      away,
      (candidate) =>
        candidate.tape.events.some(
          (event) => event.kind === 'substitution' && event.outInstanceId === ownerInstanceId,
        ),
      'havoc-darwinism-exit',
    );
    expect(run, 'expected a darwinism owner exit').not.toBeNull();
    if (run === null) return;
    const exit = run.tape.events.find(
      (event) => event.kind === 'substitution' && event.outInstanceId === ownerInstanceId,
    );
    if (exit === undefined) return;
    const events = eventsOf(run, 'darwinism');
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      if (event.kind !== 'darwinism') continue;
      expect(event.sequence).toBeLessThan(exit.sequence);
    }
    const sequel = runScenario(human, away, 'havoc-darwinism-exit-0', 2);
    const sequelEvents = eventsOf(sequel, 'darwinism');
    expect(sequelEvents.length).toBeGreaterThan(0);
    const first = sequelEvents[0];
    if (first?.kind !== 'darwinism') throw new Error('missing darwinism');
    expect(first.shooterReductionsAfter).toBe(1);
  });

  it('keeps degraded scoring monotonic across recomputation and changes outcomes', () => {
    const human = buildScenarioTeam('human', humanSlotMutation('PG', 'basketball-darwinism'));
    const baseline = buildScenarioTeam('human', plainSlots());
    let differed = false;
    for (let index = 0; index < 4 && !differed; index += 1) {
      const seed = `havoc-darwinism-direction-${String(index)}`;
      const mutated = runScenario(human, away, seed);
      const ordinary = runScenario(baseline, away, seed);
      if (mutated.tapeDigest !== ordinary.tapeDigest) differed = true;
    }
    expect(differed).toBe(true);
    const run = runScenario(human, away, 'havoc-darwinism-recompute');
    const shooterReductions = new Map<string, number>();
    for (const event of eventsOf(run, 'darwinism')) {
      if (event.kind !== 'darwinism') continue;
      const previous = shooterReductions.get(event.shooterInstanceId) ?? 0;
      expect(event.shooterReductionsAfter).toBe(previous + 1);
      shooterReductions.set(event.shooterInstanceId, event.shooterReductionsAfter);
    }
    expect(shooterReductions.size).toBeGreaterThan(0);
  });
});
