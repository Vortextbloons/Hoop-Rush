import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import {
  LINEUP_STRUCTURE,
  type ClassicDraftState,
  type EraSimulationProfile,
  type LeagueRecord,
  type OpponentBracket,
  type PeakPlayerSeason,
  type RunPlayerSelection,
  type Seed,
} from '@hoop-rush/data-contracts';
import {
  classic,
  createChallenge,
  createEngineContext,
  deriveAttemptSeed,
  toSimulationPlayer,
  type ChallengeCreation,
} from '@hoop-rush/engine';
import { getManifest } from '#lib/data.js';
import { randomUUID } from '#lib/ids.js';
import { resolvePlayerRefs } from '#lib/player-refs.js';
import { FIXED_SANDBOX_ERA, loadRunPreamble } from '#lib/run-preamble.js';
import { challengeRepository } from './challenge-repo';
import { setClassicGuardBypass } from './classic-nav-guard';
import { leaguePrecompute } from './league-precompute';
import { profileRepository, selectedProfile } from '#lib/features/profile/profile.js';

interface ChallengeRunPreamble {
  profile: EraSimulationProfile;
  bracket: OpponentBracket;
  league: LeagueRecord | null;
  engineVersion: string;
}

async function loadChallengeRunPreamble(runSeed: Seed): Promise<ChallengeRunPreamble> {
  const [{ profile, bracket }, league] = await Promise.all([
    loadRunPreamble(),
    leaguePrecompute.ensure(runSeed),
  ]);
  return { profile, bracket, league, engineVersion: createEngineContext().engineVersion };
}

export async function startClassicRun(draft: ClassicDraftState, runSeed: Seed): Promise<void> {
  if (draft.status !== 'complete') {
    throw new Error('The classic draft is not complete.');
  }
  if (draft.picks.length !== 5) {
    throw new Error('A classic draft needs exactly five picks.');
  }
  const pickBySlot = new Map(draft.picks.map((pick) => [pick.slotIndex, pick]));
  const refs = [0, 1, 2, 3, 4].map((slotIndex) => {
    const pick = pickBySlot.get(slotIndex);
    if (!pick) {
      throw new Error(`The classic draft has no pick for slot ${String(slotIndex)}.`);
    }
    return { playerId: pick.playerId, franchiseId: pick.franchiseId, eraId: pick.eraId };
  });
  const [{ profile, bracket, league, engineVersion }, players] = await Promise.all([
    loadChallengeRunPreamble(runSeed),
    getManifest().then((manifest) => resolvePlayerRefs(refs, manifest)),
  ]);
  const sample = players[0];
  const creation = classic.createClassicChallenge(draft, {
    runId: randomUUID(),
    runSeed,
    players: players.map((player) => toSimulationPlayer(player)),
    dataVersion: profile.dataVersion,
    ratingVersion: sample?.source.ratingsVersion ?? 'unknown',
    positionNormalizationVersion: sample?.positions.normalizationVersion ?? 'position-v1',
    engineVersion,
    profile,
    bracket,
    eraId: FIXED_SANDBOX_ERA,
    homeDisplayName: players
      .map((p) => p.displayName)
      .join(' · ')
      .slice(0, 96),
    ...(league ? { league } : {}),
  });
  const run = createChallenge({
    ...creation,
    selections: creation.selections.map((selection, slot) => ({
      ...selection,
      seasonKey: players[slot]?.seasonKey,
    })),
  });
  // The league record uses the draft seed, while games use the first attempt seed.
  const firstAttemptRun = { ...run, runSeed: deriveAttemptSeed(runSeed, 0) };
  await selectedProfile();
  await profileRepository().bind(`challenge:${firstAttemptRun.runId}`);
  await challengeRepository.promoteClassicDraftToRun(
    { recordId: 'active', saveSchemaVersion: 2, run: firstAttemptRun },
    draft.draftId,
  );
  setClassicGuardBypass(true);
  void goto(resolve('classic/challenge/'));
}

export async function startSandboxRun(players: PeakPlayerSeason[], seed: Seed): Promise<void> {
  if (players.length !== 5) {
    throw new Error('A lineup needs exactly five players.');
  }
  const { profile, bracket, league, engineVersion } = await loadChallengeRunPreamble(seed);
  const selections: RunPlayerSelection[] = players.map((p) => ({
    playerId: p.playerId,
    franchiseId: p.franchiseId,
    eraId: p.eraId,
    seasonKey: p.seasonKey,
  }));
  const sample = players[0];
  const creation: ChallengeCreation = {
    runId: randomUUID(),
    mode: 'sandbox',
    franchiseId: null,
    eraId: FIXED_SANDBOX_ERA,
    homeDisplayName: players
      .map((p) => p.displayName)
      .join(' · ')
      .slice(0, 96),
    lineup: {
      structure: [...LINEUP_STRUCTURE],
      assignments: players.map((player, slotIndex) => ({
        slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
        playerId: player.playerId,
        positions: player.positions.playable,
      })),
    },
    players: players.map((player) => toSimulationPlayer(player)),
    selections,
    runSeed: seed,
    dataVersion: profile.dataVersion,
    ratingVersion: sample?.source.ratingsVersion ?? 'unknown',
    positionNormalizationVersion: sample?.positions.normalizationVersion ?? 'position-v1',
    engineVersion,
    profile,
    bracket,
    ...(league ? { league } : {}),
  };
  const run = createChallenge(creation);
  const firstAttemptRun = { ...run, runSeed: deriveAttemptSeed(seed, 0) };

  await selectedProfile();
  await profileRepository().bind(`challenge:${firstAttemptRun.runId}`);
  await challengeRepository.saveActiveRun({
    recordId: 'active',
    saveSchemaVersion: 2,
    run: firstAttemptRun,
  });
  void goto(resolve('sandbox/challenge/'));
}
