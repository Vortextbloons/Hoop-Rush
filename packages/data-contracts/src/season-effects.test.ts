import { describe, expect, it } from 'vitest';
import { seasonBlockRecapSchema, seasonCandidateCheckpointSchema, seasonCheckpointVersionsSchema, seasonEffectsRollupSchema, seasonEffectsStateSchema, seasonGameEffectsTransitionSchema, seasonGamePlayerInputSchema, seasonGameSummarySchema, seasonMechanismEvidenceSchema, seasonPairChemistryStateSchema, seasonPlayerLoadStateSchema, seasonRetainedGameDetailSchema, seasonRunSchema, seasonStaminaInputSchema, seasonWorkerStartRequestSchema, SEASON_NEUTRAL_HOME_COURT, SEASON_FREE_AGENCY_VERSION, SEASON_WORKER_WIRE_SCHEMA_VERSION, type SeasonCandidateCheckpoint, type SeasonEffectsState, type SeasonGameSummary, type SeasonPairChemistryState, type SeasonPlayerLoadState, type SeasonWorkerStartRequest, } from './index.ts';
import { buildEmptyFreeAgency, buildEmptyHealth, buildInitialInfluence, buildRun, buildSchedule, SIMULATION_RATINGS, SIMULATION_TENDENCIES, } from './season-schemas-fixtures.ts';
function playerId(index: number): string {
    return `pv-${String(index).padStart(32, '0')}`;
}
function loadState(index: number): SeasonPlayerLoadState {
    return {
        playerVersionId: playerId(index),
        fatigueBasisPoints: 0,
        recentLoadBasisPoints: 0,
        lastCompletedRound: 0,
    };
}
function buildEffectsState(): SeasonEffectsState {
    const playerStates = Array.from({ length: 300 }, (_, index) => loadState(index));
    const pairStates: SeasonPairChemistryState[] = [];
    for (let roster = 0; roster < 30; roster += 1) {
        for (let a = 0; a < 10; a += 1) {
            for (let b = a + 1; b < 10; b += 1) {
                pairStates.push({
                    a: playerId(roster * 10 + a),
                    b: playerId(roster * 10 + b),
                    sharedPossessions: 0,
                });
            }
        }
    }
    return {
        schemaVersion: 2,
        playerStates,
        inactivePlayerStates: [],
        pairStates,
        archivedPairs: [],
    };
}
const MECHANISM_EVIDENCE = {
    mechanism: 'shooter-fatigue' as const,
    side: 'home' as const,
    opportunities: 480,
    inputTotals: { shooter: 2400000, handler: 0, defenseMean: 0, unitChemistry: 0 },
    deltaTotals: -124000,
    deltaMin: -900,
    deltaMax: 0,
};
function roundTrip<T>(schema: {
    parse: (input: unknown) => T;
}, value: unknown): T {
    return schema.parse(JSON.parse(JSON.stringify(value)));
}
function buildSummary(): SeasonGameSummary {
    const zeroLine = (playerVersionId: string) => ({
        playerVersionId,
        seconds: 0,
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
    });
    const zeroBox = (franchiseId: string) => ({
        franchiseId,
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
    });
    return seasonGameSummarySchema.parse({
        schemaVersion: 1,
        summaryVersion: 'season-game-summary-v3',
        gameId: 's000001',
        round: 1,
        homeFranchiseId: 'lakers',
        awayFranchiseId: 'celtics',
        status: 'final' as const,
        overtimePeriods: 0,
        homeScore: 0,
        awayScore: 0,
        forfeitLoserFranchiseId: null,
        homeBox: zeroBox('lakers'),
        awayBox: zeroBox('celtics'),
        homePlayers: Array.from({ length: 10 }, (_, index) => zeroLine(playerId(index))),
        awayPlayers: Array.from({ length: 10 }, (_, index) => zeroLine(playerId(10 + index))),
        injuryEvents: [],
    });
}
function buildCheckpoint(effects: SeasonEffectsState): SeasonCandidateCheckpoint {
    const run = buildRun();
    return {
        schemaVersion: 1,
        checkpointVersion: 'season-checkpoint-v5',
        runId: run.runId,
        rootSeed: run.rootSeed,
        versions: {
            blockVersion: 'season-block-v5',
            summaryVersion: 'season-game-summary-v3',
            aggregatesVersion: 'season-aggregates-v2',
            recapVersion: 'season-recap-v5',
            leadersVersion: 'season-leaders-v1',
            homeCourtVersion: 'season-home-court-v1',
            gameVersion: 'season-game-v4',
            gameTargetsVersion: 'season-game-targets-v4',
            seedDerivationVersion: 'season-seeds-v1',
            staminaVersion: 'season-stamina-v1',
            chemistryVersion: 'season-chemistry-v2',
            effectsTargetsVersion: 'season-effect-targets-v1',
            healthVersion: 'season-health-v2',
            tradeVersion: 'season-trade-v3',
            influenceVersion: 'season-influence-v2',
            objectiveVersion: 'season-objective-v1',
            campaignVersion: 'season-campaign-v1',
            campaignTargetsVersion: 'campaign-targets-v1',
            injuryTargetsVersion: 'injury-targets-v2',
            tradeTargetsVersion: 'trade-targets-v3',
            influenceTargetsVersion: 'influence-targets-v2',
            freeAgencyVersion: SEASON_FREE_AGENCY_VERSION,
            freeAgencyIndexVersion: 'free-agency-index-v1',
            freeAgencyTargetsVersion: 'free-agency-targets-v1',
        },
        blockIndex: 0,
        completedRounds: 0,
        revision: 0,
        rotationDigest: '0'.repeat(32),
        standings: run.standings,
        teamAggregates: run.league.teams.map((team) => ({
            franchiseId: team.franchiseId,
            gamesPlayed: 0,
            wins: 0,
            losses: 0,
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
        })),
        playerAggregates: run.ownership.map((ownership) => ({
            playerVersionId: ownership.playerVersionId,
            franchiseId: ownership.ownerFranchiseId,
            gamesPlayed: 0,
            appearances: 0,
            started: 0,
            seconds: 0,
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
        })),
        gameSummaries: [buildSummary()],
        retainedDetails: [],
        recap: {
            schemaVersion: 1,
            recapVersion: 'season-recap-v5',
            runId: run.runId,
            blockIndex: 0,
            completedRounds: 0,
            humanRecord: null,
            standingsMovement: [],
            notablePerformances: [],
            streaks: [],
            versionSpotlights: [],
            upcomingHumanGames: [],
            injuryEvidence: {
                injuries: 0,
                bySeverity: { minor: 0, moderate: 0, major: 0, 'season-ending': 0 },
                sameGameReturns: 0,
                seasonEnding: 0,
                returnedThisBlock: 0,
                activeAtBlockEnd: 0,
                humanTeamInjuries: [],
            },
            objectiveEvidence: null,
            campaignEvidence: null,
            tradeEvidence: { tradesAccepted: 0, influenceDelta: 0 },
            freeAgencyEvidence: {
                windowIndex: null,
                signings: [],
                influenceDelta: 0,
                seasonSignings: 0,
                seasonSpend: 0,
            },
            influenceBalance: { humanBalance: 2 },
        },
        effects,
        health: buildEmptyHealth(),
        influence: buildInitialInfluence(),
        freeAgency: buildEmptyFreeAgency(),
        transactions: [],
        objective: {
            objectiveId: null,
            success: null,
            evaluation: {
                objectiveId: 'win-six',
                blockIndex: 0,
                success: false,
                facts: {
                    games: 0,
                    wins: 0,
                    pointsAllowed: 0,
                    reboundMargin: 0,
                    tipsWithAtLeastEightAvailable: 0,
                    tipsTotal: 0,
                    benchMinutes: 0,
                    turnovers: 0,
                },
                tipCountedGames: 0,
            },
        },
        campaign: {
            opportunityId: null,
            outcome: null,
            evaluation: null,
        },
        expectedStateRevision: 0,
        expectedStateDigest: '0'.repeat(32),
        stateRevision: 0,
        stateDigest: '0'.repeat(32),
        digest: '0'.repeat(32),
    };
}
function buildWorkerRequest(priorEffects: SeasonEffectsState | null): SeasonWorkerStartRequest {
    const run = buildRun();
    return seasonWorkerStartRequestSchema.parse({
        schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
        type: 'season-block-start',
        requestId: 'req-1',
        runId: run.runId,
        rootSeed: run.rootSeed,
        blockIndex: 0,
        expectedRevision: 0,
        rotationDigest: '0'.repeat(32),
        commandId: 'cmd-1',
        run,
        schedule: buildSchedule(),
        homeCourt: SEASON_NEUTRAL_HOME_COURT,
        humanFranchiseId: null,
        catalogUrl: 'https://example.test/season/draft-catalog.json',
        catalogHash: '0'.repeat(64),
        profileUrl: 'https://example.test/season/era-sim.json',
        profileHash: '0'.repeat(64),
        priorSummaries: [],
        priorEffects,
        priorHealth: null,
        startGameId: null,
        objectiveId: null,
        priorInfluence: buildInitialInfluence(),
        expectedStateRevision: 0,
        expectedStateDigest: '0'.repeat(32),
    });
}
describe('season stamina input schema (M2.4)', () => {
    const stamina = {
        schemaVersion: 1,
        playerVersionId: playerId(0),
        rating: 78,
        historicalMpg: 26.4,
        derivationVersion: 'season-stamina-v1',
    };
    it('round-trips a valid profile', () => {
        const parsed = roundTrip(seasonStaminaInputSchema, stamina);
        expect(parsed.rating).toBe(78);
        expect(parsed.derivationVersion).toBe('season-stamina-v1');
    });
    it('rejects out-of-range ratings, mpg, and derivation versions', () => {
        expect(() => seasonStaminaInputSchema.parse({ ...stamina, rating: 44 })).toThrow();
        expect(() => seasonStaminaInputSchema.parse({ ...stamina, rating: 96 })).toThrow();
        expect(() => seasonStaminaInputSchema.parse({ ...stamina, historicalMpg: 60.1 })).toThrow();
        expect(() => seasonStaminaInputSchema.parse({ ...stamina, historicalMpg: -0.1 })).toThrow();
        expect(() => seasonStaminaInputSchema.parse({ ...stamina, derivationVersion: 'season-stamina-v3' })).toThrow();
        expect(() => seasonStaminaInputSchema.parse({ ...stamina, playerVersionId: 'not-an-id' })).toThrow();
    });
});
describe('season player load state schema (M2.4)', () => {
    it('round-trips a valid load state', () => {
        const state = roundTrip(seasonPlayerLoadStateSchema, {
            playerVersionId: playerId(1),
            fatigueBasisPoints: 3200,
            recentLoadBasisPoints: 250,
            lastCompletedRound: 41,
        });
        expect(state.fatigueBasisPoints).toBe(3200);
    });
    it('rejects out-of-range basis points and rounds', () => {
        const base = { playerVersionId: playerId(1), lastCompletedRound: 0 };
        expect(() => seasonPlayerLoadStateSchema.parse({ ...base, fatigueBasisPoints: 10001 })).toThrow();
        expect(() => seasonPlayerLoadStateSchema.parse({ ...base, recentLoadBasisPoints: -1 })).toThrow();
        expect(() => seasonPlayerLoadStateSchema.parse({ ...base, fatigueBasisPoints: 0, lastCompletedRound: 83 })).toThrow();
    });
});
describe('season pair chemistry state schema (M2.4)', () => {
    it('accepts canonical pairs only', () => {
        const canonical = { a: playerId(1), b: playerId(2), sharedPossessions: 150 };
        expect(roundTrip(seasonPairChemistryStateSchema, canonical).sharedPossessions).toBe(150);
        expect(() => seasonPairChemistryStateSchema.parse({ ...canonical, a: playerId(2), b: playerId(1) })).toThrow();
        expect(() => seasonPairChemistryStateSchema.parse({ ...canonical, a: playerId(1), b: playerId(1) })).toThrow();
        expect(() => seasonPairChemistryStateSchema.parse({ ...canonical, sharedPossessions: -1 })).toThrow();
        expect(() => seasonPairChemistryStateSchema.parse({ ...canonical, sharedPossessions: 10000001 })).toThrow();
    });
});
describe('season effects state schema (M2.4)', () => {
    it('round-trips the full 300/1350 state', () => {
        const state = roundTrip(seasonEffectsStateSchema, buildEffectsState());
        expect(state.playerStates).toHaveLength(300);
        expect(state.pairStates).toHaveLength(1350);
        expect(state.schemaVersion).toBe(2);
        expect(state.inactivePlayerStates).toHaveLength(0);
        expect(state.archivedPairs).toHaveLength(0);
    });
    it('rejects wrong player and pair counts', () => {
        const state = buildEffectsState();
        expect(() => seasonEffectsStateSchema.parse({
            ...state,
            playerStates: state.playerStates.slice(0, 299),
        })).toThrow();
        expect(() => seasonEffectsStateSchema.parse({
            ...state,
            pairStates: state.pairStates.slice(0, 1349),
        })).toThrow();
    });
    it('rejects duplicate player ids, duplicate pairs, and unknown pair members', () => {
        const state = buildEffectsState();
        expect(() => seasonEffectsStateSchema.parse({
            ...state,
            playerStates: [...state.playerStates, state.playerStates[0]],
        })).toThrow();
        const pairStates = [...state.pairStates, { ...state.pairStates[0] }];
        expect(() => seasonEffectsStateSchema.parse({ ...state, pairStates })).toThrow();
        const rogue = {
            ...state.pairStates[0],
            b: playerId(299),
            sharedPossessions: 0,
        };
        expect(() => seasonEffectsStateSchema.parse({ ...state, pairStates: [...state.pairStates, rogue] })).toThrow();
    });
});
describe('season mechanism evidence schema (M2.4)', () => {
    it('round-trips valid evidence including negative deltas', () => {
        const parsed = roundTrip(seasonMechanismEvidenceSchema, MECHANISM_EVIDENCE);
        expect(parsed.deltaTotals).toBe(-124000);
        expect(parsed.inputTotals.shooter).toBe(2400000);
    });
    it('rejects unknown mechanisms, sides, and out-of-range accumulators', () => {
        expect(() => seasonMechanismEvidenceSchema.parse({ ...MECHANISM_EVIDENCE, mechanism: 'clutch-bonus' })).toThrow();
        expect(() => seasonMechanismEvidenceSchema.parse({ ...MECHANISM_EVIDENCE, side: 'both' })).toThrow();
        expect(() => seasonMechanismEvidenceSchema.parse({ ...MECHANISM_EVIDENCE, opportunities: 1000001 })).toThrow();
        const noInputTotal = { ...MECHANISM_EVIDENCE, inputTotals: { shooter: 1 } };
        expect(() => seasonMechanismEvidenceSchema.parse(noInputTotal)).toThrow();
        expect(() => seasonMechanismEvidenceSchema.parse({ ...MECHANISM_EVIDENCE, deltaMin: -1000001 })).toThrow();
        expect(() => seasonMechanismEvidenceSchema.parse({ ...MECHANISM_EVIDENCE, deltaMax: 1000001 })).toThrow();
    });
});
describe('season game effects transition schema (M2.4)', () => {
    function buildTransition() {
        const state = buildEffectsState();
        return {
            schemaVersion: 1,
            pregamePlayerStates: state.playerStates,
            postgamePlayerStates: state.playerStates,
            pairIncrements: [],
            evidence: [MECHANISM_EVIDENCE],
        };
    }
    it('round-trips a valid transition', () => {
        const transition = roundTrip(seasonGameEffectsTransitionSchema, buildTransition());
        expect(transition.pregamePlayerStates).toHaveLength(300);
        expect(transition.evidence).toHaveLength(1);
    });
    it('rejects non-300 load arrays and oversized increments/evidence', () => {
        const transition = buildTransition();
        expect(() => seasonGameEffectsTransitionSchema.parse({
            ...transition,
            pregamePlayerStates: transition.pregamePlayerStates.slice(0, 299),
        })).toThrow();
        expect(() => seasonGameEffectsTransitionSchema.parse({
            ...transition,
            postgamePlayerStates: transition.postgamePlayerStates.slice(0, 299),
        })).toThrow();
        const increments = Array.from({ length: 1351 }, (_, i) => ({
            a: playerId(i),
            b: playerId(i + 1000),
            sharedPossessions: 1,
        }));
        expect(() => seasonGameEffectsTransitionSchema.parse({ ...transition, pairIncrements: increments })).toThrow();
        const evidence = Array.from({ length: 13 }, () => MECHANISM_EVIDENCE);
        expect(() => seasonGameEffectsTransitionSchema.parse({ ...transition, evidence })).toThrow();
    });
});
describe('season effects rollup schema (M2.4)', () => {
    it('round-trips a compact rollup and rejects oversized opportunities', () => {
        const rollup = {
            mechanism: 'assist-conversion' as const,
            side: 'away' as const,
            opportunities: 240,
            deltaTotal: 12500,
        };
        expect(roundTrip(seasonEffectsRollupSchema, rollup).deltaTotal).toBe(12500);
        expect(() => seasonEffectsRollupSchema.parse({ ...rollup, opportunities: 1000001 })).toThrow();
    });
});
describe('season game summary effects rollup (M2.4)', () => {
    it('parses summaries with and without the optional rollup', () => {
        const summary = buildSummary();
        expect(() => seasonGameSummarySchema.parse(summary)).not.toThrow();
        expect(() => seasonGameSummarySchema.parse({ ...summary, effectsRollup: [] })).not.toThrow();
        const withRollup = seasonGameSummarySchema.parse({
            ...summary,
            effectsRollup: [
                {
                    mechanism: 'shooter-fatigue',
                    side: 'home',
                    opportunities: 100,
                    deltaTotal: -5000,
                },
            ],
        });
        expect(withRollup.effectsRollup).toHaveLength(1);
        expect(() => seasonGameSummarySchema.parse({
            ...summary,
            effectsRollup: Array.from({ length: 13 }, () => ({
                mechanism: 'shooter-fatigue' as const,
                side: 'home' as const,
                opportunities: 1,
                deltaTotal: 0,
            })),
        })).toThrow();
    });
});
describe('season retained game detail mechanism evidence (M2.4)', () => {
    it('parses retained detail with and without the optional evidence', () => {
        const detail = {
            schemaVersion: 1,
            runId: 'fixture-run-1',
            gameId: 's000001',
            round: 1,
            homeFranchiseId: 'lakers',
            awayFranchiseId: 'celtics',
            result: {
                schemaVersion: 1,
                outcome: 'no-legal-five-both' as const,
                seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
                gameNumber: 1,
                dataVersion: 'm10-ratings-v3.6',
                engineVersion: 'season-game-v4',
                profileVersion: 'era-sim-v1',
            },
            injuryEvents: [],
        };
        expect(() => seasonRetainedGameDetailSchema.parse(detail)).not.toThrow();
        const withEvidence = seasonRetainedGameDetailSchema.parse({
            ...detail,
            mechanismEvidence: [MECHANISM_EVIDENCE],
        });
        expect(withEvidence.mechanismEvidence).toHaveLength(1);
        expect(() => seasonRetainedGameDetailSchema.parse({
            ...detail,
            mechanismEvidence: Array.from({ length: 13 }, () => MECHANISM_EVIDENCE),
        })).toThrow();
        const withInjuryEvents = seasonRetainedGameDetailSchema.parse({
            ...detail,
            injuryEvents: [
                {
                    playerVersionId: playerId(0),
                    side: 'home',
                    type: 'soft-tissue',
                    severity: 'minor',
                    removedClock: { period: 2, seconds: 300 },
                    returned: true,
                    returnClock: { period: 3, seconds: 480 },
                },
            ],
        });
        expect(withInjuryEvents.injuryEvents).toHaveLength(1);
    });
});
describe('season checkpoint effects (M2.4)', () => {
    it('round-trips a candidate checkpoint with its effects state', () => {
        const checkpoint = roundTrip(seasonCandidateCheckpointSchema, buildCheckpoint(buildEffectsState()));
        expect(checkpoint.effects.playerStates).toHaveLength(300);
        expect(checkpoint.effects.pairStates).toHaveLength(1350);
    });
    it('rejects a checkpoint without effects', () => {
        const checkpoint = buildCheckpoint(buildEffectsState());
        expect(() => seasonCandidateCheckpointSchema.parse({ ...checkpoint, effects: undefined })).toThrow();
    });
    it('freezes the M2.4/M2.6.5 material versions in the checkpoint versions', () => {
        const checkpoint = buildCheckpoint(buildEffectsState());
        expect(roundTrip(seasonCheckpointVersionsSchema, checkpoint.versions).staminaVersion).toBe('season-stamina-v1');
        expect(() => seasonCheckpointVersionsSchema.parse({
            ...checkpoint.versions,
            chemistryVersion: 'season-chemistry-v1',
        })).toThrow();
        expect(() => seasonCheckpointVersionsSchema.parse({
            ...checkpoint.versions,
            effectsTargetsVersion: 'season-effect-targets-v9',
        })).toThrow();
    });
});
describe('season worker start request priorEffects (M2.4)', () => {
    it('accepts null and omitted priorEffects for block 0', () => {
        expect(() => seasonWorkerStartRequestSchema.parse(buildWorkerRequest(null))).not.toThrow();
        expect(() => seasonWorkerStartRequestSchema.parse({
            ...buildWorkerRequest(null),
            priorEffects: undefined,
        })).not.toThrow();
    });
    it('round-trips a carried effects state and rejects corrupt ones', () => {
        const withState = roundTrip(seasonWorkerStartRequestSchema, buildWorkerRequest(buildEffectsState()));
        expect(withState.priorEffects?.pairStates).toHaveLength(1350);
        const corrupt = { ...buildEffectsState(), schemaVersion: 1 };
        expect(() => seasonWorkerStartRequestSchema.parse(buildWorkerRequest(corrupt as never))).toThrow();
    });
});
describe('season block recap effects evidence (M2.4)', () => {
    function buildRecap() {
        const run = buildRun();
        return {
            schemaVersion: 1,
            recapVersion: 'season-recap-v5',
            runId: run.runId,
            blockIndex: 0,
            completedRounds: 0,
            humanRecord: null,
            standingsMovement: [],
            notablePerformances: [],
            streaks: [],
            versionSpotlights: [],
            upcomingHumanGames: [],
            injuryEvidence: {
                injuries: 0,
                bySeverity: { minor: 0, moderate: 0, major: 0, 'season-ending': 0 },
                sameGameReturns: 0,
                seasonEnding: 0,
                returnedThisBlock: 0,
                activeAtBlockEnd: 0,
                humanTeamInjuries: [],
            },
            objectiveEvidence: null,
            campaignEvidence: null,
            tradeEvidence: { tradesAccepted: 0, influenceDelta: 0 },
            freeAgencyEvidence: {
                windowIndex: null,
                signings: [],
                influenceDelta: 0,
                seasonSignings: 0,
                seasonSpend: 0,
            },
            influenceBalance: { humanBalance: 2 },
        };
    }
    it('parses recaps with and without the optional evidence', () => {
        expect(() => seasonBlockRecapSchema.parse(buildRecap())).not.toThrow();
        const withEvidence = seasonBlockRecapSchema.parse({
            ...buildRecap(),
            effectsEvidence: [
                {
                    mechanism: 'defensive-unit-fatigue',
                    side: 'home',
                    blockOpportunities: 900,
                    blockDeltaTotal: -40000,
                },
            ],
        });
        expect(withEvidence.effectsEvidence).toHaveLength(1);
        expect(() => seasonBlockRecapSchema.parse({
            ...buildRecap(),
            effectsEvidence: Array.from({ length: 13 }, () => ({
                mechanism: 'help-defense' as const,
                side: 'home' as const,
                blockOpportunities: 1,
                blockDeltaTotal: 0,
            })),
        })).toThrow();
    });
});
describe('season game player input stamina (M2.4)', () => {
    function buildPlayerInput() {
        return {
            playerVersionId: playerId(0),
            playerId: 'p-1',
            displayName: 'Test Player',
            positions: ['PG', 'SG'],
            heightInches: 79,
            weightLbs: 215,
            ratings: SIMULATION_RATINGS,
            tendencies: SIMULATION_TENDENCIES,
        };
    }
    it('parses without stamina (zero profile) and with a full profile', () => {
        expect(() => seasonGamePlayerInputSchema.parse(buildPlayerInput())).not.toThrow();
        const withStamina = seasonGamePlayerInputSchema.parse({
            ...buildPlayerInput(),
            stamina: {
                schemaVersion: 1,
                playerVersionId: playerId(0),
                rating: 78,
                historicalMpg: 26.4,
                derivationVersion: 'season-stamina-v1',
            },
        });
        expect(withStamina.stamina?.rating).toBe(78);
    });
    it('rejects a corrupt stamina profile', () => {
        expect(() => seasonGamePlayerInputSchema.parse({
            ...buildPlayerInput(),
            stamina: { schemaVersion: 1, rating: 78, historicalMpg: 26.4 },
        })).toThrow();
    });
});
describe('season run schema version 7 (M2.5)', () => {
    it('rejects schema 4, schema 5, and schema 6 snapshots', () => {
        const run = buildRun();
        expect(() => seasonRunSchema.parse({ ...run, schemaVersion: 4 })).toThrow();
        expect(() => seasonRunSchema.parse({ ...run, schemaVersion: 5 })).toThrow();
        expect(() => seasonRunSchema.parse({ ...run, schemaVersion: 6 })).toThrow();
    });
    it('freezes the roster-generation-v2 material versions on the run', () => {
        const run = buildRun();
        expect(run.versions.rosterGenerationVersion).toBe('roster-generation-v2');
        expect(run.versions.aiVersion).toBe('season-ai-v2');
        expect(run.versions.rosterTargetsVersion).toBe('roster-targets-v2');
        expect(() => seasonRunSchema.parse({
            ...run,
            versions: { ...run.versions, chemistryVersion: 'season-chemistry-v9' },
        })).toThrow();
        expect(() => seasonRunSchema.parse({
            ...run,
            versions: { ...run.versions, effectsTargetsVersion: 'season-effect-targets-v9' },
        })).toThrow();
        expect(() => seasonRunSchema.parse({
            ...run,
            versions: { ...run.versions, aiVersion: 'season-ai-v1' },
        })).toThrow();
    });
    it('freezes the seven M2.5 material versions and the state chain on the run', () => {
        const run = buildRun();
        expect(run.versions.healthVersion).toBe('season-health-v2');
        expect(run.versions.tradeVersion).toBe('season-trade-v4');
        expect(run.versions.influenceVersion).toBe('season-influence-v2');
        expect(run.versions.objectiveVersion).toBe('season-objective-v2');
        expect(run.versions.campaignVersion).toBe('season-campaign-v2');
        expect(run.versions.campaignTargetsVersion).toBe('campaign-targets-v1');
        expect(run.versions.injuryTargetsVersion).toBe('injury-targets-v2');
        expect(run.versions.tradeTargetsVersion).toBe('trade-targets-v3');
        expect(run.versions.influenceTargetsVersion).toBe('influence-targets-v2');
        expect(run.checkpointState).toBeNull();
        expect(run.stateRevision).toBe(0);
        expect(run.stateDigest).toBe('0'.repeat(32));
        expect(() => seasonRunSchema.parse({
            ...run,
            versions: { ...run.versions, healthVersion: 'season-health-v9' },
        })).toThrow();
        expect(() => seasonRunSchema.parse({ ...run, health: undefined })).toThrow();
        expect(() => seasonRunSchema.parse({ ...run, influence: undefined })).toThrow();
        expect(() => seasonRunSchema.parse({ ...run, stateDigest: 'not-a-digest' })).toThrow();
    });
    it('rejects schema 9 snapshots without the free-agency state', () => {
        const run = buildRun();
        expect(() => seasonRunSchema.parse({ ...run, freeAgency: undefined })).toThrow();
        expect(() => seasonRunSchema.parse({ ...run, schemaVersion: 9 })).toThrow();
        expect(() => seasonRunSchema.parse({ ...run, rosters: run.rosters.slice(0, 5) })).toThrow();
    });
});
