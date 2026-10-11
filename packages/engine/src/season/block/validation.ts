import {
  SEASON_BLOCK_COUNT,
  SEASON_ROUND_COUNT,
  franchiseIdSchema,
  normalizeEvolutionState,
  type FranchiseId,
  type Position,
  type SeasonBlockRunContext,
  type SeasonRun,
  type SeasonSubmitBlockRejection,
} from '@hoop-rush/data-contracts';
import { freeAgencyUnresolvedWindowIndex } from '../free-agency.ts';
import { seasonObjectiveChoicesForBlock } from '../objectives.ts';
import { seasonRotationSetDigest, validateSeasonRotation } from '../rotation.ts';
import { SeasonBlockValidationError } from './errors.ts';
import { emptyFreeAgencyStateOf } from './preparation.ts';
import type { SeasonBlockSimulationInput } from './types.ts';

export function seasonAcceptedBlockCount(completedRounds: number): number {
  if (completedRounds <= 0) return 0;
  if (completedRounds > SEASON_ROUND_COUNT) {
    throw new Error(`completedRounds ${String(completedRounds)} out of range`);
  }
  return Math.ceil(completedRounds / 10);
}
export function seasonNextBlockIndex(completedRounds: number): number | null {
  if (completedRounds >= SEASON_ROUND_COUNT) return null;
  return seasonAcceptedBlockCount(completedRounds);
}
function cursorOfBlock(blockIndex: number): number {
  return blockIndex === 0 ? 0 : blockIndex * 10;
}

