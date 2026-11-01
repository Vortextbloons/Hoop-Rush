import { describe, expect, it } from 'bun:test';
import {
  ROOM_PROTOCOL_VERSION,
  checkRoomProtocol,
  describeLegacyRoomRejection,
  roomProtocolSchema,
} from './multiplayer-protocol.ts';
import { multiplayerGameKindSchema } from './multiplayer-lobby.ts';

/**
 * A real Draft Duel room snapshot, valid against its own published contract.
 *
 * Built from the schema's own required fields rather than a copy of the
 * transport, so this stays a protocol test rather than a fixture of one mode.
 */
function realDraftDuelState(): unknown {
  return {
    roomId: 'room-1',
    code: '1234',
    codeActive: true,
    settings: {
      schemaVersion: 1,
      fairness: 'fair',
      presentation: 'ratings',
      timerPolicyVersion: 'draft-duel-autopick-v1',
      versions: roomProtocolSchema['draft-duel'].settings.shape.versions.parse({
        dataVersion: 'd',
        ratingsVersion: 'r',
        catalogVersion: 'c',
        catalogHash: 'a'.repeat(64),
        playerVersionIdVersion: 'p',
        positionNormalizationVersion: 'pos',
        engineVersion: 'e',
        profileVersion: 'pr',
        seedDerivationVersion: 's',
        multiplayerVersion: 'm',
        autopickVersion: 'draft-duel-autopick-v1',
      }),
    },
    phase: 'lobby',
    revision: 0,
    commandCount: 0,
    rootSeed: null,
    members: [
      {
        participantId: 'p1',
        online: true,
        ready: false,
        nextGameReady: null,
        locked: false,
        lastSeenAt: null,
      },
      {
        participantId: 'p2',
        online: false,
        ready: false,
        nextGameReady: null,
        locked: false,
        lastSeenAt: null,
      },
    ],
    deadline: null,
    series: null,
    broadcast: null,
    resultDigest: null,
    confirmedDigest: null,
    successorRoomId: null,
    expiresAt: '2026-11-01T00:00:00.000Z',
    createdAt: '2026-11-01T00:00:00.000Z',
  };
}

describe('room protocol table', () => {
  it('covers exactly the multiplayer modes, with no second list of ids', () => {
    const tableModes = Object.keys(roomProtocolSchema).sort();
    const declared = [...multiplayerGameKindSchema.options].sort();
    expect(tableModes).toEqual(declared);
  });

  it('gives every mode a settings, state, command, payload, receipt, and verification schema', () => {
    for (const [mode, entry] of Object.entries(roomProtocolSchema)) {
      expect(entry.protocolVersion, mode).toBe(ROOM_PROTOCOL_VERSION);
      for (const key of [
        'settings',
        'state',
        'command',
        'commandPayload',
        'commandReceipt',
        'verificationReceipt',
      ] as const) {
        expect(entry[key], `${mode}.${key}`).toBeDefined();
      }
    }
  });

  it('declares transient events only for modes that actually publish them', () => {
    // Fixed-five and cap-rush are snapshot-driven; inventing an event type for
    // them would be a meaningless capability the spec warns against.
    expect(roomProtocolSchema['fixed-five'].transientEvent).toBeNull();
    expect(roomProtocolSchema['cap-rush'].transientEvent).toBeNull();
    expect(roomProtocolSchema['draft-duel'].transientEvent).not.toBeNull();
    expect(roomProtocolSchema.havoc.transientEvent).not.toBeNull();
  });
});

describe('checkRoomProtocol', () => {
  it('accepts a matching mode and protocol version', () => {
    const check = checkRoomProtocol({
      mode: 'draft-duel',
      protocolVersion: ROOM_PROTOCOL_VERSION,
      state: realDraftDuelState(),
    });
    expect(check.ok).toBe(true);
  });

  it('refuses a room written by a different protocol version', () => {
    const check = checkRoomProtocol({
      mode: 'draft-duel',
      protocolVersion: ROOM_PROTOCOL_VERSION - 1,
      state: realDraftDuelState(),
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe('unsupported-version');
  });

  it('refuses an unknown mode', () => {
    const check = checkRoomProtocol({
      mode: 'season-run',
      protocolVersion: ROOM_PROTOCOL_VERSION,
      state: {},
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe('unsupported-mode');
  });

  it('refuses state that does not belong to the declared mode', () => {
    // Draft Duel state declared as cap-rush: the pair itself is the problem.
    const check = checkRoomProtocol({
      mode: 'cap-rush',
      protocolVersion: ROOM_PROTOCOL_VERSION,
      state: realDraftDuelState(),
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe('malformed-envelope');
  });
});

describe('legacy room rejection', () => {
  it('tells the player to start a new room instead of half-serving the old one', () => {
    expect(describeLegacyRoomRejection(1)).toContain('protocol 1');
    expect(describeLegacyRoomRejection(1)).toContain('Start a new room');
  });
});
