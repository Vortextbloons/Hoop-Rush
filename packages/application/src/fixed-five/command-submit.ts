import type {
  FixedFiveCommand,
  FixedFiveCommandPayload,
  FixedFiveCommandReceipt,
  FixedFiveMultiplayerTransport,
  FixedFiveParticipantId,
  Id,
  CommandId,
} from '@hoop-rush/data-contracts';
import { runSubmission } from '../submission.ts';
import { FIXED_FIVE_COMMAND_POLICY, FIXED_FIVE_SINGLE_ATTEMPT_POLICY } from './policies.ts';

const STALE_RETRY_SAFE_KINDS: ReadonlySet<FixedFiveCommandPayload['kind']> = new Set([
  'ready',
  'reroll',
  'classic-pick',
  'classic-reposition',
  'duel-claim',
  'duel-reposition',
  'sandbox-place',
  'sandbox-reposition',
  'sandbox-remove',
  'ready-next-game',
  'broadcast-start',
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
  resync: () => Promise<number | undefined>;
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
  let resyncedRevision: number | undefined;
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
    revise: (current, receipt) => ({
      ...current,
      expectedRevision: Math.max(resyncedRevision ?? receipt.revision, receipt.revision),
    }),
    resync: async () => {
      const fresh = await input.resync();
      if (typeof fresh === 'number') resyncedRevision = fresh;
    },
  });
  if (report.receipt === null) throw report.error;
  return { receipt: report.receipt, retried: report.retried };
}
