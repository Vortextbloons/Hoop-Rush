import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import { buildManifest, buildSeasonLeague, buildSeasonRunFixture } from '@hoop-rush/test-fixtures';
import { generateSeasonSchedule } from '@hoop-rush/engine';
import type { HoopRushManifest, SeasonRun } from '@hoop-rush/data-contracts';
import { franchiseIdSchema, seedSchema } from '@hoop-rush/data-contracts';
import HubPage from '../../../routes/season/run/+page.svelte';
import { SeasonRunShell } from '$lib/season/season-shell-state.svelte';
import { SEASON_RUN_SHELL_CONTEXT } from '$lib/season/season-shell-context';
import { playerSliceOf } from '$lib/season/season-player-slice';
import { createRotationEditor } from '$lib/season/season-rotation-editor';
import type { SeasonRunPlayerSliceEntry } from '@hoop-rush/persistence';
import { mockSvelteKitApp } from '../../../test/svelte-testing';
mockSvelteKitApp();
const MANIFEST: HoopRushManifest = buildManifest();
function shellWithRun(run: SeasonRun): SeasonRunShell {
    const shell = new SeasonRunShell();
    const rosterEntries = run.rosters
        .flatMap((roster) => roster.players)
        .map((entry) => ({
        playerVersionId: entry.playerVersionId,
        playerId: entry.playerId,
        franchiseId: entry.franchiseId,
        eraId: entry.eraId,
        seasonKey: entry.seasonKey,
        displayName: entry.displayName,
        positionsPlayable: ['PG', 'SG', 'SF', 'PF', 'C'],
        summaryRatings: { overallRating: 80, offenseRating: 82, defenseRating: 74 },
        staminaRating: 70,
        durabilityRating: 70,
    })) satisfies SeasonRunPlayerSliceEntry[];
    shell.snapshot = {
        run,
        summaries: [],
        retainedDetails: [],
        acceptedBlocks: [],
        effects: {
            schemaVersion: 2,
            playerStates: run.rosters
                .flatMap((roster) => roster.players)
                .map((entry) => ({
                playerVersionId: entry.playerVersionId,
                fatigueBasisPoints: 0,
                recentLoadBasisPoints: 0,
                lastCompletedRound: 0,
            })),
            inactivePlayerStates: [],
            pairStates: [],
            archivedPairs: [],
        },
    };
    shell.run = run;
    shell.index = {
        runId: run.runId,
        rootSeed: run.rootSeed,
        humanFranchiseId: franchiseIdSchema.parse('lakers'),
        completedRounds: 0,
        revision: 0,
        humanWins: 0,
        humanLosses: 0,
        updatedAtIso: '2026-01-01T00:00:00.000Z',
    };
    shell.manifest = MANIFEST;
    shell.playerSlice = playerSliceOf(rosterEntries);
    shell.playerSliceReady = true;
    shell.ready = true;
    shell.humanFranchiseId = 'lakers';
    shell.humanTeam = run.league.teams.find((team) => team.franchiseId === 'lakers') ?? null;
    shell.nextBlockIndex = 0;
    shell.seasonComplete = false;
    const humanRotation = run.rotations.find((rotation) => rotation.franchiseId === 'lakers');
    const humanRoster = run.rosters.find((roster) => roster.franchiseId === 'lakers');
    if (humanRotation !== undefined && humanRoster !== undefined) {
        shell.editor = createRotationEditor(humanRotation, humanRoster.players.map((entry) => ({
            playerVersionId: entry.playerVersionId,
            displayName: entry.displayName,
            playable: ['PG', 'SG', 'SF', 'PF', 'C'],
            franchiseId: entry.franchiseId,
            eraId: entry.eraId,
            seasonKey: entry.seasonKey,
        })));
    }
    return shell;
}
describe('Season Run hub submit gating (performance pass)', () => {
    it('enables the simulate button for a fresh run with the slice loaded', () => {
        const league = buildSeasonLeague({}, { humanFranchiseId: 'lakers' });
        const schedule = generateSeasonSchedule({
            league,
            seed: seedSchema.parse('a1b2c3d4e5f60718293a4b5c6d7e8f9a'),
        });
        const run = buildSeasonRunFixture({
            schedule,
            humanFranchiseId: 'lakers',
            stateDigest: 'a'.repeat(32),
        });
        const shell = shellWithRun(run);
        const { container } = render(HubPage, {
            props: {},
            context: new Map([[SEASON_RUN_SHELL_CONTEXT, shell]]),
        });
        const button = container.querySelector('button[data-can-submit]');
        expect(button).not.toBeNull();
        expect(button?.getAttribute('data-can-submit')).toBe('true');
        expect(button?.getAttribute('data-editor-ready')).toBe('true');
        expect((button as HTMLButtonElement | null)?.disabled).toBe(false);
    });
});
