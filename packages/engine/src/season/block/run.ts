import {
  blockRoundRange,
  type SeasonCandidateCheckpoint,
  type SeasonGameSummary,
  type SeasonPendingBlockCandidate,
  type SeasonRetainedGameDetail,
  type SeasonResumeSeasonBlockCommand,
  type SeasonResumeSeasonBlockResult,
  type SeasonRun,
  type SeasonSubmitBlockResult,
} from '@hoop-rush/data-contracts';
import { assembleSeasonBlockCandidate } from './assembly.ts';
import {
  SeasonBlockCancelledError,
  SeasonBlockInvariantError,
  SeasonBlockValidationError,
} from './errors.ts';
import {
  durabilityByVersionOf,
  positionsOf,
  seasonBlockGamesOf,
  simulateSeasonBlockGame,
  staminaByVersionOf,
} from './execution.ts';
import type {
  SeasonBlockGameSimulationOptions,
  SeasonBlockSimulationInput,
  SeasonBlockSimulationOptions,
  SeasonSubmitBlockCommandInput,
} from './types.ts';
import { requireValidSeasonBlockCommand, seasonBlockRejection } from './validation.ts';

export function simulateSeasonBlock(
  input: SeasonBlockSimulationInput,
  options: SeasonBlockSimulationOptions = {},
): SeasonCandidateCheckpoint {
  requireValidSeasonBlockCommand(input);
  const summaries: SeasonGameSummary[] = [];
  const retainedDetails: SeasonRetainedGameDetail[] = [];
  const { fromRound } = blockRoundRange(input.command.blockIndex);
  let previousRound = fromRound - 1;
  let effects = input.effects;
  let health = input.health;
  const shared: SeasonBlockGameSimulationOptions = {
    gameNumberById: new Map(input.schedule.games.map((game, index) => [game.gameId, index + 1])),
    rotationByFranchise: new Map(
      input.run.rotations.map((rotation) => [rotation.franchiseId, rotation]),
    ),
    rosterByFranchise: new Map(input.run.rosters.map((roster) => [roster.franchiseId, roster])),
    staminaByVersion: staminaByVersionOf(input),
    durabilityByVersion: durabilityByVersionOf(input),
    positions: positionsOf(input),
  };
  for (const game of seasonBlockGamesOf(input.schedule, input.command.blockIndex)) {
    if (options.cancelAfterGames !== undefined && summaries.length >= options.cancelAfterGames) {
      throw new SeasonBlockCancelledError(input.command.blockIndex, summaries.length);
    }
    const outcome = simulateSeasonBlockGame({
      input,
      game,
      effects,
      health,
      options: {
        skipRecoveryTick: !(previousRound !== 0 && game.round > previousRound),
        ...shared,
      },
    });
    if ('interruption' in outcome) {
      throw new SeasonBlockInvariantError(
        `game ${game.gameId} interrupted: the human franchise ${outcome.interruption.humanFranchiseId} cannot field a legal five from health availability`,
        { seed: input.command.runId, gameId: game.gameId, blockIndex: input.command.blockIndex },
      );
    }
    effects = outcome.effects;
    health = outcome.health;
    previousRound = game.round;
    summaries.push(outcome.summary);
    if (outcome.retainedDetail !== null) retainedDetails.push(outcome.retainedDetail);
  }
  return assembleSeasonBlockCandidate({ input, summaries, retainedDetails, effects, health });
}

export function handleSubmitSeasonBlockCommand(
  input: SeasonSubmitBlockCommandInput,
): SeasonSubmitBlockResult {
  const rejection = seasonBlockRejection(input, input.acceptedCommandIds);
  if (rejection !== null) return { status: 'rejected', rejection };
  try {
    const checkpoint = simulateSeasonBlock(input);
    return { status: 'accepted', checkpoint };
  } catch (error) {
    if (error instanceof SeasonBlockValidationError) {
      return { status: 'rejected', rejection: error.rejection };
    }
    throw error;
  }
}

export function resumeSeasonBlockFromPending(input: {
  run: SeasonRun;
  pending: SeasonPendingBlockCandidate;
  command: SeasonResumeSeasonBlockCommand;
}): SeasonResumeSeasonBlockResult {
  const { run, pending, command } = input;
  if (command.runId !== run.runId) {
    return {
      status: 'rejected',
      commandId: command.commandId,
      rejection: { code: 'run-mismatch', expectedRunId: run.runId },
    };
  }
  if (pending.blockIndex !== command.blockIndex) {
    return {
      status: 'rejected',
      commandId: command.commandId,
      rejection: {
        code: 'block-mismatch',
        blockIndex: command.blockIndex,
        pendingBlockIndex: pending.blockIndex,
      },
    };
  }
  if (pending.rotationDigest !== command.rotationDigest) {
    return {
      status: 'rejected',
      commandId: command.commandId,
      rejection: {
        code: 'rotation-digest-mismatch',
        rotationDigest: command.rotationDigest,
        pendingRotationDigest: pending.rotationDigest,
      },
    };
  }
  return {
    status: 'accepted',
    commandId: command.commandId,
    blockIndex: pending.blockIndex,
    nextGameId: pending.nextGameId,
  };
}
