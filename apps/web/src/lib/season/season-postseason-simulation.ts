import {
  SEASON_RUN_SCHEMA_VERSION,
  type CommandId,
  type EraSimulationProfile,
  type FranchiseId,
  type Id,
  type SeasonAdvancePostseasonCommand,
  type SeasonAdvancePostseasonRejection,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonGameSummary,
  type SeasonPostseasonSummary,
  type SeasonRun,
  type SeasonRunStage,
  type PostseasonGameId,
} from '@hoop-rush/data-contracts';
import { handleSeasonRunCommand } from '@hoop-rush/engine';
import type { SeasonPostseasonGameResolver } from '@hoop-rush/engine';
export interface SeasonPostseasonSimulationRequest {
  commandId: CommandId;
  runId: Id;
  expectedStateRevision: number;
  expectedStateDigest: string;
  targetGameId: PostseasonGameId;
  humanFranchiseId: FranchiseId | null;
  catalog: SeasonDraftCatalog;
  profile: EraSimulationProfile;
  run: SeasonRun;
  effects: SeasonEffectsState;
  regularSeasonSummaries: readonly SeasonGameSummary[];
  resolver?: SeasonPostseasonGameResolver;
}
export interface SeasonPostseasonSimulationAccepted {
  run: SeasonRun;
  summaries: SeasonPostseasonSummary[];
  advancedGameIds: PostseasonGameId[];
  stage: SeasonRunStage;
  nextDecision: 'rotation' | 'none';
  nextGameId: PostseasonGameId | null;
  aiNextGameId: PostseasonGameId | null;
}
export type SeasonPostseasonSimulationOutcome =
  | {
      kind: 'accepted';
      accepted: SeasonPostseasonSimulationAccepted;
    }
  | {
      kind: 'rejected';
      commandId: CommandId;
      rejection: SeasonAdvancePostseasonRejection;
    };
export function simulateSeasonPostseasonCommand(
  request: SeasonPostseasonSimulationRequest,
): SeasonPostseasonSimulationOutcome {
  const command: SeasonAdvancePostseasonCommand = {
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    command: 'advance-postseason',
    commandId: request.commandId,
    runId: request.runId,
    expectedStateRevision: request.expectedStateRevision,
    expectedStateDigest: request.expectedStateDigest,
    targetGameId: request.targetGameId,
  };
  const output = handleSeasonRunCommand(command, {
    run: request.run,
    pending: null,
    humanFranchiseId: request.humanFranchiseId,
    catalog: request.catalog,
    profile: request.profile,
    effects: request.effects,
    regularSeasonSummaries: request.regularSeasonSummaries,
    ...(request.resolver !== undefined ? { postseasonGameResolver: request.resolver } : {}),
  });
  const envelope = output.result;
  if (envelope.command !== 'advance-postseason') {
    throw new Error(`postseason simulation dispatched an unexpected command: ${envelope.command}`);
  }
  if (envelope.result.status === 'rejected') {
    return { kind: 'rejected', commandId: request.commandId, rejection: envelope.result.rejection };
  }
  const accepted = envelope.result;
  return {
    kind: 'accepted',
    accepted: {
      run: output.run,
      summaries: output.postseasonSummaries ?? [],
      advancedGameIds: [...accepted.advancedGameIds],
      stage: accepted.stage,
      nextDecision: accepted.nextDecision,
      nextGameId: accepted.nextGameId,
      aiNextGameId: accepted.aiNextGameId,
    },
  };
}
