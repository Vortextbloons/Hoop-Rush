import type { Seed, SimulationPlayer } from '@hoop-rush/data-contracts';
import { playerIdSchema, playerVersionId, seedSchema } from '@hoop-rush/data-contracts';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildSimulationPlayer,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import { createEngineContext, type EngineContext } from '../../sim/kernel.ts';
import { createRng } from '../../sim/rng.ts';
import { HAVOC_MUTATION_DEFINITIONS } from '../havoc/mutations.ts';
import { materializeHavocBundle } from '../havoc/offers.ts';
import { applyHavocMutationPackage } from '../havoc/transform.ts';
import {
  simulateRecordedFullCourtGame,
  type FullCourtAvailabilityEntry,
  type FullCourtGameInput,
  type FullCourtRecordedGameOutput,
  type FullCourtRotationPlanInput,
} from './game.ts';
import { adaptCapRushSpinsToFullCourt, type FullCourtRouletteSpinReceiptLike } from './roulette.ts';

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
  readonly homeHierarchy?: FullCourtGameInput['home']['hierarchy'];
  readonly awayHierarchy?: FullCourtGameInput['away']['hierarchy'];
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
      ...(input.homeHierarchy === undefined ? {} : { hierarchy: input.homeHierarchy }),
      ...(input.homeAvailability === undefined ? {} : { availability: input.homeAvailability }),
    },
    away: {
      teamId: 'away',
      displayName: 'Away',
      roster: away,
      ...(input.awayRotation === undefined ? {} : { rotation: input.awayRotation }),
      ...(input.awayHierarchy === undefined ? {} : { hierarchy: input.awayHierarchy }),
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

function buzzerBanditEntry(seedTag: string) {
  const definition = HAVOC_MUTATION_DEFINITIONS.find(
    (entry) => entry.mutationId === 'buzzer-bandit',
  );
  if (definition === undefined) throw new Error('full court test: missing buzzer bandit');
  const [entry] = materializeHavocBundle(
    { tier: definition.tier, mutationIds: [definition.mutationId] },
    createRng(`${seedTag}:phys:buzzer-bandit`),
    createRng(`${seedTag}:spec:buzzer-bandit`),
    HAVOC_MUTATION_DEFINITIONS,
  );
  if (entry === undefined) throw new Error('full court test: failed to materialize buzzer bandit');
  return entry;
}

function buzzerBanditReceipts(
  roster: readonly SimulationPlayer[],
  seedTag: string,
): FullCourtRouletteSpinReceiptLike[] {
  const slots = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
  return roster.slice(0, 5).map((player, index) => {
    if (player.playerVersionId === undefined) {
      throw new Error('full court test: buzzer bandit target needs a player version');
    }
    const slot = slots[index];
    if (slot === undefined) throw new Error('full court test: missing buzzer bandit slot');
    const sourcePlayer = buildSimulationPlayer({ ...player });
    const entry = buzzerBanditEntry(`${seedTag}-${String(index)}`);
    const effective = applyHavocMutationPackage(
      {
        playerId: sourcePlayer.playerId,
        playerVersionId: sourcePlayer.playerVersionId ?? null,
        displayName: sourcePlayer.displayName,
        franchiseId: null,
        eraId: null,
        seasonKey: null,
        positions: [...sourcePlayer.positions],
        originalOverall: sourcePlayer.overall ?? 75,
        overallSource: 'catalog',
        profile: {
          ratings: sourcePlayer.ratings,
          tendencies: sourcePlayer.tendencies,
          ...(sourcePlayer.anchors === undefined ? {} : { anchors: sourcePlayer.anchors }),
        },
        physical: {
          heightInches: sourcePlayer.heightInches,
          weightLbs: sourcePlayer.weightLbs,
        },
      },
      [entry],
      { slot },
    );
    return {
      target: {
        slot,
        playerVersionId: player.playerVersionId,
        playerId: player.playerId,
      },
      entry,
      effective,
    };
  });
}

/**
 * A 10-player-per-side game with Buzzer Bandit on five starters each way, which
 * can deduct a point before a team has scored and therefore record negative live
 * trip and period scores.
 */
export function simulateFullCourtBuzzerBanditTestGame(input: {
  readonly seed: string;
  readonly gameNumber?: number;
  readonly context?: EngineContext;
}): FullCourtRecordedGameOutput {
  const homeRoster = fullCourtTestRoster('bz-home', 10);
  const awayRoster = fullCourtTestRoster('bz-away', 10);
  const base = fullCourtTestInput({ seed: input.seed, homeRoster, awayRoster });
  return simulateRecordedFullCourtGame(
    {
      ...base,
      ...(input.gameNumber === undefined ? {} : { gameNumber: input.gameNumber }),
      home: {
        ...base.home,
        roulette: adaptCapRushSpinsToFullCourt({
          roster: homeRoster,
          receipts: buzzerBanditReceipts(homeRoster, `${input.seed}-home`),
        }),
      },
      away: {
        ...base.away,
        roulette: adaptCapRushSpinsToFullCourt({
          roster: awayRoster,
          receipts: buzzerBanditReceipts(awayRoster, `${input.seed}-away`),
        }),
      },
    },
    input.context ?? createEngineContext(),
  );
}
