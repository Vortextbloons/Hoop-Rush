import { describe, expect, it } from 'vitest';
import {
  commandIdSchema,
  createInMemoryFixedFiveTransport,
  defaultFixedFiveVersionLocks,
  playerIdSchema,
} from './index.ts';

describe('in-memory Fixed-Five sandbox deadlines', () => {
  it('advances a seeded snake deadline and rejects canonical duplicates', async () => {
    const transport = createInMemoryFixedFiveTransport({ seed: 'sandbox-snake-test' });
    const created = await transport.create({
      mode: 'sandbox-shared-82',
      sourceMode: 'sandbox',
      variant: 'ratings',
      versions: defaultFixedFiveVersionLocks({}),
    });
    let snapshot = created.snapshot;
    const start = await transport.submitCommand({
      schemaVersion: 1,
      roomId: snapshot.roomId,
      commandId: commandIdSchema.parse('start-sandbox-snake'),
      actorParticipantId: 'p1',
      payload: { kind: 'start' },
      expectedRevision: snapshot.revision,
    });
    expect(start.accepted).toBe(true);
    snapshot = (await transport.resume(snapshot.roomId)).snapshot;

    const rootSeed = snapshot.rootSeed;
    if (!rootSeed) throw new Error('sandbox snake test is missing a root seed');
    const first: 'p1' | 'p2' = Number.parseInt(rootSeed.slice(0, 2), 16) % 2 === 0 ? 'p1' : 'p2';
    const other: 'p1' | 'p2' = first === 'p1' ? 'p2' : 'p1';
    const expectedOrder: Array<'p1' | 'p2'> = [
      first,
      other,
      other,
      first,
      first,
      other,
      other,
      first,
      first,
      other,
    ];
    const counts = { p1: 0, p2: 0 };
    const observed: Array<'p1' | 'p2'> = [];

    for (let i = 0; i < expectedOrder.length; i += 1) {
      const deadline = snapshot.deadline;
      const actor = expectedOrder[i];
      if (!deadline || !actor) throw new Error('sandbox snake test is missing a deadline');
      expect(deadline.participantId).toBe(actor);
      observed.push(actor);
      const playerId = playerIdSchema.parse(`sandbox-player-${String(i)}`);
      const receipt = await transport.submitCommand({
        schemaVersion: 1,
        roomId: snapshot.roomId,
        commandId: commandIdSchema.parse(`sandbox-pick-${String(i)}`),
        actorParticipantId: actor,
        payload: {
          kind: 'sandbox-place',
          playerId,
          slotIndex: counts[actor],
        },
        expectedRevision: snapshot.revision,
      });
      expect(receipt.accepted).toBe(true);
      counts[actor] += 1;
      snapshot = (await transport.resume(snapshot.roomId)).snapshot;
      if (i === 0) {
        const nextDeadline = snapshot.deadline;
        if (!nextDeadline) throw new Error('sandbox snake test ended before the second pick');
        const duplicate = await transport.submitCommand({
          schemaVersion: 1,
          roomId: snapshot.roomId,
          commandId: commandIdSchema.parse('sandbox-duplicate-variant'),
          actorParticipantId: nextDeadline.participantId,
          payload: {
            kind: 'sandbox-place',
            playerId,
            slotIndex: 0,
          },
          expectedRevision: snapshot.revision,
        });
        expect(duplicate.accepted).toBe(false);
        expect(duplicate.rejectionCode).toBe('illegal-move');
      }
    }

    expect(observed).toEqual(expectedOrder);
    expect(snapshot.deadline).toBeNull();
  });
});
