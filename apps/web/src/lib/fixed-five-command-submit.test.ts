import { describe, expect, it } from 'vitest';
import {
  commandIdSchema,
  contentHashSchema,
  idSchema,
  type FixedFiveCommandReceipt,
} from '@hoop-rush/data-contracts';
import { submitFixedFiveCommand } from '$lib/fixed-five-command-submit';

describe('fixed-five command submission', () => {
  it('resyncs and retries a result confirmation at the authoritative revision', async () => {
    const roomId = idSchema.parse('room-1');
    const commandId = commandIdSchema.parse('confirm-1');
    const digest = contentHashSchema.parse('a'.repeat(64));
    const revisions: Array<number | undefined> = [];
    const submitCommand = (command: {
      expectedRevision?: number;
    }): Promise<FixedFiveCommandReceipt> => {
      revisions.push(command.expectedRevision);
      if (command.expectedRevision !== 8) {
        return Promise.resolve({
          roomId,
          commandId,
          ordinal: -1,
          accepted: false,
          rejectionCode: 'stale-revision',
          revision: 8,
        });
      }
      return Promise.resolve({
        roomId,
        commandId,
        ordinal: 12,
        accepted: true,
        rejectionCode: null,
        revision: 9,
      });
    };

    const result = await submitFixedFiveCommand({
      submitCommand,
      roomId,
      commandId,
      actorParticipantId: 'p1',
      payload: { kind: 'confirm-result', resultDigest: digest, verified: false },
      expectedRevision: 7,
      resync: async () => Promise.resolve(),
      retryAfterResync: () => true,
    });

    expect(result.receipt.accepted).toBe(true);
    expect(result.retried).toBe(true);
    expect(revisions).toEqual([7, 8]);
  });
});
