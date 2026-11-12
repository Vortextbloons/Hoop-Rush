import type {
  HavocBattleInput,
  HavocGameInput,
  HavocMutationId,
  HavocTeamInput,
  Position,
  SimulationRatings,
  SimulationTendencies,
} from '@hoop-rush/data-contracts';
import {
  SIMULATION_RATINGS,
  SIMULATION_TENDENCIES,
  havocBattleInputSchema,
  playerIdSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import {
  buildHavocEffectiveProfile,
  buildHavocGameInput,
  buildHavocParticipant,
  buildHavocSourcePlayer,
  buildHavocTeamInput,
  seedFromString,
} from '@hoop-rush/test-fixtures';

/**
 * Deterministic scenario inputs shared by the parity fixtures, the parity
 * test, and the legacy-vs-migrated benchmark. Nothing here imports the live
 * simulation runtime, so the inputs stay valid across the port.
 */

export type ParityScenarioKind = 'solo' | 'battle';

export interface ParityApron {
  readonly side: 0 | 1;
  readonly payrollStatus: 'first-apron' | 'second-apron';
  readonly targetSlot: Position;
}

export interface ParityScenario {
  readonly id: string;
  readonly label: string;
  readonly kind: ParityScenarioKind;
  readonly seedText: string;
  readonly apron?: ParityApron;
  readonly build: (seedText: string) => HavocGameInput | HavocBattleInput;
  readonly features: readonly ParityFeature[];
}

export type ParityFeature = 'overtime' | 'foul-out' | 'clone-entered' | 'clone-exited' | 'fusion';

export interface ScenarioSlot {
  readonly slot: Position;
  readonly mutations: readonly HavocMutationId[];
  readonly ratings?: Partial<SimulationRatings>;
  readonly tendencies?: Partial<SimulationTendencies>;
  readonly overall?: number;
  readonly heightInches?: number | null;
  readonly physical?: {
    readonly heightInches?: number;
    readonly wingspanDeltaInches?: number;
    readonly reachUnits?: number;
  };
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

const FOUL_MAGNET_RATINGS: Partial<SimulationRatings> = {
  ...RIM_ATTACK,
  strength: 99,
  interiorDefense: 99,
};

const FOUL_MAGNET: Partial<SimulationTendencies> = { ...HIGH_USAGE, foulRate: 20 };

const QUIET_RATINGS: Partial<SimulationRatings> = {
  ...RIM_ATTACK,
  strength: 25,
  interiorDefense: 25,
};

const QUIET_TENDENCIES: Partial<SimulationTendencies> = { ...HIGH_USAGE, foulRate: 0 };

const SLOT_ORDER: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

function scenarioInstanceId(index: number): string {
  return `hvi-${(index + 16).toString(16).padStart(32, '0')}`;
}

function buildScenarioTeam(
  side: 'human' | 'opponent',
  slots: readonly ScenarioSlot[],
): HavocTeamInput {
  const base = side === 'human' ? 1 : 101;
  const starters = slots.map((entry, index) => {
    const source = buildHavocSourcePlayer({
      playerId: playerIdSchema.parse(`p-${side}-parity-${String(index + 1)}`),
      displayName: `${side} ${entry.slot}`,
      positions: [entry.slot],
      originalOverall: entry.overall ?? (side === 'human' ? 88 - index : 80),
      profile: {
        ratings: { ...SIMULATION_RATINGS, ...entry.ratings },
        tendencies: { ...SIMULATION_TENDENCIES, ...entry.tendencies },
      },
      physical: {
        heightInches: entry.heightInches === undefined ? 78 : entry.heightInches,
        weightLbs: 215,
      },
    });
    const baseEffective = buildHavocEffectiveProfile(source, { authoritativeChannels: [] });
    const effective =
      entry.physical === undefined
        ? baseEffective
        : buildHavocEffectiveProfile(source, {
            authoritativeChannels: [],
            physical: { ...baseEffective.physical, ...entry.physical },
          });
    return buildHavocParticipant({
      instanceId: scenarioInstanceId(base + index),
      kind: 'starter',
      slot: entry.slot,
      source,
      mutationPackage: entry.mutations.map((mutationId) => ({ mutationId })),
      effective,
    });
  });
  const replacements = starters.map((starter, index) =>
    buildHavocParticipant({
      instanceId: scenarioInstanceId(base + 10 + index),
      kind: 'replacement',
      slot: starter.slot,
      ownerInstanceId: starter.instanceId,
      source: starter.source,
      mutationPackage: [],
      effective: buildHavocEffectiveProfile(starter.source),
    }),
  );
  const clones = starters
    .filter((_starter, index) => slots[index]?.mutations.includes('clone-army') === true)
    .map((starter, cloneIndex) =>
      buildHavocParticipant({
        instanceId: scenarioInstanceId(base + 20 + cloneIndex),
        kind: 'clone',
        slot: starter.slot,
        ownerInstanceId: starter.instanceId,
        source: starter.source,
        mutationPackage: [],
        effective: starter.effective,
      }),
    );
  return buildHavocTeamInput(side, { starters, replacements, clones });
}

function slot(
  position: Position,
  mutations: readonly HavocMutationId[] = [],
  overrides: Partial<ScenarioSlot> = {},
): ScenarioSlot {
  return {
    slot: position,
    mutations,
    ratings: RIM_ATTACK,
    tendencies: HIGH_USAGE,
    ...overrides,
  };
}

function plainSlots(): ScenarioSlot[] {
  return SLOT_ORDER.map((position) => slot(position));
}

function magnetSlot(position: Position, mutations: readonly HavocMutationId[] = []): ScenarioSlot {
  return slot(position, mutations, {
    ratings: FOUL_MAGNET_RATINGS,
    tendencies: FOUL_MAGNET,
  });
}

function quietSlot(position: Position, mutations: readonly HavocMutationId[] = []): ScenarioSlot {
  return slot(position, mutations, {
    ratings: QUIET_RATINGS,
    tendencies: QUIET_TENDENCIES,
  });
}

function scenarioSeed(seedText: string) {
  return seedSchema.parse(seedFromString(seedText));
}

function battleFromTeams(
  home: HavocTeamInput,
  away: HavocTeamInput,
  seedText: string,
): HavocBattleInput {
  return havocBattleInputSchema.parse({
    ...buildHavocGameInput({ seed: scenarioSeed(seedText), gameNumber: 1 }),
    seed: scenarioSeed(seedText),
    home: { ...home, side: 'home' },
    away: { ...away, side: 'away' },
  });
}

const MUTATION_HOME = buildScenarioTeam('human', [
  { slot: 'PG', mutations: ['point-god', 'time-lord'] },
  { slot: 'SG', mutations: ['sniper-gene'] },
  { slot: 'SF', mutations: ['clone-army'] },
  { slot: 'PF', mutations: ['glass-eater'] },
  { slot: 'C', mutations: [] },
]);

const MUTATION_AWAY = buildScenarioTeam('opponent', [
  { slot: 'PG', mutations: ['sniper-gene'] },
  { slot: 'SG', mutations: ['point-god'] },
  { slot: 'SF', mutations: [] },
  { slot: 'PF', mutations: ['glass-eater'] },
  { slot: 'C', mutations: ['clone-army'] },
]);

const CLONE_HOME = buildScenarioTeam('human', [
  magnetSlot('PG', ['clone-army']),
  ...plainSlots().slice(1),
]);

const CLONE_AWAY = buildScenarioTeam(
  'opponent',
  plainSlots().map((entry) => (entry.slot === 'SG' ? quietSlot('SG', ['clone-army']) : entry)),
);

const FUSION_HOME = buildScenarioTeam('human', [
  magnetSlot('PG', ['fusion-dance']),
  ...plainSlots().slice(1),
]);

const FUSION_AWAY = buildScenarioTeam('opponent', [
  quietSlot('PG', ['fusion-dance']),
  ...plainSlots().slice(1),
]);

const FOUL_OUT_HOME = buildScenarioTeam('human', [magnetSlot('PG'), ...plainSlots().slice(1)]);

const FOUL_OUT_AWAY = buildScenarioTeam(
  'opponent',
  plainSlots().map((entry) => (entry.slot === 'PG' ? quietSlot('PG') : entry)),
);

const OVERTIME_HOME = buildScenarioTeam('human', [
  slot('PG', ['the-great-equalizer']),
  ...plainSlots().slice(1),
]);

const OVERTIME_AWAY = buildScenarioTeam('opponent', plainSlots());

export const PARITY_SCENARIOS: readonly ParityScenario[] = [
  {
    id: 'havoc-plain-solo',
    label: 'Havoc plain solo game + audit',
    kind: 'solo',
    seedText: 'parity-havoc-plain-0',
    build: (seedText) => buildHavocGameInput({ seed: scenarioSeed(seedText), gameNumber: 1 }),
    features: [],
  },
  {
    id: 'havoc-plain-battle',
    label: 'Havoc plain battle game + audit',
    kind: 'battle',
    seedText: 'parity-havoc-plain-0',
    build: (seedText) => {
      const solo = buildHavocGameInput({ seed: scenarioSeed(seedText), gameNumber: 1 });
      return havocBattleInputSchema.parse({
        ...solo,
        home: { ...solo.home, side: 'home' },
        away: { ...solo.away, side: 'away' },
      });
    },
    features: [],
  },
  {
    id: 'havoc-mutations',
    label: 'Havoc mutations battle game + audit',
    kind: 'battle',
    seedText: 'parity-havoc-mutations-0',
    build: (seedText) => battleFromTeams(MUTATION_HOME, MUTATION_AWAY, seedText),
    features: [],
  },
  {
    id: 'havoc-clones',
    label: 'Havoc opposing clone armies + audit',
    kind: 'battle',
    seedText: 'parity-havoc-clones-2',
    build: (seedText) => battleFromTeams(CLONE_HOME, CLONE_AWAY, seedText),
    features: ['clone-entered', 'clone-exited', 'foul-out'],
  },
  {
    id: 'havoc-fusion',
    label: 'Havoc opposing fusion dances + audit',
    kind: 'battle',
    seedText: 'parity-havoc-fusion-0',
    build: (seedText) => battleFromTeams(FUSION_HOME, FUSION_AWAY, seedText),
    features: ['fusion'],
  },
  {
    id: 'havoc-foul-out',
    label: 'Havoc foul-out substitution + audit',
    kind: 'battle',
    seedText: 'parity-havoc-foul-out-0',
    build: (seedText) => battleFromTeams(FOUL_OUT_HOME, FOUL_OUT_AWAY, seedText),
    features: ['foul-out'],
  },
  {
    id: 'havoc-overtime',
    label: 'Havoc overtime game + audit',
    kind: 'battle',
    seedText: 'parity-havoc-overtime-12',
    build: (seedText) => battleFromTeams(OVERTIME_HOME, OVERTIME_AWAY, seedText),
    features: ['overtime'],
  },
  {
    id: 'cap-rush-first-apron',
    label: 'Cap Rush first-apron solo battle + audit',
    kind: 'battle',
    seedText: 'parity-cap-rush-first-0',
    apron: { side: 0, payrollStatus: 'first-apron', targetSlot: 'C' },
    build: (seedText) => {
      const solo = buildHavocGameInput({ seed: scenarioSeed(seedText), gameNumber: 1 });
      return havocBattleInputSchema.parse({
        ...solo,
        home: { ...solo.home, side: 'home' },
        away: { ...solo.away, side: 'away' },
      });
    },
    features: [],
  },
  {
    id: 'cap-rush-second-apron',
    label: 'Cap Rush second-apron solo battle + audit',
    kind: 'battle',
    seedText: 'parity-cap-rush-second-0',
    apron: { side: 1, payrollStatus: 'second-apron', targetSlot: 'C' },
    build: (seedText) => {
      const solo = buildHavocGameInput({ seed: scenarioSeed(seedText), gameNumber: 1 });
      return havocBattleInputSchema.parse({
        ...solo,
        home: { ...solo.home, side: 'home' },
        away: { ...solo.away, side: 'away' },
      });
    },
    features: [],
  },
  {
    id: 'cap-rush-first-apron-mutated',
    label: 'Cap Rush first-apron multiplayer battle + audit',
    kind: 'battle',
    seedText: 'parity-cap-rush-first-mutated-0',
    apron: { side: 0, payrollStatus: 'first-apron', targetSlot: 'C' },
    build: (seedText) => battleFromTeams(MUTATION_HOME, MUTATION_AWAY, seedText),
    features: [],
  },
  {
    id: 'cap-rush-second-apron-mutated',
    label: 'Cap Rush second-apron multiplayer battle + audit',
    kind: 'battle',
    seedText: 'parity-cap-rush-second-mutated-0',
    apron: { side: 1, payrollStatus: 'second-apron', targetSlot: 'C' },
    build: (seedText) => battleFromTeams(MUTATION_HOME, MUTATION_AWAY, seedText),
    features: [],
  },
];

export function scenarioById(id: string): ParityScenario {
  const scenario = PARITY_SCENARIOS.find((candidate) => candidate.id === id);
  if (scenario === undefined) throw new Error(`unknown parity scenario: ${id}`);
  return scenario;
}

/** Deterministic candidate seeds used when the capture harness searches for a feature. */
export function searchSeed(prefix: string, index: number): string {
  return `${prefix}-${String(index)}`;
}

export function apronTargetOf(
  input: HavocBattleInput,
  scenario: ParityScenario,
): {
  readonly team: HavocBattleInput['home'];
  readonly participant: HavocBattleInput['home']['starters'][number];
} {
  const team = scenario.apron?.side === 0 ? input.home : input.away;
  const participant = team.starters.find((starter) => starter.slot === scenario.apron?.targetSlot);
  if (participant === undefined) {
    throw new Error(`${scenario.id}: missing apron target ${String(scenario.apron?.targetSlot)}`);
  }
  return { team, participant };
}
