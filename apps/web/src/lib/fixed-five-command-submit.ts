import type { FixedFiveCommandPayload, FixedFiveCommandReceipt, FixedFiveMultiplayerTransport, FixedFiveParticipantId, Id, CommandId, } from '@hoop-rush/data-contracts';
const STALE_RETRY_SAFE_KINDS: ReadonlySet<FixedFiveCommandPayload['kind']> = new Set([
    'ready',
    'reroll',
    'classic-pick',
    'duel-claim',
    'sandbox-place',
    'sandbox-remove',
]);
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
export async function submitFixedFiveCommand(input: SubmitFixedFiveCommandInput): Promise<SubmitFixedFiveCommandResult> {
    const command = {
        schemaVersion: 1 as const,
        roomId: input.roomId,
        commandId: input.commandId,
        actorParticipantId: input.actorParticipantId,
        payload: input.payload,
        expectedRevision: input.expectedRevision,
    };
    const receipt = await input.submitCommand(command);
    if (receipt.accepted || receipt.rejectionCode !== 'stale-revision') {
        return { receipt, retried: false };
    }
    await input.resync();
    const retrySafe = STALE_RETRY_SAFE_KINDS.has(input.payload.kind) || input.retryAfterResync?.() === true;
    if (input.retry === false || !retrySafe) {
        return { receipt, retried: false };
    }
    return {
        receipt: await input.submitCommand({ ...command, expectedRevision: receipt.revision }),
        retried: true,
    };
}
