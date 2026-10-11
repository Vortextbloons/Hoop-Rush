import {
  canonicalJson,
  seasonDigestHex,
  type CommandId,
  type FranchiseId,
  type Id,
  type PostseasonGameId,
  type SeasonAdvancePostseasonRejection,
  type SeasonPostseasonScoreline,
  type SeasonPostseasonSummary,
  type SeasonRun,
  type SeasonRunCommand,
  type SeasonRunStage,
  type Seed,
} from '@hoop-rush/data-contracts';
import type { SeasonRunSnapshot } from '@hoop-rush/persistence';

export type SeasonPostseasonMode = 'advance' | 'spectate' | 'fast-forward';

export type SeasonPostseasonEvent =
  | {
      type: 'started';
      requestId: string;
      mode: SeasonPostseasonMode;
      targetGameId: PostseasonGameId | null;
      gamesTotal: number;
    }
  | {
      type: 'progress';
      requestId: string;
      gamesCompleted: number;
      gamesTotal: number;
      latestGameId: PostseasonGameId | null;
      latestResult: SeasonPostseasonScoreline | null;
    }
  | {
      type: 'committed';
      requestId: string;
      runId: Id;
      gameIds: PostseasonGameId[];
      snapshot: SeasonRunSnapshot;
    }
  | {
      type: 'complete';
      requestId: string;
      runId: Id;
      snapshot: SeasonRunSnapshot | null;
      stage: SeasonRunStage;
      nextDecision: 'rotation' | 'none';
      nextGameId: PostseasonGameId | null;
      aiNextGameId: PostseasonGameId | null;
      promoted: boolean;
    }
  | {
      type: 'rejected';
      requestId: string;
      command: SeasonRunCommand['command'];
      rejection: SeasonAdvancePostseasonRejection;
      message: string;
    }
  | {
      type: 'cancelled';
      requestId: string;
    }
  | {
      type: 'error';
      requestId: string;
      code: 'invariant-failure' | 'cancelled' | 'internal';
      message: string;
      seed: Seed | null;
      gameId: PostseasonGameId | null;
    };

export interface SeasonPostseasonRunInput {
  runId: Id;
  commandId: CommandId;
  targetGameId?: PostseasonGameId;
  humanFranchiseId: FranchiseId | null;
}

export interface SeasonPostseasonRunner {
  advancePostseason(input: SeasonPostseasonRunInput): string;
  spectatePostseasonGame(
    input: SeasonPostseasonRunInput & {
      targetGameId: string;
    },
  ): string;
  fastForwardPostseason(input: SeasonPostseasonRunInput): string;
  cancel(requestId: string): void;
  terminate(): void;
  prewarm(): void;
  subscribe(listener: (event: SeasonPostseasonEvent) => void): () => void;
}

export function seasonPostseasonCommitResultDigest(
  commandId: string,
  relatedGameIds: readonly string[],
  summaries: readonly SeasonPostseasonSummary[],
): string {
  return seasonDigestHex(
    canonicalJson({
      commandId,
      gameIds: [...relatedGameIds].sort(),
      summaryDigests: summaries.map((summary) => summary.resultDigest).sort(),
    }),
  );
}

export function seasonPostseasonTransactionIdsOf(run: SeasonRun, commandId: string): string[] {
  return run.transactions
    .filter((entry) => entry.commandId === commandId)
    .map((entry) => entry.transactionId);
}
