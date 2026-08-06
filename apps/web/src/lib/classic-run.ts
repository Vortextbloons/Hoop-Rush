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

/**
 * The single authoritative path from a completed classic draft to an active
 * saved run (spec/01 Classic loop). The draft page owns the five picks; this
 * module resolves them to full peak player-seasons in slot order (loading the
 * distinct franchise-era pools in parallel), builds the classic challenge
 * through the engine, promotes the active run, and navigates to the classic
 * challenge page. Like sandbox, every run simulates in the fixed '2010s'
 * environment era.
 */
export async function startClassicRun(draft: ClassicDraftState, runSeed: Seed): Promise<void> {
  if (draft.status !== 'complete') {
    throw new Error('The classic draft is not complete.');
  }
  if (draft.picks.length !== 5) {
    throw new Error('A classic draft needs exactly five picks.');
  }
  const { manifest, profile, bracket } = await loadRunPreamble();
  // Resolve the five picks to full peak records in slot order. Draft picks are
  // unique franchise/era pairs, so load each distinct pool exactly once and in
  // parallel (pools are cached by the data layer anyway).
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
  // The run is saved with the base run seed and no games; the challenge page
  // asks the worker to simulate the whole-run best-of and re-saves the chosen
  // attempt seed before the paced reveal starts (spec/01 Classic loop).
  const run = createChallenge(creation);
  await challengeRepository.promoteClassicDraftToRun(
    { recordId: 'active', saveSchemaVersion: 2, run },
    draft.draftId,
  );
  // The automatic launch is not a user navigation: mark the bypass so the
  // draft navigation guard lets the transition through without a prompt.
  setClassicGuardBypass(true);
  void goto(resolve('/classic/challenge'));
}
