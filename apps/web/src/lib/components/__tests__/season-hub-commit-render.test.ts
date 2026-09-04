import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import { generateSeasonSchedule } from '@hoop-rush/engine';
import { buildSeasonLeague, buildSeasonRunFixture } from '@hoop-rush/test-fixtures';
import type { SeasonGameSummary, SeasonRun } from '@hoop-rush/data-contracts';
import { franchiseIdSchema, idSchema, commandIdSchema, seedSchema, seasonGameIdSchema, } from '@hoop-rush/data-contracts';
import type { SeasonRunSnapshot } from '@hoop-rush/persistence';
import type { SeasonRunShellData } from '$lib/season/season-shell-context';
import { initialSeasonRunShellData } from '$lib/season/season-shell-context';
import { mockSvelteKitApp } from '../../../test/svelte-testing';
import SeasonRunShellWrapper from '../../../test/SeasonRunShellWrapper.svelte';
mockSvelteKitApp();
function runWithCommit(): SeasonRun {
    const league = buildSeasonLeague({}, { humanFranchiseId: 'lakers' });
    const seed = seedSchema.parse('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
    const schedule = generateSeasonSchedule({ league, seed });
    const run = buildSeasonRunFixture({
        schedule,
        league,
        seed,
        humanFranchiseId: 'lakers',
    });
    const summaries: SeasonGameSummary[] = [];
    const played = new Set<string>();
    for (const game of run.games) {
        if (game.round < 1 || game.round > 10)
            continue;
        if (played.has(game.gameId))
            continue;
        played.add(game.gameId);
        summaries.push({
            schemaVersion: 1,
            summaryVersion: 'season-game-summary-v3',
            gameId: game.gameId,
            round: game.round,
            homeFranchiseId: game.homeFranchiseId,
            awayFranchiseId: game.awayFranchiseId,
            status: 'final',
            overtimePeriods: 0,
            homeScore: 100 + (game.round % 5),
            awayScore: 90 + (game.round % 7),
            forfeitLoserFranchiseId: null,
            injuryEvents: [],
            homeBox: {
                franchiseId: game.homeFranchiseId,
                points: 100,
                fieldGoalsMade: 40,
                fieldGoalsAttempted: 88,
                threePointersMade: 10,
                threePointersAttempted: 30,
                freeThrowsMade: 20,
                freeThrowsAttempted: 26,
                offensiveRebounds: 10,
                defensiveRebounds: 30,
                assists: 24,
                steals: 7,
                blocks: 5,
                turnovers: 13,
                fouls: 19,
                possessions: 96,
            },
            awayBox: {
                franchiseId: game.awayFranchiseId,
                points: 90,
                fieldGoalsMade: 38,
                fieldGoalsAttempted: 86,
                threePointersMade: 9,
                threePointersAttempted: 28,
                freeThrowsMade: 19,
                freeThrowsAttempted: 25,
                offensiveRebounds: 9,
                defensiveRebounds: 29,
                assists: 22,
                steals: 8,
                blocks: 4,
                turnovers: 15,
                fouls: 21,
                possessions: 94,
            },
            homePlayers: [],
            awayPlayers: [],
        });
    }
    run.health = {
        schemaVersion: 1,
        healthVersion: 'season-health-v2',
        injuries: [
            {
                injuryId: 'inj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                playerVersionId: run.rosters[0]?.players[0]?.playerVersionId ?? 'pv-0',
                franchiseId: franchiseIdSchema.parse('lakers'),
                gameId: seasonGameIdSchema.parse('s000001'),
                type: 'soft-tissue',
                severity: 'moderate',
                occurredBeforeHalftime: false,
                sameGameReturn: false,
                sameGameReturned: null,
                missedGamesTotal: 12,
                missedGamesRemaining: 2,
                actualReturnRound: null,
                seasonEnding: false,
                rehabModifier: 0 as const,
                recurrenceWindowRoundsRemaining: 0,
                seedPath: ['e2e', 'fake-runner', 'health', 'active'],
            },
            {
                injuryId: 'inj-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                playerVersionId: run.rosters[0]?.players[1]?.playerVersionId ?? 'pv-1',
                franchiseId: franchiseIdSchema.parse('lakers'),
                gameId: seasonGameIdSchema.parse('s000002'),
                type: 'upper-body',
                severity: 'minor',
                occurredBeforeHalftime: true,
                sameGameReturn: true,
                sameGameReturned: true,
                missedGamesTotal: 4,
                missedGamesRemaining: 0,
                actualReturnRound: 10,
                seasonEnding: false,
                rehabModifier: 0 as const,
                recurrenceWindowRoundsRemaining: 6,
                seedPath: ['e2e', 'fake-runner', 'health', 'returned'],
            },
        ],
    };
    const ledger: SeasonRun['influence']['ledger'] = [];
    for (const franchiseId of run.league.teams.map((team) => team.franchiseId)) {
        ledger.push({
            entryId: idSchema.parse(`influence-initial-${franchiseId}`),
            franchiseId,
            source: 'initial-grant',
            blockIndex: null,
            commandId: null,
            requestedDelta: 2,
            appliedDelta: 2,
            balanceAfter: 2,
            explanation: 'Initial +2 Influence grant at run creation',
        });
        ledger.push({
            entryId: idSchema.parse(`influence-block-0-${franchiseId}`),
            franchiseId,
            source: 'block-grant',
            blockIndex: 0,
            commandId: commandIdSchema.parse('grant-0'),
            requestedDelta: 1,
            appliedDelta: 1,
            balanceAfter: 3,
            explanation: '+1 Influence grant for accepted block 1',
        });
    }
    run.influence.ledger = ledger;
    return run;
}
function shellWithCommit(): SeasonRunShellData {
    const run = runWithCommit();
    const snapshot = {
        run,
        summaries: runWithCommit()
            .games.filter((game) => game.round <= 10)
            .map((game) => ({
            schemaVersion: 1,
            summaryVersion: 'season-game-summary-v3',
            gameId: game.gameId,
            round: game.round,
            homeFranchiseId: game.homeFranchiseId,
            awayFranchiseId: game.awayFranchiseId,
            status: 'final' as const,
            overtimePeriods: 0,
            homeScore: 100,
            awayScore: 90,
            forfeitLoserFranchiseId: null,
            injuryEvents: [],
            homeBox: {
                franchiseId: game.homeFranchiseId,
                points: 0,
                fieldGoalsMade: 0,
                fieldGoalsAttempted: 0,
                threePointersMade: 0,
                threePointersAttempted: 0,
                freeThrowsMade: 0,
                freeThrowsAttempted: 0,
                offensiveRebounds: 0,
                defensiveRebounds: 0,
                assists: 0,
                steals: 0,
                blocks: 0,
                turnovers: 0,
                fouls: 0,
                possessions: 0,
            },
            awayBox: {
                franchiseId: game.awayFranchiseId,
                points: 0,
                fieldGoalsMade: 0,
                fieldGoalsAttempted: 0,
                threePointersMade: 0,
                threePointersAttempted: 0,
                freeThrowsMade: 0,
                freeThrowsAttempted: 0,
                offensiveRebounds: 0,
                defensiveRebounds: 0,
                assists: 0,
                steals: 0,
                blocks: 0,
                turnovers: 0,
                fouls: 0,
                possessions: 0,
            },
            homePlayers: [],
            awayPlayers: [],
        })),
        retainedDetails: [],
        acceptedBlocks: [
            {
                runId: run.runId,
                blockIndex: 0,
                completedRounds: 10,
                revision: 0,
                commandId: commandIdSchema.parse('cmd-0'),
                rotationDigest: '0'.repeat(32),
                checkpointDigest: '0'.repeat(32),
                summaryCount: 150,
                stateRevision: 1,
                stateDigest: '0'.repeat(32),
            },
        ],
        effects: {
            schemaVersion: 2,
            playerStates: [],
            inactivePlayerStates: [],
            pairStates: [],
            archivedPairs: [],
        },
    } satisfies SeasonRunSnapshot;
    const shell: SeasonRunShellData = {
        ...initialSeasonRunShellData(),
        ready: true,
        snapshot,
        league: run.league,
        playerSliceReady: true,
        run,
        humanFranchiseId: 'lakers',
        humanTeam: run.league.teams.find((team) => team.franchiseId === 'lakers') ?? null,
        nextBlockIndex: 1,
        health: run.health,
        influence: run.influence,
        trade: run.trade,
        objectives: run.objectives,
        playerName: (playerVersionId: string) => playerVersionId,
        franchiseName: (franchiseId: string) => franchiseId,
        franchiseAbbrev: (franchiseId: string) => franchiseId.slice(0, 3),
        quitRun: () => Promise.resolve({ ok: true, error: null }),
    };
    return shell;
}
describe('season hub commit rendering', () => {
    it('renders the hub after a block commit without duplicate-key errors', () => {
        const errors: Error[] = [];
        const originalOnError = window.onerror;
        window.onerror = (_event, _source, _lineno, _colno, error) => {
            if (error !== undefined)
                errors.push(error);
            return false;
        };
        try {
            const shell = shellWithCommit();
            render(SeasonRunShellWrapper, { props: { shell } });
        }
        finally {
            window.onerror = originalOnError;
        }
        expect(errors.filter((error) => error.message.includes('each_key_duplicate'))).toEqual([]);
    });
});
