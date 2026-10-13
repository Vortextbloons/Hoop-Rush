import { describe, expect, it, vi } from 'vitest';
import {
  commandIdSchema,
  fixedFiveParticipantIdSchema,
  idSchema,
  type FixedFiveCommandPayload,
  type FixedFiveCommandReceipt,
} from '@hoop-rush/data-contracts';
import { submitFixedFiveCommand, type SubmitFixedFiveCommandInput } from './command-submit.ts';

const roomId = idSchema.parse('room-1');
const commandId = commandIdSchema.parse('cmd-1');
const actorParticipantId = fixedFiveParticipantIdSchema.parse('p1');
const safePayload = { kind: 'ready', ready: true } as FixedFiveCommandPayload;
const unsafePayload = {
  kind: 'propose-result',
  resultDigest: 'a'.repeat(64),
} as unknown as FixedFiveCommandPayload;

function receiptOf(
  accepted: boolean,
  revision: number,
  ordinal = revision,
): FixedFiveCommandReceipt {
  return {
    roomId,
    commandId,
    ordinal,
    accepted,
    rejectionCode: accepted ? null : 'stale-revision',
    revision,
  };
}

function inputFor(
  payload: FixedFiveCommandPayload,
  receipts: FixedFiveCommandReceipt[],
  overrides: Partial<SubmitFixedFiveCommandInput> = {},
): { input: SubmitFixedFiveCommandInput; submitCommand: ReturnType<typeof vi.fn> } {
  const submitCommand = vi.fn(() => {
    const next = receipts.shift();
    if (next === undefined) return Promise.reject(new Error('no receipt queued'));
    return Promise.resolve(next);
  });
  const input: SubmitFixedFiveCommandInput = {
    submitCommand,
    roomId,
    commandId,
    actorParticipantId,
    payload,
    expectedRevision: 3,
    resync: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  return { input, submitCommand };
}

describe('submitFixedFiveCommand', () => {
  it('resyncs and retries a stale retry-safe command against the fresh revision', async () => {
    const { input, submitCommand } = inputFor(safePayload, [
      receiptOf(false, 4),
      receiptOf(true, 5),
    ]);
    const result = await submitFixedFiveCommand(input);
    expect(result.retried).toBe(true);
    expect(result.receipt.accepted).toBe(true);
    expect(submitCommand).toHaveBeenCalledTimes(2);
    const secondCall = submitCommand.mock.calls[1]?.[0] as { expectedRevision?: number };
    expect(secondCall.expectedRevision).toBe(4);
    expect(input.resync).toHaveBeenCalledTimes(1);
  });

  it('does not retry a stale non-retry-safe command without a fresh recheck', async () => {
    const { input, submitCommand } = inputFor(unsafePayload, [receiptOf(false, 4)]);
    const result = await submitFixedFiveCommand(input);
    expect(result.retried).toBe(false);
    expect(result.receipt.accepted).toBe(false);
    expect(submitCommand).toHaveBeenCalledTimes(1);
    expect(input.resync).toHaveBeenCalledTimes(1);
  });

  it('retries a stale non-safe command when retryAfterResync validates it', async () => {
    const { input, submitCommand } = inputFor(
      unsafePayload,
      [receiptOf(false, 4), receiptOf(true, 5)],
      { retryAfterResync: () => true },
    );
    const result = await submitFixedFiveCommand(input);
    expect(result.retried).toBe(true);
    expect(result.receipt.accepted).toBe(true);
    expect(submitCommand).toHaveBeenCalledTimes(2);
  });

  it('honors retry:false and never issues a second attempt', async () => {
    const { input, submitCommand } = inputFor(safePayload, [receiptOf(false, 4)], {
      retry: false,
    });
    const result = await submitFixedFiveCommand(input);
    expect(result.retried).toBe(false);
    expect(submitCommand).toHaveBeenCalledTimes(1);
    expect(input.resync).not.toHaveBeenCalled();
  });
});
