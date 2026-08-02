import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import type { PeakPlayerSeason, Seed } from '@hoop-rush/data-contracts';
import {
  createChallenge,
  createEngineContext,
  simulateChallengeBestOf,
  toSimulationPlayer,
  type ChallengeCreation,
} from '@hoop-rush/engine';
import { challengeRepository } from '$lib/challenge-repo';
import { getBracket, getEraSimulationProfile, getManifest } from '$lib/data';

/**
 * The single authoritative path from a resolved five-player lineup to an
 * active saved sandbox run (spec/01 sandbox loop). The draft page picks five
 * peak player-seasons from one franchise's selected-decade pool; the run's
 * franchiseId is that slot and its eraId is the selected decade, which is
 * also the simulation environment era (spec/12 challenge contract).
 */

const LINEUP_STRUCTURE = ['G', 'G', 'F', 'F', 'C'] as const;

/**
 * Creates the 82-game run for the given five players, saves it as the active
 * run, and navigates to the challenge page. Throws on any failure so the
 * caller can surface the error.
 */
export async function startSandboxRun(players: PeakPlayerSeason[], seed: Seed): Promise<void> {
  if (players.length !== 5) {
    throw new Error('A lineup needs exactly five players.');
  }
  const sample = players[0];
  if (!sample) {
    throw new Error('A lineup needs exactly five players.');
  }
  const franchiseId = sample.franchiseId;
  const eraId = sample.eraId;
  if (players.some((p) => p.franchiseId !== franchiseId || p.eraId !== eraId)) {
    throw new Error('All five players must come from the same franchise-era pool.');
  }
  const manifest = await getManifest();
  const profileEntry = manifest.eraSimulationProfiles.find((p) => p.eraId === eraId);
  if (!profileEntry) {
    throw new Error('The decade simulation profile is unavailable.');
  }
  if (!manifest.bracket) {
    throw new Error('The opponent bracket is unavailable.');
  }
  const [profile, bracket] = await Promise.all([
    getEraSimulationProfile(profileEntry),
    getBracket(manifest.bracket),
  ]);
  const context = createEngineContext();
  const creation: ChallengeCreation = {
    runId: crypto.randomUUID(),
    mode: 'sandbox',
    franchiseId,
    eraId,
    homeDisplayName: players
      .map((p) => p.displayName)
      .join(' · ')
      .slice(0, 96),
    lineup: {
      structure: [...LINEUP_STRUCTURE],
      assignments: players.map((player, slotIndex) => ({
        slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
        playerId: player.playerId,
        positions: player.positions.canonical,
      })),
    },
    players: players.map((player) => toSimulationPlayer(player)),
    runSeed: seed,
    dataVersion: profile.dataVersion,
    ratingVersion: sample.source.ratingsVersion,
    positionNormalizationVersion: sample.positions.normalizationVersion,
    engineVersion: context.engineVersion,
    profile,
    bracket,
  };
  // Sandbox simulates the complete season twice from derived attempt seeds
  // and keeps the best record; the chosen attempt's seed becomes the
  // persisted run seed so the paced reveal reproduces exactly those games.
  const chosen = simulateChallengeBestOf(creation, profile, context);
  const run = createChallenge({ ...creation, runSeed: chosen.runSeed });
  await challengeRepository.saveActiveRun({
    recordId: 'active',
    saveSchemaVersion: 2,
    run,
  });
  void goto(resolve('/sandbox/challenge'));
}
