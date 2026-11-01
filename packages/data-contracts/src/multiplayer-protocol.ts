/**
 * Bumped when room envelopes change shape. Distinct from:
 * - storage schema versions (`saveSchemaVersion`, `SAVE_SCHEMA_VERSION`)
 * - domain save versions per mode (`DRAFT_DUEL_SAVE_SCHEMA_VERSION`, ...)
 * - engine versions and rules locks
 *
 * The spec requires these stay separate so a rules change does not force a
 * storage migration, and vice versa.
 */
export const ROOM_PROTOCOL_VERSION = 2;

/**
 * Reject a legacy room outright rather than half-serving it.
 *
 * The spec requires old clients be told to start a new room, not silently
 * misinterpreted. Server-side enforcement is what stops a stale tab from
 * mutating new room state; this is the client-side half of the same rule.
 */
export function describeLegacyRoomRejection(roomProtocolVersion: number): string {
  return `This room uses protocol ${String(roomProtocolVersion)}, which is no longer supported. Start a new room to play.`;
}
