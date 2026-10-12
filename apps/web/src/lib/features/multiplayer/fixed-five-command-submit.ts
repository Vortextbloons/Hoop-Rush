import type {
  FixedFiveCommand,
  FixedFiveCommandPayload,
  FixedFiveCommandReceipt,
  FixedFiveMultiplayerTransport,
  FixedFiveParticipantId,
  Id,
  CommandId,
} from '@hoop-rush/data-contracts';
import {
  FIXED_FIVE_COMMAND_POLICY,
  FIXED_FIVE_SINGLE_ATTEMPT_POLICY,
  runSubmission,
} from '$lib/submit';

const STALE_RETRY_SAFE_KINDS: ReadonlySet<FixedFiveCommandPayload['kind']> = new Set([
  'ready',
  'reroll',
  'classic-pick',
  'classic-reposition',
  'duel-claim',
  'sandbox-place',
  'sandbox-reposition',
  'sandbox-remove',
]);

type FixedFiveOutboundCommand = Omit<FixedFiveCommand, 'ordinal'> & {
  ordinal?: number;
  expectedRevision?: number;
};

export interface SubmitFixedFiveCommandInput {
  submitCommand: FixedFiveMultiplayerTransport['submitCommand'];
  roomId: Id;
  commandId: CommandId;
  actorParticipantId: FixedFiveParticipantId;
  payload: FixedFiveCommandPayload;
  expectedRevision?: number;
  resync: () => Promise<void>;
  retry?: boolean;
  retryAfterResync?: () => boolean;
}

export interface SubmitFixedFiveCommandResult {
  receipt: FixedFiveCommandReceipt;
  retried: boolean;
}

export async function submitFixedFiveCommand(
  input: SubmitFixedFiveCommandInput,
): Promise<SubmitFixedFiveCommandResult> {
  const command: FixedFiveOutboundCommand = {
    schemaVersion: 1 as const,
    roomId: input.roomId,
    commandId: input.commandId,
    actorParticipantId: input.actorParticipantId,
    payload: input.payload,
    expectedRevision: input.expectedRevision,
  };
  const policy =
    input.retry === false ? FIXED_FIVE_SINGLE_ATTEMPT_POLICY : FIXED_FIVE_COMMAND_POLICY;
  const report = await runSubmission(policy, command, {
    submit: (current) => input.submitCommand(current),
    classify: (receipt) =>
      receipt.accepted
        ? 'accepted'
        : receipt.rejectionCode === 'stale-revision'
          ? 'stale'
          : 'rejected',
    canRetry: () =>
      STALE_RETRY_SAFE_KINDS.has(input.payload.kind) || input.retryAfterResync?.() === true,
    revise: (current, receipt) => ({ ...current, expectedRevision: receipt.revision }),
    resync: input.resync,
  });
  if (report.receipt === null) throw report.error;
  return { receipt: report.receipt, retried: report.retried };
}
