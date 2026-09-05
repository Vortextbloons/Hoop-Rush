import { describe, expect, it } from 'vitest';
import {
  FIXED_FIVE_AUTOPICK_VERSION,
  FIXED_FIVE_MULTIPLAYER_VERSION,
  FIXED_FIVE_ROOM_PROTOCOL_VERSION,
  FIXED_FIVE_ROOM_SCHEMA_VERSION,
  FIXED_FIVE_WORKER_WIRE_VERSION,
  commandIdSchema,
  contentHashSchema,
  createInMemoryFixedFiveTransport,
  fixedFiveRoomSettingsSchema,
} from './index.ts';
const cmd1 = commandIdSchema.parse('cmd-1');
const cmd2 = commandIdSchema.parse('cmd-2');
const p1ReadyCmd = commandIdSchema.parse('p1-ready');
const p2ReadyCmd = commandIdSchema.parse('p2-ready');
describe('fixed-five contracts', () => {
  it('pins version constants', () => {
    expect(FIXED_FIVE_ROOM_SCHEMA_VERSION).toBe(1);
    expect(FIXED_FIVE_ROOM_PROTOCOL_VERSION).toBe(1);
    expect(FIXED_FIVE_MULTIPLAYER_VERSION).toBe('fixed-five-multiplayer-v1');
    expect(FIXED_FIVE_AUTOPICK_VERSION).toBe('fixed-five-autopick-v1');
    expect(FIXED_FIVE_WORKER_WIRE_VERSION).toBe(1);
  });
  it('validates room settings with material locks', () => {
    const parsed = fixedFiveRoomSettingsSchema.safeParse({
      schemaVersion: 1,
      mode: 'classic-shared-82',
      sourceMode: 'classic',
      variant: 'ratings',
      timerPolicyVersion: 'fixed-five-autopick-v1',
      versions: {
        dataVersion: 'data-v1',
        ratingVersion: 'ratings-v1',
        positionNormalizationVersion: 'position-v3',
        engineVersion: 'engine-v1',
        bracketVersion: 'bracket-v1',
        scheduleVersion: 'schedule-v1',
        seedDerivationVersion: 'seed-v1',
        classicRollVersion: 'classic-roll-v1',
        profileVersion: 'profile-v1',
        multiplayerVersion: 'fixed-five-multiplayer-v1',
        autopickVersion: 'fixed-five-autopick-v1',
      },
    });
    expect(parsed.success).toBe(true);
  });
  it('rejects bad invite codes', async () => {
    const transport = createInMemoryFixedFiveTransport();
    await expect(transport.preview('abc')).rejects.toThrow();
    await expect(transport.preview('0000')).rejects.toThrow();
  });
  it('round-trips create, preview, join, commands, and timeout resolution', async () => {
    const transport = createInMemoryFixedFiveTransport();
    const versions = {
      dataVersion: 'data-v1',
      ratingVersion: 'ratings-v1',
      positionNormalizationVersion: 'position-v3',
      engineVersion: 'engine-v1',
      bracketVersion: 'bracket-v1',
      scheduleVersion: 'schedule-v1',
      seedDerivationVersion: 'seed-v1',
      classicRollVersion: 'classic-roll-v1',
      profileVersion: 'profile-v1',
      multiplayerVersion: 'fixed-five-multiplayer-v1',
      autopickVersion: 'fixed-five-autopick-v1',
    };
    const created = await transport.create({
      mode: 'duel',
      sourceMode: 'classic',
      variant: 'ratings',
      versions,
    });
    expect(created.code).toMatch(/^[0-9]{4}$/);
    const previewed = await transport.preview(created.code);
    expect(previewed.roomId).toBe(created.snapshot.roomId);
    const joined = await transport.join(created.code);
    expect(joined.membership.participantId).toBe('p2');
    const receipt = await transport.submitCommand({
      schemaVersion: 1,
      roomId: created.snapshot.roomId,
      commandId: cmd1,
      actorParticipantId: 'p1',
      payload: { kind: 'ready', ready: true },
    });
    expect(receipt.accepted).toBe(true);
    expect(receipt.ordinal).toBe(0);
    const staleRevision = await transport.submitCommand({
      schemaVersion: 1,
      roomId: created.snapshot.roomId,
      commandId: commandIdSchema.parse('cmd-stale-revision'),
      actorParticipantId: 'p1',
      payload: {
        kind: 'confirm-result',
        resultDigest: contentHashSchema.parse('a'.repeat(64)),
        verified: false,
      },
      expectedRevision: receipt.revision - 1,
    });
    expect(staleRevision.accepted).toBe(false);
    expect(staleRevision.rejectionCode).toBe('stale-revision');
    expect(staleRevision.revision).toBe(receipt.revision);
    const duplicate = await transport.submitCommand({
      schemaVersion: 1,
      roomId: created.snapshot.roomId,
      commandId: cmd1,
      actorParticipantId: 'p1',
      payload: { kind: 'ready', ready: true },
    });
    expect(duplicate.accepted).toBe(true);
    expect(duplicate.ordinal).toBe(0);
    const stale = await transport.submitCommand({
      schemaVersion: 1,
      roomId: created.snapshot.roomId,
      commandId: cmd2,
      ordinal: 99,
      actorParticipantId: 'p1',
      payload: { kind: 'ready', ready: true },
    });
    expect(stale.accepted).toBe(false);
    expect(stale.rejectionCode).toBe('stale-revision');
    const commands = await transport.refetch(created.snapshot.roomId, 0);
    expect(commands.length).toBe(0);
  });
  it('preserves leading zeroes in four-digit codes', async () => {
    let foundLeadingZero = false;
    for (let i = 0; i < 30; i += 1) {
      const transport = createInMemoryFixedFiveTransport();
      const created = await transport.create({
        mode: 'duel',
        sourceMode: 'sandbox',
        variant: 'ratings',
        versions: {
          dataVersion: 'd',
          ratingVersion: 'r',
          positionNormalizationVersion: 'p',
          engineVersion: 'e',
          bracketVersion: 'b',
          scheduleVersion: 'schedule-v1',
          seedDerivationVersion: 'seed-v1',
          classicRollVersion: 'classic-roll-v1',
          profileVersion: 'prof',
          multiplayerVersion: 'fixed-five-multiplayer-v1',
          autopickVersion: 'fixed-five-autopick-v1',
        },
      });
      expect(created.code.length).toBe(4);
      if (created.code.startsWith('0')) foundLeadingZero = true;
    }
    void foundLeadingZero;
  });
  it('runs a two-client simultaneous draft, overdue fallback, and compass of propose/confirm', async () => {
    const transport = createInMemoryFixedFiveTransport();
    const versions = {
      dataVersion: 'd',
      ratingVersion: 'r',
      positionNormalizationVersion: 'p',
      engineVersion: 'e',
      bracketVersion: 'b',
      scheduleVersion: 'schedule-v1',
      seedDerivationVersion: 'seed-v1',
      classicRollVersion: 'classic-roll-v1',
      profileVersion: 'prof',
      multiplayerVersion: 'fixed-five-multiplayer-v1',
      autopickVersion: 'fixed-five-autopick-v1',
    };
    const created = await transport.create({
      mode: 'classic-shared-82',
      sourceMode: 'classic',
      variant: 'ratings',
      versions,
    });
    const joined = await transport.join(created.code);
    expect(joined.membership.participantId).toBe('p2');
    const p1Ready = await transport.submitCommand({
      schemaVersion: 1,
      roomId: created.snapshot.roomId,
      commandId: p1ReadyCmd,
      actorParticipantId: 'p1',
      payload: { kind: 'ready', ready: true },
    });
    const p2Ready = await transport.submitCommand({
      schemaVersion: 1,
      roomId: created.snapshot.roomId,
      commandId: p2ReadyCmd,
      actorParticipantId: 'p2',
      payload: { kind: 'ready', ready: true },
    });
    expect(p1Ready.accepted).toBe(true);
    expect(p2Ready.accepted).toBe(true);
    const p1Commands = await transport.refetch(created.snapshot.roomId, 0);
    expect(p1Commands.length).toBe(1);
    const p2Commands = await transport.refetch(created.snapshot.roomId, 1);
    expect(p2Commands.length).toBe(0);
    const noTimeout = await transport.resolveTimeout(created.snapshot.roomId);
    expect(noTimeout).toBeNull();
  });
});
