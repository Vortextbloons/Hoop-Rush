import { canonicalJson } from '@hoop-rush/data-contracts';

/**
 * Shared command admission for in-memory multiplayer transports.
 *
 * Milestone 2 of `spec/refactors/shared-mode-infrastructure.md`. This owns the
 * order of checks every transport repeats; it does not own mode rules, receipt
 * shapes, or rejection vocabularies.
 *
 * Why the reason/code split: the four transports currently use three disjoint
 * spelling sets for the same concepts (`duplicate-command` vs `command-conflict`,
 * `phase` vs `invalid-phase`, `membership` vs `not-a-member`). The spec requires
 * rejected receipts to keep their per-mode behavior until that divergence is
 * normalized deliberately, so this module reports a neutral `reason` and each
 * mode maps it to its own published code. That keeps the difference visible in
 * one table per mode instead of scattered through the checks.
 */

/** Minimal structural view of a zod-like schema; matches what transports pass today. */
export interface SafeParsedSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

/** Why admission refused a command, independent of any mode's published wording. */
export type CommandAdmissionReason =
  | 'invalid-command-id'
  | 'payload-too-large'
  | 'actor-mismatch'
  | 'payload-mismatch'
  | 'stale-revision'
  | 'illegal-payload';

/**
 * How a mode spells each refusal.
 *
 * `payload-too-large` is optional because only modes that configure
 * `maxPayloadBytes` can produce it. Configuring a size limit without a code is
 * a programming error and throws.
 *
 * `RejectionCode` lets each mode constrain its spelling set — Havoc uses a
 * closed union, Draft Duel uses plain strings — without this module knowing
 * either vocabulary.
 */
export interface CommandRejectionCodes<RejectionCode extends string = string> {
  'invalid-command-id': RejectionCode;
  'actor-mismatch': RejectionCode;
  'payload-mismatch': RejectionCode;
  'stale-revision': RejectionCode;
  'illegal-payload': RejectionCode;
  'payload-too-large'?: RejectionCode;
}

export type CommandAdmission<
  Payload,
  CommandId extends string = string,
  RejectionCode extends string = string,
> =
  | { kind: 'rejected'; reason: CommandAdmissionReason; code: RejectionCode }
  /** The command ID was already accepted with this exact actor and payload. */
  | { kind: 'replayed'; commandId: CommandId; ordinal: number | null }
  | { kind: 'accepted'; commandId: CommandId; payload: Payload; payloadHash: string };

/** An already-accepted command, projected into the shape admission needs. */
export interface AcceptedCommandIdentity {
  commandId: string;
  actor: string;
  ordinal: number | null;
}

export interface CommandAdmissionInput<
  Payload,
  CommandId extends string = string,
  RejectionCode extends string = string,
> {
  commandId: unknown;
  actor: string;
  payload: unknown;
  /** Room revision the client believed it was writing against. */
  expectedRevision: number | undefined;
  /** Current authoritative room revision. */
  revision: number;
  /** Ordinal the client asked for, when the mode numbers commands. */
  ordinal: number | undefined;
  /** Accepted commands in acceptance order. */
  accepted: readonly AcceptedCommandIdentity[];
  /** Canonical payload hash recorded when the command was accepted. */
  payloadHashOf(commandId: string): string | undefined;
  payloadSchema: SafeParsedSchema<Payload>;
  commandIdSchema: SafeParsedSchema<CommandId>;
  codes: CommandRejectionCodes<RejectionCode>;
  /** Envelope budget in bytes, measured on the canonical payload JSON. */
  maxPayloadBytes?: number;
}

/**
 * Decide whether a command may proceed, without mutating anything.
 *
 * Check order is fixed and matches each transport's existing behavior:
 * command identity, payload size, duplicate replay, expected revision,
 * ordinal continuity, payload schema. Mode rules run afterwards in the caller.
 */
export function decideCommandAdmission<
  Payload,
  CommandId extends string = string,
  RejectionCode extends string = string,
>(
  input: CommandAdmissionInput<Payload, CommandId, RejectionCode>,
): CommandAdmission<Payload, CommandId, RejectionCode> {
  const reject = (
    reason: CommandAdmissionReason,
    code: RejectionCode,
  ): CommandAdmission<Payload, CommandId, RejectionCode> => ({
    kind: 'rejected',
    reason,
    code,
  });

  const parsedId = input.commandIdSchema.safeParse(input.commandId);
  if (!parsedId.success) return reject('invalid-command-id', input.codes['invalid-command-id']);
  const commandId = parsedId.data;

  const payloadHash = canonicalJson(input.payload);
  if (input.maxPayloadBytes !== undefined) {
    if (new TextEncoder().encode(payloadHash).length > input.maxPayloadBytes) {
      const code = input.codes['payload-too-large'];
      if (code === undefined) {
        throw new Error(
          'command admission: maxPayloadBytes is set but no payload-too-large code was provided',
        );
      }
      return reject('payload-too-large', code);
    }
  }

  const existing = input.accepted.find((entry) => entry.commandId === commandId);
  if (existing !== undefined) {
    if (existing.actor !== input.actor) {
      return reject('actor-mismatch', input.codes['actor-mismatch']);
    }
    if (input.payloadHashOf(commandId) !== payloadHash) {
      return reject('payload-mismatch', input.codes['payload-mismatch']);
    }
    return { kind: 'replayed', commandId, ordinal: existing.ordinal };
  }

  if (input.expectedRevision !== undefined && input.expectedRevision !== input.revision) {
    return reject('stale-revision', input.codes['stale-revision']);
  }

  if (input.ordinal !== undefined && input.ordinal !== input.accepted.length) {
    return reject('stale-revision', input.codes['stale-revision']);
  }

  const parsed = input.payloadSchema.safeParse(input.payload);
  if (!parsed.success) return reject('illegal-payload', input.codes['illegal-payload']);

  return { kind: 'accepted', commandId, payload: parsed.data, payloadHash };
}

/**
 * Record an accepted command's identity.
 *
 * Both pilots keep the same two structures for this — a `commandIds` set and a
 * `payloadHashes` map — so this is shared state rather than a wrapper around
 * mode code. Appending the command itself stays in each mode, because their log
 * shapes genuinely differ (Draft Duel stores commands; Havoc stores entries
 * carrying the resulting revision).
 */
export function rememberAcceptedCommand(
  record: { commandIds: Set<string>; payloadHashes: Map<string, string> },
  commandId: string,
  payloadHash: string,
): void {
  record.commandIds.add(commandId);
  record.payloadHashes.set(commandId, payloadHash);
}
