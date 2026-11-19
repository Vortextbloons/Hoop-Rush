import type { Seed, SimulationPlayer } from '@hoop-rush/data-contracts';
import { playerIdSchema, playerVersionId, seedSchema } from '@hoop-rush/data-contracts';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildSimulationPlayer,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import type {
  FullCourtAvailabilityEntry,
  FullCourtGameInput,
  FullCourtRotationPlanInput,
} from './game.ts';

export const FULL_COURT_TEST_POSITIONS: SimulationPlayer['positions'][] = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['C'],
];

export interface FullCourtTestPlayerOptions {
  readonly index: number;
  readonly prefix: string;
  readonly rating?: number;
  readonly foulRate?: number;
  readonly staminaRating?: number;
  readonly minutesPerGame?: number;
  readonly gamesPlayed?: number;
  readonly usageRate?: number;
}

/**
 * A roster player whose ratings, usage, and season anchors are all controlled, so
 * a test can isolate one trait instead of drifting with fixture defaults.
 */
export function fullCourtTestPlayer(options: FullCourtTestPlayerOptions): SimulationPlayer {
  const positions = FULL_COURT_TEST_POSITIONS[options.index % FULL_COURT_TEST_POSITIONS.length];
  if (positions === undefined) throw new Error('full court test: missing positions');
  const rating = options.rating ?? 70;
  const base = buildSimulationPlayer();
  const ratings = Object.fromEntries(
    Object.keys(base.ratings).map((key) => [key, rating]),
  ) as SimulationPlayer['ratings'];
  return buildSimulationPlayer({
    playerId: playerIdSchema.parse(`${options.prefix}-${String(options.index)}`),
    displayName: `${options.prefix} ${String(options.index)}`,
    positions,
    playerVersionId: playerVersionId(
      `${options.prefix}|${String(options.index)}|${String(rating)}|${String(options.foulRate ?? 0)}`,
      options.prefix,
      '1990s',
      '1995-96',
    ),
    ratings,
    tendencies: {
      ...base.tendencies,
      usageRate: options.usageRate ?? base.tendencies.usageRate,
      ...(options.foulRate === undefined ? {} : { foulRate: options.foulRate }),
    },
    anchors: {
      gamesPlayed: options.gamesPlayed ?? 70,
      minutesPerGame: options.minutesPerGame ?? 30,
      pointsPerGame: 14,
      reboundsPerGame: 5,
      offensiveReboundsPerGame: 1.2,
      defensiveReboundsPerGame: 3.8,
      assistsPerGame: 3,
      stealsPerGame: 0.9,
      blocksPerGame: 0.5,
      turnoversPerGame: 1.8,
      fieldGoalPct: 0.47,
      threePointPct: 0.34,
      freeThrowPct: 0.75,
      threePointAttemptRate: 0.28,
      freeThrowAttemptRate: 0.26,
    },
  });
}

export function fullCourtTestRoster(
  prefix: string,
  size: number,
  overrides: (index: number) => Partial<FullCourtTestPlayerOptions> = () => ({}),
): SimulationPlayer[] {
  const roster: SimulationPlayer[] = [];
  for (let index = 0; index < size; index += 1) {
    roster.push(fullCourtTestPlayer({ prefix, index, ...overrides(index) }));
  }
  return roster;
}

export function fullCourtTestSeed(material: string): Seed {
  return seedSchema.parse(seedFromString(material));
}

export function fullCourtTestInput(input: {
  readonly seed: string | Seed;
  readonly homeRoster: readonly SimulationPlayer[];
  readonly awayRoster?: readonly SimulationPlayer[];
  readonly homeRotation?: FullCourtRotationPlanInput;
  readonly awayRotation?: FullCourtRotationPlanInput;
  readonly homeAvailability?: readonly FullCourtAvailabilityEntry[];
  readonly awayAvailability?: readonly FullCourtAvailabilityEntry[];
}): FullCourtGameInput {
  const away = input.awayRoster ?? fullCourtTestRoster('away', 8, () => ({ rating: 72 }));
  return {
    schemaVersion: 1,
    seed: typeof input.seed === 'string' ? fullCourtTestSeed(input.seed) : input.seed,
    gameNumber: 1,
    dataVersion: 'data-v1',
    profile: DEFAULT_ERA_SIM_PROFILE,
    home: {
      teamId: 'home',
      displayName: 'Home',
      roster: input.homeRoster,
      ...(input.homeRotation === undefined ? {} : { rotation: input.homeRotation }),
      ...(input.homeAvailability === undefined ? {} : { availability: input.homeAvailability }),
    },
    away: {
      teamId: 'away',
      displayName: 'Away',
      roster: away,
      ...(input.awayRotation === undefined ? {} : { rotation: input.awayRotation }),
      ...(input.awayAvailability === undefined ? {} : { availability: input.awayAvailability }),
    },
  };
}

export function availabilityOf(
  roster: readonly SimulationPlayer[],
  energy: (index: number) => number = () => 1,
): FullCourtAvailabilityEntry[] {
  return roster.map((player, index) => ({
    playerId: player.playerId,
    available: true,
    energy: energy(index),
  }));
}

export function staminaOf(
  roster: readonly SimulationPlayer[],
  stamina: (index: number) => number,
): FullCourtAvailabilityEntry[] {
  return roster.map((player, index) => ({
    playerId: player.playerId,
    available: true,
    stamina: stamina(index),
  }));
}
