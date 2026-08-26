import { SEASON_AGGREGATES_VERSION, SEASON_AI_VERSION, SEASON_BLOCK_VERSION, SEASON_CHECKPOINT_VERSION, SEASON_CHEMISTRY_VERSION, SEASON_DRAFT_VERSION, SEASON_EFFECT_TARGETS_VERSION, SEASON_FREE_AGENCY_INDEX_VERSION, SEASON_FREE_AGENCY_TARGETS_VERSION, SEASON_FREE_AGENCY_VERSION, SEASON_GAME_SUMMARY_VERSION, SEASON_GAME_TARGETS_VERSION, SEASON_GAME_VERSION, SEASON_HEALTH_VERSION, SEASON_HOME_COURT_VERSION, SEASON_INFLUENCE_TARGETS_VERSION, SEASON_INFLUENCE_VERSION, SEASON_INJURY_TARGETS_VERSION, SEASON_LEADERS_VERSION, SEASON_LEAGUE_VERSION, SEASON_MINUTE_POLICY_VERSION, SEASON_OBJECTIVE_CATALOG, SEASON_OBJECTIVE_VERSION, SEASON_POSTSEASON_VERSION, SEASON_RECAP_VERSION, SEASON_ROSTER_GENERATION_VERSION, SEASON_ROSTER_RULES_VERSION, SEASON_ROSTER_TARGETS_VERSION, SEASON_ROTATION_PLANNER_VERSION, SEASON_ROTATION_VERSION, SEASON_RUN_SCHEMA_VERSION, SEASON_SCHEDULE_FORMULA_VERSION, SEASON_SCHEDULE_VERSION, SEASON_SEED_DERIVATION_VERSION, SEASON_STAMINA_VERSION, SEASON_STANDINGS_VERSION, SEASON_TIEBREAK_VERSION, SEASON_TRADE_TARGETS_VERSION, SEASON_TRADE_VERSION, SEASON_ALMANAC_VERSION, SEASON_AWARDS_VERSION, SEASON_COMMAND_LOG_VERSION, SEASON_POSTSEASON_SUMMARY_VERSION, SEASON_POSTSEASON_TARGETS_VERSION, SEASON_REPLAY_EXPORT_VERSION, SEASON_TRADE_GRADE_VERSION, PLAYER_VERSION_ID_VERSION, buildInitialPostseasonState, seasonNamespaceSeed, seasonRunSchema, type SeasonDraftCatalog, type SeasonEffectsState, type SeasonGameSummary, type SeasonRoster, type SeasonRosterEntry, type SeasonRun, } from '@hoop-rush/data-contracts';
import { buildFixtureEvaluations, buildFixtureGenerationAudit, buildFixtureSeasonDraftFacts, buildSeasonAiAssignments, buildSeasonAiPools, buildSeasonDraftCatalog, buildSeasonLeague, } from '@hoop-rush/test-fixtures';
import { buildMinimalRotation } from './rotation.ts';
import { validateSeasonRoster, type SeasonRosterMemberInput } from './roster-rules.ts';
import { createInitialSeasonInfluenceState } from './influence.ts';
export const ECONOMY_TEST_SEED = 'b1d2e3f405162738495a6b7c8d9e0f11';
export const SEASON_VERSIONS_M25: SeasonRun['versions'] = {
    runSchemaVersion: SEASON_RUN_SCHEMA_VERSION,
    leagueVersion: SEASON_LEAGUE_VERSION,
    scheduleVersion: SEASON_SCHEDULE_VERSION,
    scheduleFormulaVersion: SEASON_SCHEDULE_FORMULA_VERSION,
    standingsVersion: SEASON_STANDINGS_VERSION,
    postseasonVersion: SEASON_POSTSEASON_VERSION,
    seedDerivationVersion: SEASON_SEED_DERIVATION_VERSION,
    playerVersionIdVersion: PLAYER_VERSION_ID_VERSION,
    draftVersion: SEASON_DRAFT_VERSION,
    rosterRulesVersion: SEASON_ROSTER_RULES_VERSION,
    rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
    aiVersion: SEASON_AI_VERSION,
    rotationVersion: SEASON_ROTATION_VERSION,
    minutePolicyVersion: SEASON_MINUTE_POLICY_VERSION,
    rotationPlannerVersion: SEASON_ROTATION_PLANNER_VERSION,
    gameVersion: SEASON_GAME_VERSION,
    gameTargetsVersion: SEASON_GAME_TARGETS_VERSION,
    rosterTargetsVersion: SEASON_ROSTER_TARGETS_VERSION,
    blockVersion: SEASON_BLOCK_VERSION,
    summaryVersion: SEASON_GAME_SUMMARY_VERSION,
    aggregatesVersion: SEASON_AGGREGATES_VERSION,
    recapVersion: SEASON_RECAP_VERSION,
    leadersVersion: SEASON_LEADERS_VERSION,
    homeCourtVersion: SEASON_HOME_COURT_VERSION,
    checkpointVersion: SEASON_CHECKPOINT_VERSION,
    staminaVersion: SEASON_STAMINA_VERSION,
    chemistryVersion: SEASON_CHEMISTRY_VERSION,
    effectsTargetsVersion: SEASON_EFFECT_TARGETS_VERSION,
    healthVersion: SEASON_HEALTH_VERSION,
    tradeVersion: SEASON_TRADE_VERSION,
    influenceVersion: SEASON_INFLUENCE_VERSION,
    objectiveVersion: SEASON_OBJECTIVE_VERSION,
    injuryTargetsVersion: SEASON_INJURY_TARGETS_VERSION,
    tradeTargetsVersion: SEASON_TRADE_TARGETS_VERSION,
    influenceTargetsVersion: SEASON_INFLUENCE_TARGETS_VERSION,
    tiebreakVersion: SEASON_TIEBREAK_VERSION,
    postseasonSummaryVersion: SEASON_POSTSEASON_SUMMARY_VERSION,
    awardsVersion: SEASON_AWARDS_VERSION,
    tradeGradeVersion: SEASON_TRADE_GRADE_VERSION,
    commandLogVersion: SEASON_COMMAND_LOG_VERSION,
    almanacVersion: SEASON_ALMANAC_VERSION,
    replayExportVersion: SEASON_REPLAY_EXPORT_VERSION,
    postseasonTargetsVersion: SEASON_POSTSEASON_TARGETS_VERSION,
    freeAgencyVersion: SEASON_FREE_AGENCY_VERSION,
    freeAgencyIndexVersion: SEASON_FREE_AGENCY_INDEX_VERSION,
    freeAgencyTargetsVersion: SEASON_FREE_AGENCY_TARGETS_VERSION,
};
const LEGAL_ROSTER_PATTERNS: readonly (readonly number[])[] = [
    [0, 1, 2, 3, 4, 5, 6, 7, 17, 18],
    [1, 2, 6, 7, 8, 9, 16, 17, 18, 19],
    [0, 2, 3, 4, 6, 7, 8, 9, 17, 18],
    [0, 1, 2, 3, 6, 7, 8, 9, 17, 18],
    [1, 2, 3, 5, 6, 7, 8, 9, 17, 18],
];
function patternIndexOf(franchiseId: string): number {
    const hash = seasonNamespaceSeed('0'.repeat(32), 'economy-test-patterns', franchiseId);
    return Number.parseInt(hash.slice(0, 8), 16) % LEGAL_ROSTER_PATTERNS.length;
}
function rosterOf(catalog: SeasonDraftCatalog, franchiseId: string): SeasonRosterEntry[] {
    const pool = catalog.pools.find((entry) => entry.franchiseId === franchiseId);
    if (pool === undefined)
        throw new Error(`no catalog pool for ${franchiseId}`);
    const pattern = LEGAL_ROSTER_PATTERNS[patternIndexOf(franchiseId)];
    if (pattern === undefined)
        throw new Error(`no pattern for ${franchiseId}`);
    const versions = pattern.map((index) => {
        const version = pool.playerVersionIds[index];
        if (version === undefined)
            throw new Error(`pool ${franchiseId} has no version at index ${String(index)}`);
        return version;
    });
    return versions.map((playerVersionId) => {
        const candidate = catalog.candidates.find((entry) => entry.playerVersionId === playerVersionId);
        if (candidate === undefined)
            throw new Error(`catalog lacks ${playerVersionId}`);
        return {
            playerVersionId: candidate.playerVersionId,
            playerId: candidate.playerId,
            franchiseId,
            eraId: candidate.eraId,
            seasonKey: candidate.seasonKey,
            displayName: candidate.displayName,
        };
    });
}
export function zeroEffectsOf(run: SeasonRun): SeasonEffectsState {
    const playerStates = run.rosters
        .flatMap((roster) => roster.players.map((player) => ({
        playerVersionId: player.playerVersionId,
        fatigueBasisPoints: 0,
        recentLoadBasisPoints: 0,
        lastCompletedRound: 0,
    })))
        .sort((a, b) => (a.playerVersionId < b.playerVersionId ? -1 : 1));
    const pairStates: SeasonEffectsState['pairStates'] = [];
    for (const roster of run.rosters) {
        const ids = roster.players.map((player) => player.playerVersionId).sort();
        for (let i = 0; i < ids.length; i += 1) {
            const a = ids[i];
            if (a === undefined)
                continue;
            for (let j = i + 1; j < ids.length; j += 1) {
                const b = ids[j];
                if (b === undefined)
                    continue;
                pairStates.push({ a, b, sharedPossessions: 0 });
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
export function economyTestCatalog(): SeasonDraftCatalog {
    const league = buildSeasonLeague();
    return buildSeasonDraftCatalog({
        franchiseIds: league.teams.map((team) => team.franchiseId),
        eras: ['1990s'],
        playersPerPool: 40,
    });
}
export function buildEconomyTestRun(input: {
    seed?: string;
    catalog?: SeasonDraftCatalog;
    humanFranchiseId?: string;
    runId?: string;
} = {}): {
    run: SeasonRun;
    catalog: SeasonDraftCatalog;
} {
    const seed = input.seed ?? ECONOMY_TEST_SEED;
    const catalog = input.catalog ?? economyTestCatalog();
    const humanFranchiseId = input.humanFranchiseId ?? 'lakers';
    const runId = input.runId ?? 'economy-test-run-1';
    const league = buildSeasonLeague({}, { humanFranchiseId });
    const rosterRows: SeasonRoster[] = league.teams.map((team) => ({
        franchiseId: team.franchiseId,
        players: rosterOf(catalog, team.franchiseId),
    }));
    for (const roster of rosterRows) {
        const members: SeasonRosterMemberInput[] = roster.players.map((player) => ({
            playerVersionId: player.playerVersionId,
            playable: catalog.candidates.find((entry) => entry.playerVersionId === player.playerVersionId)
                ?.positions.playable ?? [],
        }));
        const failures = validateSeasonRoster(members);
        if (failures.length > 0) {
            throw new Error(`fixture roster ${roster.franchiseId} is illegal: ${failures.join('; ')}`);
        }
    }
    const aiAssignments = buildSeasonAiAssignments(league);
    const rotations = rosterRows.map((roster) => buildMinimalRotation({
        franchiseId: roster.franchiseId,
        members: roster.players.map((player) => ({
            playerVersionId: player.playerVersionId,
            playable: catalog.candidates.find((entry) => entry.playerVersionId === player.playerVersionId)
                ?.positions.playable ?? [],
        })),
    }));
    const ownership = rosterRows.flatMap((roster) => roster.players.map((player) => ({
        playerVersionId: player.playerVersionId,
        ownerFranchiseId: roster.franchiseId,
    })));
    const games = Array.from({ length: 1230 }, (_, index) => {
        const gameNumber = index + 1;
        const home = league.teams[gameNumber % league.teams.length];
        const away = league.teams[(gameNumber * 7 + 11) % league.teams.length];
        return {
            gameId: `s${String(gameNumber).padStart(6, '0')}`,
            round: Math.floor(index / 15) + 1,
            homeFranchiseId: home?.franchiseId ?? 'lakers',
            awayFranchiseId: away?.franchiseId ?? 'celtics',
            status: 'scheduled' as const,
            homeScore: null,
            awayScore: null,
            forfeitLoserFranchiseId: null,
        };
    });
    const standings: SeasonRun['standings'] = {
        schemaVersion: 1,
        standingsVersion: SEASON_STANDINGS_VERSION,
        rows: league.teams.map((team) => ({
            franchiseId: team.franchiseId,
            wins: 0,
            losses: 0,
            gamesPlayed: 0,
            homeWins: 0,
            homeLosses: 0,
            awayWins: 0,
            awayLosses: 0,
            conferenceWins: 0,
            conferenceLosses: 0,
            divisionWins: 0,
            divisionLosses: 0,
            pointsFor: 0,
            pointsAgainst: 0,
            headToHead: league.teams
                .filter((other) => other.franchiseId !== team.franchiseId)
                .map((other) => ({ franchiseId: other.franchiseId, wins: 0, losses: 0 })),
        })),
    };
    const postseason = buildInitialPostseasonState(seed);
    const franchiseIds = league.teams.map((team) => team.franchiseId);
    const run: SeasonRun = {
        schemaVersion: SEASON_RUN_SCHEMA_VERSION,
        runId,
        rootSeed: seed,
        versions: SEASON_VERSIONS_M25,
        league,
        rosters: rosterRows,
        ownership,
        schedule: {
            leagueVersion: SEASON_LEAGUE_VERSION,
            scheduleVersion: SEASON_SCHEDULE_VERSION,
            formulaVersion: SEASON_SCHEDULE_FORMULA_VERSION,
            generationSeed: seed,
            contentHash: '0'.repeat(64),
        },
        games,
        standings,
        cursor: { schemaVersion: 1, completedRounds: 0 },
        stage: 'regular-season',
        postseason,
        awards: null,
        completion: null,
        draft: buildFixtureSeasonDraftFacts(),
        aiAssignments,
        aiPools: buildSeasonAiPools(aiAssignments, humanFranchiseId),
        rotations,
        generationAudit: buildFixtureGenerationAudit(seed),
        evaluations: buildFixtureEvaluations(rosterRows, aiAssignments),
        trade: null,
        freeAgency: {
            schemaVersion: 1,
            freeAgencyVersion: SEASON_FREE_AGENCY_VERSION,
            windows: [],
            canonicalCandidates: {},
            signingCounts: Object.fromEntries(franchiseIds.map((franchiseId) => [franchiseId, 0])),
            seasonSpend: Object.fromEntries(franchiseIds.map((franchiseId) => [franchiseId, 0])),
        },
        objectives: {
            schemaVersion: 1,
            objectiveVersion: SEASON_OBJECTIVE_VERSION,
            catalog: [...SEASON_OBJECTIVE_CATALOG],
            selections: {},
        },
        health: { schemaVersion: 1, healthVersion: SEASON_HEALTH_VERSION, injuries: [] },
        transactions: [],
        influence: createInitialSeasonInfluenceState(franchiseIds),
        checkpointState: null,
        stateRevision: 0,
        stateDigest: '0'.repeat(32),
    };
    const parsed = seasonRunSchema.safeParse(run);
    if (!parsed.success) {
        throw new Error(`economy test run fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
    }
    return { run, catalog };
}
export function withInjury(run: SeasonRun, injury: SeasonRun['health']['injuries'][number]): SeasonRun {
    return {
        ...run,
        health: {
            ...run.health,
            injuries: [...run.health.injuries, injury],
        },
    };
}
export function injuryIdOf(seed: string): `inj-${string}` {
    return `inj-${seasonNamespaceSeed(seed, 'injuries', 'test')}`;
}
export function aiTradeCountOf(run: SeasonRun, humanFranchiseId: string): number {
    let count = 0;
    for (const window of run.trade?.windows ?? []) {
        for (const offer of window.offers) {
            if (offer.toFranchiseId !== humanFranchiseId &&
                offer.fromFranchiseId !== humanFranchiseId &&
                offer.status === 'accepted') {
                count += 1;
            }
        }
    }
    return count;
}
export function fixtureSummary(gameId: string, homeFranchiseId: string, awayFranchiseId: string, homeScore: number, awayScore: number, opts: {
    homeLines?: SeasonGameSummary['homePlayers'];
    awayLines?: SeasonGameSummary['awayPlayers'];
    homeBox?: SeasonGameSummary['homeBox'];
    awayBox?: SeasonGameSummary['awayBox'];
} = {}): SeasonGameSummary {
    const zeroLine = (playerVersionId: string): SeasonGameSummary['homePlayers'][number] => ({
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
    const box = (franchiseId: string, points: number, overrides: Partial<SeasonGameSummary['homeBox']> = {}): SeasonGameSummary['homeBox'] => ({
        franchiseId,
        points,
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
        ...overrides,
    });
    return {
        schemaVersion: 1,
        summaryVersion: SEASON_GAME_SUMMARY_VERSION,
        gameId,
        round: 1,
        homeFranchiseId,
        awayFranchiseId,
        status: 'final',
        overtimePeriods: 0,
        homeScore,
        awayScore,
        forfeitLoserFranchiseId: null,
        homeBox: opts.homeBox ?? box(homeFranchiseId, homeScore),
        awayBox: opts.awayBox ?? box(awayFranchiseId, awayScore),
        homePlayers: opts.homeLines ??
            Array.from({ length: 10 }, (_, index) => zeroLine(`pv-${String(index).padStart(32, '0')}`)),
        awayPlayers: opts.awayLines ??
            Array.from({ length: 10 }, (_, index) => zeroLine(`pv-${String(index + 100).padStart(32, '0')}`)),
        injuryEvents: [],
    };
}
export function allFixtureFranchiseIds(league: SeasonRun['league']): string[] {
    return league.teams.map((team) => team.franchiseId);
}
