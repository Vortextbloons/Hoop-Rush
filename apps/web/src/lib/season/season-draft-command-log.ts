import type {
  SeasonDraftCommand,
  SeasonDraftState,
  SeasonPublicCommandEnvelope,
} from '@hoop-rush/data-contracts';
import { seasonDigestHex, seasonNamespaceSeed } from '@hoop-rush/data-contracts';
const DRAFT_PAYLOAD_KINDS = new Set([
  'create-season-draft',
  'draw-season-offer',
  'select-draft-player',
  'finalize-human-rosters',
  'generate-ai-league',
  'reveal-draft-roll',
  'claim-draft-pool',
]);
export function draftCommandId(rootSeed: string, kind: string, ...parts: string[]): string {
  const seed = seasonNamespaceSeed(rootSeed, 'draft', kind, ...parts);
  const hex = seasonDigestHex(seed);
  return `${kind}-${hex.slice(0, 16)}`.slice(0, 64);
}
function isDraftCommand(value: unknown): value is SeasonDraftCommand {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.commandId === 'string' &&
    typeof v.expectedRevision === 'number' &&
    v.payload !== null &&
    typeof v.payload === 'object' &&
    typeof (v.payload as Record<string, unknown>).kind === 'string'
  );
}
export function envelopeToDraftCommand(
  env: SeasonPublicCommandEnvelope,
  state: SeasonDraftState | null,
): SeasonDraftCommand | null {
  if (
    (
      env as SeasonPublicCommandEnvelope & {
        accepted?: boolean;
      }
    ).accepted === false
  ) {
    return null;
  }
  const raw = env.payload;
  if (isDraftCommand(raw)) return raw;
  if (!raw || typeof raw !== 'object' || !('kind' in (raw as Record<string, unknown>))) {
    return null;
  }
  const payload = raw as SeasonDraftCommand['payload'];
  if (DRAFT_PAYLOAD_KINDS.has(payload.kind)) {
    return {
      commandId: env.commandId,
      expectedRevision: state?.revision ?? 0,
      payload,
    };
  }
  if ((payload as unknown as Record<string, unknown>).kind === 'room-draft-pick') {
    const p = payload as unknown as {
      participantId: string;
      playerVersionId: string;
    };
    return {
      commandId: env.commandId,
      expectedRevision: state?.revision ?? 0,
      payload: {
        kind: 'select-draft-player',
        participantId: p.participantId as 'p1' | 'p2',
        playerVersionId: p.playerVersionId,
      },
    };
  }
  return null;
}
