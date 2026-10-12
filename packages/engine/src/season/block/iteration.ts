import {
  blockRoundRange,
  type SeasonBlockRunContext,
  type SeasonEffectsState,
  type SeasonGameSummary,
  type SeasonHealthState,
  type SeasonInvalidRosterInterruption,
  type SeasonRetainedGameDetail,
  type SeasonRoster,
  type SeasonSchedule,
  type SeasonScheduleGame,
} from '@hoop-rush/data-contracts';
import { SeasonBlockCancelledError, SeasonBlockInvariantError } from './errors.ts';
import {
  durabilityByVersionOf,
  positionsOf,
  seasonBlockGamesOf,
  simulateSeasonBlockGame,
  staminaByVersionOf,
} from './execution.ts';
import type {
  SeasonBlockGameOutcome,
  SeasonBlockGameSimulationOptions,
  SeasonBlockSimulationInput,
} from './types.ts';

export function seasonBlockSkipRecoveryTick(previousRound: number, gameRound: number): boolean {
  return !(previousRound !== 0 && gameRound > previousRound);
}

export function defaultSeasonBlockGameSharedOptions(
  input: SeasonBlockSimulationInput,
  overrides: SeasonBlockGameSimulationOptions = {},
): SeasonBlockGameSimulationOptions {
  return {
    gameNumberById: new Map(input.schedule.games.map((game, index) => [game.gameId, index + 1])),
    rotationByFranchise: new Map(
      input.run.rotations.map((rotation) => [rotation.franchiseId, rotation]),
    ),
    rosterByFranchise: new Map(input.run.rosters.map((roster) => [roster.franchiseId, roster])),
    staminaByVersion: staminaByVersionOf(input),
    durabilityByVersion: durabilityByVersionOf(input),
    positions: positionsOf(input),
    ...overrides,
  };
}

export function rosterByFranchiseScopedToRotations(
  run: SeasonBlockRunContext,
): Map<string, SeasonRoster> {
  const rotationIdsByFranchise = new Map(
    run.rotations.map((rotation) => [
      rotation.franchiseId,
      new Set([...rotation.starters, ...rotation.benchOrder]),
    ]),
  );
  return new Map(
    run.rosters.map((roster) => {
      const rotationIds = rotationIdsByFranchise.get(roster.franchiseId) ?? new Set<string>();
      return [
        roster.franchiseId,
        {
          ...roster,
          players: roster.players.filter((player) => rotationIds.has(player.playerVersionId)),
        },
      ];
    }),
  );
}

export interface SeasonBlockIterationAccumulator {
  summaries: SeasonGameSummary[];
  retainedDetails: SeasonRetainedGameDetail[];
  effects: SeasonEffectsState;
  health: SeasonHealthState;
  previousRound: number;
}

export function createSeasonBlockIterationAccumulator(
  input: SeasonBlockSimulationInput,
  blockIndex: number,
  seed?: Partial<
    Pick<
      SeasonBlockIterationAccumulator,
      'summaries' | 'retainedDetails' | 'effects' | 'health' | 'previousRound'
    >
  >,
): SeasonBlockIterationAccumulator {
  const { fromRound } = blockRoundRange(blockIndex);
  return {
    summaries: seed?.summaries ?? [],
    retainedDetails: seed?.retainedDetails ?? [],
    effects: seed?.effects ?? input.effects,
    health: seed?.health ?? input.health,
    previousRound: seed?.previousRound ?? fromRound - 1,
  };
}

export type SeasonBlockGameStepEvent =
  | {
      kind: 'game';
      game: SeasonScheduleGame;
      gameIndex: number;
      gamesTotal: number;
      outcome: Extract<SeasonBlockGameOutcome, { summary: SeasonGameSummary }>;
      accumulator: SeasonBlockIterationAccumulator;
    }
  | {
      kind: 'interrupted';
      interruption: SeasonInvalidRosterInterruption;
      gameIndex: number;
      gamesTotal: number;
      accumulator: SeasonBlockIterationAccumulator;
    }
  | {
      kind: 'complete';
      gamesTotal: number;
      accumulator: SeasonBlockIterationAccumulator;
    };

export interface SeasonBlockGameIterationArgs {
  input: SeasonBlockSimulationInput;
  blockIndex: number;
  schedule?: SeasonSchedule;
  games?: readonly SeasonScheduleGame[];
  startIndex?: number;
  initial?: SeasonBlockIterationAccumulator;
  sharedOptions?: SeasonBlockGameSimulationOptions;
  cancelAfterGames?: number;
}

export function* seasonBlockGameSteps(
  args: SeasonBlockGameIterationArgs,
): Generator<SeasonBlockGameStepEvent> {
  const games =
    args.games ?? seasonBlockGamesOf(args.schedule ?? args.input.schedule, args.blockIndex);
  const startIndex = args.startIndex ?? 0;
  const accumulator =
    args.initial ?? createSeasonBlockIterationAccumulator(args.input, args.blockIndex);
  const shared = args.sharedOptions ?? defaultSeasonBlockGameSharedOptions(args.input);
  const gamesTotal = games.length;
  for (let gameIndex = startIndex; gameIndex < games.length; gameIndex += 1) {
    if (
      args.cancelAfterGames !== undefined &&
      accumulator.summaries.length >= args.cancelAfterGames
    ) {
      throw new SeasonBlockCancelledError(args.blockIndex, accumulator.summaries.length);
    }
    const game = games.at(gameIndex);
    if (game === undefined) {
      throw new SeasonBlockInvariantError('season block iteration advanced past scheduled games', {
        blockIndex: args.blockIndex,
      });
    }
    const outcome = simulateSeasonBlockGame(
      args.input,
      game,
      accumulator.effects,
      accumulator.health,
      {
        skipRecoveryTick: seasonBlockSkipRecoveryTick(accumulator.previousRound, game.round),
        ...shared,
      },
    );
    if ('interruption' in outcome) {
      yield {
        kind: 'interrupted',
        interruption: outcome.interruption,
        gameIndex,
        gamesTotal,
        accumulator,
      };
      return;
    }
    accumulator.effects = outcome.effects;
    accumulator.health = outcome.health;
    accumulator.previousRound = game.round;
    accumulator.summaries.push(outcome.summary);
    if (outcome.retainedDetail !== null) accumulator.retainedDetails.push(outcome.retainedDetail);
    yield {
      kind: 'game',
      game,
      gameIndex,
      gamesTotal,
      outcome,
      accumulator,
    };
  }
  yield { kind: 'complete', gamesTotal, accumulator };
}