export function seasonBlockRejection(
  input: SeasonBlockSimulationInput,
  acceptedCommandIds?: readonly string[],
): SeasonSubmitBlockRejection | null {
  const command = input.command;
  const run = input.run;
  if (command.runId !== run.runId) {
    return { code: 'run-mismatch', expectedRunId: run.runId };
  }
  if (acceptedCommandIds !== undefined && acceptedCommandIds.includes(command.commandId)) {
    return { code: 'duplicate-command', commandId: command.commandId };
  }
  const currentRevision = seasonAcceptedBlockCount(run.cursor.completedRounds);
  if (command.expectedRevision !== currentRevision) {
    return {
      code: 'stale-cursor',
      currentRevision,
      currentCompletedRounds: run.cursor.completedRounds,
    };
  }
  const expectedBlockIndex = seasonNextBlockIndex(run.cursor.completedRounds);
  if (expectedBlockIndex === null || command.blockIndex !== expectedBlockIndex) {
    return {
      code: 'non-boundary-block',
      expectedBlockIndex: expectedBlockIndex ?? SEASON_BLOCK_COUNT - 1,
      submittedBlockIndex: command.blockIndex,
    };
  }
  if (run.cursor.completedRounds !== cursorOfBlock(command.blockIndex)) {
    return {
      code: 'non-boundary-block',
      expectedBlockIndex,
      submittedBlockIndex: command.blockIndex,
    };
  }
  const hasChallengeInput =
    input.challengeDeal !== undefined ||
    input.challengeDealsByFranchise !== undefined ||
    input.challengeState !== undefined ||
    command.challengeIds !== undefined;
  if (hasChallengeInput) {
    const deal = input.challengeDeal ?? null;
    const commandIds = command.challengeIds ?? null;
    if (command.blockIndex >= 8) {
      if (commandIds !== null) {
        return {
          code: 'invalid-challenge',
          expected: 'none',
          blockIndex: command.blockIndex,
        };
      }
      if (deal !== null) {
        return {
          code: 'invalid-challenge',
          expected: 'none',
          blockIndex: command.blockIndex,
        };
      }
    } else {
      if (deal === null) {
        return {
          code: 'invalid-challenge',
          expected: 'required',
          blockIndex: command.blockIndex,
        };
      }
      if (deal.blockIndex !== command.blockIndex) {
        return {
          code: 'invalid-challenge',
          expected: 'not-offered',
          blockIndex: command.blockIndex,
        };
      }
      if (commandIds !== null) {
        const dealIds = [...deal.challengeIds].sort();
        const cmdIds = [...commandIds].sort();
        if (
          dealIds.length !== 3 ||
          cmdIds.length !== 3 ||
          dealIds.some((id, index) => id !== cmdIds[index])
        ) {
          return {
            code: 'invalid-challenge',
            expected: 'not-offered',
            blockIndex: command.blockIndex,
          };
        }
      }
    }
  } else if (input.objectives !== undefined) {
    if (command.blockIndex <= 7) {
      if (command.objectiveId === null) {
        return {
          code: 'invalid-objective',
          expected: 'required',
          blockIndex: command.blockIndex,
        };
      }
      const selection = input.objectives.selections[command.blockIndex];
      const offered = seasonObjectiveChoicesForBlock(run.rootSeed, command.blockIndex);
      const selectedAndOffered =
        selection !== undefined &&
        selection.objectiveId === command.objectiveId &&
        offered.includes(command.objectiveId);
      if (!selectedAndOffered) {
        return {
          code: 'invalid-objective',
          expected: 'not-offered',
          objectiveId: command.objectiveId,
          blockIndex: command.blockIndex,
        };
      }
    } else if (command.objectiveId !== null) {
      return {
        code: 'invalid-objective',
        expected: 'none',
        objectiveId: command.objectiveId,
        blockIndex: command.blockIndex,
      };
    }
  }
  const preBlockFreeAgency =
    input.freeAgency ?? (input.run as Partial<SeasonRun>).freeAgency ?? emptyFreeAgencyStateOf(run);
  const unresolvedWindowIndex = freeAgencyUnresolvedWindowIndex(preBlockFreeAgency);
  if (unresolvedWindowIndex !== null) {
    return {
      code: 'free-agency-unresolved',
      windowIndex: unresolvedWindowIndex,
      blockIndex: command.blockIndex,
    };
  }
  if (command.blockIndex >= 3) {
    const gate = evolutionSelectionGate({
      blockIndex: command.blockIndex,
      run,
      humanFranchiseId: input.humanFranchiseId,
    });
    if (gate !== null) return gate;
  }
  const computedDigest = seasonRotationSetDigest(run.rotations);
  const franchiseFailures: Array<{
    franchiseId: FranchiseId;
    reasons: string[];
  }> = [];
  if (computedDigest !== command.rotationDigest) {
    for (const rotation of run.rotations) {
      franchiseFailures.push({
        franchiseId: franchiseIdSchema.parse(rotation.franchiseId),
        reasons: [
          `rotation set digest ${computedDigest} does not match the submitted lock ${command.rotationDigest}`,
        ],
      });
    }
    return { code: 'invalid-rotations', franchiseFailures };
  }
  for (const rotation of run.rotations) {
    const roster = run.rosters.find((entry) => entry.franchiseId === rotation.franchiseId);
    const activePlayerIds = new Set([...rotation.starters, ...rotation.benchOrder]);
    const memberPlayable = new Map<string, readonly Position[]>();
    for (const player of roster?.players ?? []) {
      if (!activePlayerIds.has(player.playerVersionId)) continue;
      const expanded = input.expanded.get(player.playerVersionId);
      if (expanded !== undefined) {
        memberPlayable.set(expanded.playerVersionId, expanded.positions);
      }
    }
    const reasons = validateSeasonRotation(rotation, memberPlayable);
    if (reasons.length > 0) {
      franchiseFailures.push({
        franchiseId: franchiseIdSchema.parse(rotation.franchiseId),
        reasons,
      });
    }
  }
  if (franchiseFailures.length > 0) {
    return { code: 'invalid-rotations', franchiseFailures };
  }
  return null;
}
export function requireValidSeasonBlockCommand(input: SeasonBlockSimulationInput): void {
  const rejection = seasonBlockRejection(input);
  if (rejection !== null) throw new SeasonBlockValidationError(rejection);
}

export function evolutionSelectionGate(input: {
  blockIndex: number;
  run: SeasonRun | SeasonBlockRunContext;
  humanFranchiseId: string | null;
}): SeasonSubmitBlockRejection | null {
  if (input.blockIndex < 3) return null;
  const evolution = normalizeEvolutionState(
    (input.run as unknown as { evolution?: unknown }).evolution,
  );
  if (evolution.discovery === null) return null;
  const humanFid =
    input.humanFranchiseId ??
    input.run.league.teams.find((t) => t.control === 'human')?.franchiseId ??
    null;
  if (
    humanFid !== null &&
    (evolution.selections as unknown as Record<string, unknown>)[humanFid] === undefined
  ) {
    return { code: 'evolution-selection-required', blockIndex: input.blockIndex };
  }
  return null;
}
