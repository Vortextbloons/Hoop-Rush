import {
  type SeasonCandidateCheckpoint,
  type SeasonPendingBlockCandidate,
  type SeasonResumeSeasonBlockCommand,
  type SeasonResumeSeasonBlockResult,
  type SeasonRun,
  type SeasonSubmitBlockResult,
} from '@hoop-rush/data-contracts';
import { assembleSeasonBlockCandidate } from './assembly.ts';
import { SeasonBlockInvariantError, SeasonBlockValidationError } from './errors.ts';
import {
  defaultSeasonBlockGameSharedOptions,
  seasonBlockGameSteps,
  type SeasonBlockIterationAccumulator,
} from './iteration.ts';
import type {
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
  const blockIndex = input.command.blockIndex;
  const shared = defaultSeasonBlockGameSharedOptions(input);
  let accumulator: SeasonBlockIterationAccumulator | null = null;
  for (const step of seasonBlockGameSteps({
    input,
    blockIndex,
    sharedOptions: shared,
    cancelAfterGames: options.cancelAfterGames,
  })) {
    if (step.kind === 'interrupted') {
      throw new SeasonBlockInvariantError(
        `game ${step.interruption.nextGameId} interrupted: the human franchise ${step.interruption.humanFranchiseId} cannot field a legal five from health availability`,
        {
          seed: input.command.runId,
          gameId: step.interruption.nextGameId,
          blockIndex: input.command.blockIndex,
        },
      );
    }
    if (step.kind === 'complete' || step.kind === 'game') {
      accumulator = step.accumulator;
    }
  }
  if (accumulator === null) {
    throw new SeasonBlockInvariantError('season block iteration produced no accumulator', {
      blockIndex,
    });
  }
  const { summaries, retainedDetails, effects, health } = accumulator;
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
