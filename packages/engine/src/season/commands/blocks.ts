import type {
  SeasonBlockMismatchRejection,
  SeasonForfeitInterruptedGameCommand,
  SeasonGameMismatchRejection,
  SeasonNoPendingBlockRejection,
  SeasonResumeSeasonBlockCommand,
  SeasonRotationDigestMismatchRejection,
} from '@hoop-rush/data-contracts';
import { advancePendingAfterForfeit, seasonForfeitSummaryForGame } from '../health.ts';
import {
  SeasonRunCommandNotImplementedError,
  acceptedCommand,
  advanceRunState,
  baseValidation,
  economyRunOf,
  rejectedCommand,
  type SeasonRunCommandContext,
  type SeasonRunCommandOutput,
} from './shared.ts';
export function handleResumeSeasonBlock(
  command: SeasonResumeSeasonBlockCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const { run, pending } = context;
  const base = baseValidation(command, run, pending, context);
  if (base !== null) return base;
  if (pending === null) {
    const rejection: SeasonNoPendingBlockRejection = {
      code: 'no-pending-block',
      blockIndex: command.blockIndex,
    };
    return rejectedCommand(command, rejection, run, pending);
  }
  if (pending.blockIndex !== command.blockIndex) {
    const rejection: SeasonBlockMismatchRejection = {
      code: 'block-mismatch',
      blockIndex: command.blockIndex,
      pendingBlockIndex: pending.blockIndex,
    };
    return rejectedCommand(command, rejection, run, pending);
  }
  if (pending.rotationDigest !== command.rotationDigest) {
    const rejection: SeasonRotationDigestMismatchRejection = {
      code: 'rotation-digest-mismatch',
      rotationDigest: command.rotationDigest,
      pendingRotationDigest: pending.rotationDigest,
    };
    return rejectedCommand(command, rejection, run, pending);
  }
  return acceptedCommand(
    command,
    {
      blockIndex: pending.blockIndex,
      nextGameId: pending.nextGameId,
    },
    run,
    pending,
  );
}
export function handleForfeitInterruptedGame(
  command: SeasonForfeitInterruptedGameCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const { run, pending, humanFranchiseId } = context;
  const base = baseValidation(command, run, pending, context);
  if (base !== null) return base;
  const economyRun = economyRunOf(context);
  if (pending === null) {
    const rejection: SeasonNoPendingBlockRejection = {
      code: 'no-pending-block',
      blockIndex: command.blockIndex,
    };
    return rejectedCommand(command, rejection, run, pending);
  }
  if (pending.blockIndex !== command.blockIndex) {
    const rejection: SeasonBlockMismatchRejection = {
      code: 'block-mismatch',
      blockIndex: command.blockIndex,
      pendingBlockIndex: pending.blockIndex,
    };
    return rejectedCommand(command, rejection, run, pending);
  }
  if (pending.nextGameId !== command.nextGameId) {
    const rejection: SeasonGameMismatchRejection = {
      code: 'game-mismatch',
      nextGameId: command.nextGameId,
      pendingNextGameId: pending.nextGameId,
    };
    return rejectedCommand(command, rejection, run, pending);
  }
  if (humanFranchiseId === null) {
    throw new SeasonRunCommandNotImplementedError(
      'forfeit-interrupted-game requires a human franchise (the pending block only exists for human runs)',
    );
  }
  const forfeitedGameId = command.nextGameId;
  const summary = seasonForfeitSummaryForGame(run, forfeitedGameId, humanFranchiseId);
  const nextPending = advancePendingAfterForfeit(
    { ...pending, summaries: [...pending.summaries, summary] },
    forfeitedGameId,
  );
  const next = advanceRunState(economyRun);
  return acceptedCommand(
    command,
    {
      blockIndex: nextPending.blockIndex,
      forfeitedGameId,
      nextGameId: nextPending.nextGameId,
    },
    next,
    nextPending,
  );
}
