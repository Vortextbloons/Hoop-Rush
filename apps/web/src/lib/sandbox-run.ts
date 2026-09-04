import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { LINEUP_STRUCTURE, type PeakPlayerSeason, type RunPlayerSelection, type Seed, } from '@hoop-rush/data-contracts';
import { createChallenge, createEngineContext, toSimulationPlayer, type ChallengeCreation, } from '@hoop-rush/engine';
import { challengeRepository } from '$lib/challenge-repo';
import { randomUUID } from '$lib/random-id';
import { FIXED_SANDBOX_ERA, loadRunPreamble } from '$lib/run-preamble';
export async function startSandboxRun(players: PeakPlayerSeason[], seed: Seed): Promise<void> {
    if (players.length !== 5) {
        throw new Error('A lineup needs exactly five players.');
    }
    const { profile, bracket } = await loadRunPreamble();
    const selections: RunPlayerSelection[] = players.map((p) => ({
        playerId: p.playerId,
        franchiseId: p.franchiseId,
        eraId: p.eraId,
    }));
    const sample = players[0];
    const context = createEngineContext();
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
        engineVersion: context.engineVersion,
        profile,
        bracket,
    };
    const run = createChallenge({ ...creation, runSeed: seed });
    await challengeRepository.saveActiveRun({
        recordId: 'active',
        saveSchemaVersion: 2,
        run,
    });
    void goto(resolve('/sandbox/challenge'));
}
