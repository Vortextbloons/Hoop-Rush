import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import type { ClassicDraftState, Seed } from '@hoop-rush/data-contracts';
import {
  classic,
  createChallenge,
  createEngineContext,
  toSimulationPlayer,
} from '@hoop-rush/engine';
import { challengeRepository } from '$lib/challenge-repo';
import { randomUUID } from '$lib/random-id';
import { setClassicGuardBypass } from '$lib/classic-nav-guard';
import { resolvePlayerRefs } from '$lib/player-refs';
import { FIXED_SANDBOX_ERA, loadRunPreamble } from '$lib/run-preamble';

export async function startClassicRun(draft: ClassicDraftState, runSeed: Seed): Promise<void> {
  if (draft.status !== 'complete') {
    throw new Error('The classic draft is not complete.');
  }
  if (draft.picks.length !== 5) {
    throw new Error('A classic draft needs exactly five picks.');
  }
  const { manifest, profile, bracket } = await loadRunPreamble();

  const pickBySlot = new Map(draft.picks.map((pick) => [pick.slotIndex, pick]));
  const refs = [0, 1, 2, 3, 4].map((slotIndex) => {
    const pick = pickBySlot.get(slotIndex);
    if (!pick) {
      throw new Error(`The classic draft has no pick for slot ${String(slotIndex)}.`);
    }
    return { playerId: pick.playerId, franchiseId: pick.franchiseId, eraId: pick.eraId };
  });
  const players = await resolvePlayerRefs(refs, manifest);
  const sample = players[0];
  const context = createEngineContext();
  const creation = classic.createClassicChallenge(draft, {
    runId: randomUUID(),
    runSeed,
    players: players.map((player) => toSimulationPlayer(player)),
    dataVersion: profile.dataVersion,
    ratingVersion: sample?.source.ratingsVersion ?? 'unknown',
    positionNormalizationVersion: sample?.positions.normalizationVersion ?? 'position-v1',
    engineVersion: context.engineVersion,
    profile,
    bracket,
    eraId: FIXED_SANDBOX_ERA,
    homeDisplayName: players
      .map((p) => p.displayName)
      .join(' · ')
      .slice(0, 96),
  });

  const run = createChallenge(creation);
  await challengeRepository.promoteClassicDraftToRun(
    { recordId: 'active', saveSchemaVersion: 2, run },
    draft.draftId,
  );

  setClassicGuardBypass(true);
  void goto(resolve('/classic/challenge'));
}
