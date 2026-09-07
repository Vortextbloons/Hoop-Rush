import type {
  SeasonDraftCommand,
  SeasonDraftState,
  SeasonPublicCommandEnvelope,
} from '@hoop-rush/data-contracts';
import {
  seasonDigestHex,
  seasonNamespaceSeed,
  seasonDraftCommandSchema,
  seasonDraftCommandPayloadSchema,
} from '@hoop-rush/data-contracts';
function isDraftCommand(value: unknown): value is SeasonDraftCommand {
  return seasonDraftCommandSchema.safeParse(value).success;
}
export function draftCommandId(rootSeed: string, kind: string, ...parts: string[]): string {
  const seed = seasonNamespaceSeed(rootSeed, 'draft', kind, ...parts);
  const hex = seasonDigestHex(seed);
  return `${kind}-${hex.slice(0, 16)}`.slice(0, 64);
}
export function envelopeToDraftCommand(
  env: SeasonPublicCommandEnvelope,
  state: SeasonDraftState | null,
): SeasonDraftCommand | null {
  if ('accepted' in env && env.accepted === false) {
    return null;
  }
  const raw: unknown = env.payload;
  if (isDraftCommand(raw)) return raw;
  if (typeof raw !== 'object' || raw === null) return null;
  if (!('kind' in raw)) return null;
  const kind: unknown = raw.kind;
  if (typeof kind !== 'string') return null;
  switch (kind) {
    case 'create-season-draft':
    case 'draw-season-offer':
    case 'select-draft-player':
    case 'finalize-human-rosters':
    case 'generate-ai-league': {
      const parsed = seasonDraftCommandPayloadSchema.safeParse(raw);
      if (!parsed.success) return null;
      return {
        commandId: env.commandId,
        expectedRevision: state?.revision ?? 0,
        payload: parsed.data,
      };
    }
    case 'room-draft-pick': {
      if (!('participantId' in raw) || !('playerVersionId' in raw)) return null;
      const participantId: unknown = raw.participantId;
      const playerVersionId: unknown = raw.playerVersionId;
      if (
        (participantId !== 'p1' && participantId !== 'p2') ||
        typeof playerVersionId !== 'string'
      ) {
        return null;
      }
      const mapped: unknown = {
        kind: 'select-draft-player',
        participantId,
        playerVersionId,
      };
      const parsed = seasonDraftCommandPayloadSchema.safeParse(mapped);
      if (!parsed.success) return null;
      if (parsed.data.kind !== 'select-draft-player') return null;
      return {
        commandId: env.commandId,
        expectedRevision: state?.revision ?? 0,
        payload: parsed.data,
      };
    }
    default:
      return null;
  }
}
