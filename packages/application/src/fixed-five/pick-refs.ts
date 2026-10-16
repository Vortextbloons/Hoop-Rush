import type { FixedFiveParticipantId } from '@hoop-rush/data-contracts';
import type { DraftReplay, FixedFiveCandidate, FixedFivePickRef } from '@hoop-rush/engine';
import type { FixedFiveSessionAssets } from './session.ts';

function sandboxCandidateForPick(
  assets: FixedFiveSessionAssets,
  playerId: string,
  versionId?: string,
): FixedFiveCandidate {
  const candidate =
    (versionId ? assets.pool.find((entry) => entry.playerVersionId === versionId) : null) ??
    assets.poolById.get(playerId);
  if (!candidate || candidate.playerId !== playerId) {
    throw new Error(`sandbox pick ${playerId} has no matching pool record`);
  }
  return candidate;
}

export function refsForParticipant(
  replay: DraftReplay,
  assets: FixedFiveSessionAssets,
  participant: FixedFiveParticipantId,
): FixedFivePickRef[] {
  if (replay.mode === 'duel') {
    return replay.state.picks
      .filter((p) => p.participantId === participant)
      .map((p) => ({
        playerId: p.playerId,
        franchiseId: p.franchiseId,
        eraId: p.eraId,
        slotIndex: p.slotIndex,
      }));
  }
  if (replay.mode === 'sandbox-duel') {
    return replay.state.picks
      .filter((p) => p.participantId === participant)
      .map((pick) => {
        const candidate = sandboxCandidateForPick(assets, pick.playerId, pick.playerVersionId);
        return {
          playerId: pick.playerId,
          franchiseId: candidate.franchiseId,
          eraId: candidate.eraId,
          slotIndex: pick.slotIndex,
          playerVersionId: candidate.playerVersionId,
        };
      });
  }
  if (replay.mode === 'sandbox-shared-82') {
    if (replay.draftStyle === 'snake') {
      return replay.state.picks
        .filter((p) => p.participantId === participant)
        .map((pick) => {
          const candidate = sandboxCandidateForPick(assets, pick.playerId, pick.playerVersionId);
          return {
            playerId: pick.playerId,
            franchiseId: candidate.franchiseId,
            eraId: candidate.eraId,
            slotIndex: pick.slotIndex,
            playerVersionId: candidate.playerVersionId,
          };
        });
    }
    const builder = participant === 'p1' ? replay.p1 : replay.p2;
    return builder.placements.map((placement) => {
      const candidate = assets.poolById.get(placement.playerId);
      if (!candidate) throw new Error(`sandbox pick ${placement.playerId} has no pool record`);
      return {
        playerId: placement.playerId,
        franchiseId: candidate.franchiseId,
        eraId: candidate.eraId,
        slotIndex: placement.slotIndex,
      };
    });
  }
  const draft = participant === 'p1' ? replay.p1 : replay.p2;
  return draft.picks.map((pick) => ({
    playerId: pick.playerId,
    franchiseId: pick.franchiseId,
    eraId: pick.eraId,
    slotIndex: pick.slotIndex,
  }));
}
