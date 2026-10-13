import type {
  DraftDuelCommand,
  DraftDuelDraft,
  DraftDuelFairness,
  Seed,
} from '@hoop-rush/data-contracts';
import { DRAFT_DUEL_MULTIPLAYER_VERSION } from '@hoop-rush/data-contracts';
import { applyDraftDuelPick, createDraftDuelDraft, repositionDraftDuelCard } from './draft.ts';
import type { DraftDuelCatalog } from './catalog.ts';

export interface DraftDuelLogReplayInput {
  rootSeed: Seed;
  fairness: DraftDuelFairness;
  catalog: DraftDuelCatalog;
  commands: readonly DraftDuelCommand[];
  multiplayerVersion?: string;
}

const LEGACY_DRAFT_DUEL_MULTIPLAYER_VERSION = 'draft-duel-multiplayer-v1';

export function replayDraftDuelLog(input: DraftDuelLogReplayInput): DraftDuelDraft {
  const allowDisplacement =
    (input.multiplayerVersion ?? LEGACY_DRAFT_DUEL_MULTIPLAYER_VERSION) ===
    DRAFT_DUEL_MULTIPLAYER_VERSION;
  const draftCommands = [...input.commands]
    .filter(
      (command) =>
        command.payload.kind === 'pick' ||
        command.payload.kind === 'timeout-autopick' ||
        (allowDisplacement && command.payload.kind === 'reposition'),
    )
    .sort((a, b) => a.ordinal - b.ordinal);
  let state = createDraftDuelDraft({
    rootSeed: input.rootSeed,
    fairness: input.fairness,
    catalog: input.catalog,
  });
  for (const command of draftCommands) {
    const payload = command.payload;
    if (payload.kind === 'reposition') {
      state = repositionDraftDuelCard(state, input.catalog, {
        participantId: command.actorParticipantId,
        playerVersionId: payload.playerVersionId,
        slotIndex: payload.slotIndex,
      });
      continue;
    }
    if (payload.kind !== 'pick' && payload.kind !== 'timeout-autopick') continue;
    state = applyDraftDuelPick(
      state,
      input.catalog,
      {
        participantId: command.actorParticipantId,
        playerId: payload.playerId,
        playerVersionId: payload.playerVersionId,
        ...(payload.slotIndex !== undefined ? { slotIndex: payload.slotIndex } : {}),
      },
      { allowDisplacement },
    );
  }
  return state;
}
