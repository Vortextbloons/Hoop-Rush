import type {
  DraftDuelCommand,
  DraftDuelDraft,
  DraftDuelFairness,
  Seed,
} from '@hoop-rush/data-contracts';
import { applyDraftDuelPick, createDraftDuelDraft } from './draft.ts';
import type { DraftDuelCatalog } from './catalog.ts';

export interface DraftDuelLogReplayInput {
  rootSeed: Seed;
  fairness: DraftDuelFairness;
  catalog: DraftDuelCatalog;
  commands: readonly DraftDuelCommand[];
}

export function replayDraftDuelLog(input: DraftDuelLogReplayInput): DraftDuelDraft {
  const draftCommands = [...input.commands]
    .filter(
      (command) => command.payload.kind === 'pick' || command.payload.kind === 'timeout-autopick',
    )
    .sort((a, b) => a.ordinal - b.ordinal);
  let state = createDraftDuelDraft({
    rootSeed: input.rootSeed,
    fairness: input.fairness,
    catalog: input.catalog,
  });
  for (const command of draftCommands) {
    const payload = command.payload;
    if (payload.kind !== 'pick' && payload.kind !== 'timeout-autopick') continue;
    state = applyDraftDuelPick(state, input.catalog, {
      participantId: command.actorParticipantId,
      playerId: payload.playerId,
      playerVersionId: payload.playerVersionId,
      ...(payload.slotIndex !== undefined ? { slotIndex: payload.slotIndex } : {}),
    });
  }
  return state;
}
