import { SEASON_ALIGNMENT, SEASON_AI_VERSION, SEASON_AUTHORITY_VERSION, SEASON_AGGREGATES_VERSION, SEASON_BLOCK_VERSION, SEASON_CHECKPOINT_VERSION, SEASON_CHEMISTRY_VERSION, SEASON_DRAFT_VERSION, SEASON_EFFECT_TARGETS_VERSION, SEASON_FREE_AGENCY_VERSION, SEASON_FREE_AGENCY_INDEX_VERSION, SEASON_FREE_AGENCY_TARGETS_VERSION, SEASON_GAME_SUMMARY_VERSION, SEASON_GAME_TARGETS_VERSION, SEASON_GAME_VERSION, SEASON_HEALTH_VERSION, SEASON_HOME_COURT_VERSION, SEASON_INFLUENCE_TARGETS_VERSION, SEASON_INFLUENCE_VERSION, SEASON_INJURY_TARGETS_VERSION, SEASON_LEADERS_VERSION, SEASON_LEAGUE_VERSION, SEASON_MINUTE_POLICY_VERSION, SEASON_OBJECTIVE_CATALOG, SEASON_OBJECTIVE_VERSION, SEASON_POSTSEASON_VERSION, SEASON_POSTSEASON_SUMMARY_VERSION, SEASON_POSTSEASON_TARGETS_VERSION, SEASON_RECAP_VERSION, SEASON_ROSTER_GENERATION_VERSION, SEASON_ROSTER_RULES_VERSION, SEASON_ROSTER_TARGETS_VERSION, SEASON_ROSTER_SIZE, SEASON_ROTATION_PLANNER_VERSION, SEASON_ROTATION_VERSION, SEASON_RUN_SCHEMA_VERSION, SEASON_SEED_DERIVATION_VERSION, SEASON_SEED_NAMESPACES, SEASON_STAMINA_VERSION, SEASON_STANDINGS_VERSION, SEASON_TIEBREAK_VERSION, SEASON_TRADE_TARGETS_VERSION, SEASON_TRADE_VERSION, SEASON_ALMANAC_VERSION, SEASON_AWARDS_VERSION, SEASON_COMMAND_LOG_VERSION, SEASON_REPLAY_EXPORT_VERSION, SEASON_TRADE_GRADE_VERSION, PLAYER_VERSION_ID_VERSION, buildInitialPostseasonState, playerVersionId, seasonNamespaceSeed, type SeasonGame, type SeasonHealthState, type SeasonInfluenceState, type SeasonLeague, type SeasonRoster, type SeasonRun, type SeasonSchedule, type SeasonStandings, } from '@hoop-rush/data-contracts';
import { buildFixtureEvaluations, buildFixtureGenerationAudit, buildFixtureSeasonDraftFacts, buildSeasonAiAssignments, buildSeasonAiPools, buildSeasonRotation, } from './season-draft.ts';
const ALIGNMENT: Record<string, {
    conference: 'east' | 'west';
    division: 'atlantic' | 'central' | 'southeast' | 'northwest' | 'pacific' | 'southwest';
}> = Object.fromEntries(SEASON_ALIGNMENT.map((entry) => [
    entry.franchiseId,
    { conference: entry.conference, division: entry.division },
]));
const FRANCHISE_ORDER = SEASON_ALIGNMENT.map((entry) => entry.franchiseId);
function emptyHealth(): SeasonHealthState {
    return {
        schemaVersion: 1,
        healthVersion: SEASON_HEALTH_VERSION,
        injuries: [],
    };
}
function emptyFreeAgency(): SeasonRun['freeAgency'] {
    return {
        schemaVersion: 1,
        freeAgencyVersion: SEASON_FREE_AGENCY_VERSION,
        windows: [],
        canonicalCandidates: {},
        signingCounts: Object.fromEntries(FRANCHISE_ORDER.map((franchiseId) => [franchiseId, 0])),
        seasonSpend: Object.fromEntries(FRANCHISE_ORDER.map((franchiseId) => [franchiseId, 0])),
    };
}
function initialInfluence(league: SeasonLeague): SeasonInfluenceState {
    const balances: Record<string, number> = {};
    const ledger: SeasonInfluenceState['ledger'] = [];
    const windows: SeasonInfluenceState['windows'] = {};
    for (const team of league.teams) {
        balances[team.franchiseId] = 2;
        ledger.push({
            entryId: `influence-initial-${team.franchiseId}`,
            franchiseId: team.franchiseId,
            source: 'initial-grant',
            blockIndex: null,
            commandId: null,
            requestedDelta: 2,
            appliedDelta: 2,
            balanceAfter: 2,
            explanation: 'Initial +2 Influence grant at run creation',
        });
        windows[team.franchiseId] = [];
    }
    return {
        schemaVersion: 1,
        influenceVersion: SEASON_INFLUENCE_VERSION,
        balances,
        ledger,
        windows,
        rehabs: {},
    };
}
export function buildSeasonLeague(overrides: Partial<SeasonLeague> = {}, options: {
    humanFranchiseId?: string;
} = {}): SeasonLeague {
    const human = options.humanFranchiseId ?? 'lakers';
    return {
        schemaVersion: 1,
        leagueVersion: SEASON_LEAGUE_VERSION,
        teams: FRANCHISE_ORDER.map((franchiseId) => {
            const alignment = ALIGNMENT[franchiseId];
            if (!alignment)
                throw new Error(`no alignment for ${franchiseId}`);
            return {
                franchiseId,
                control: franchiseId === human ? 'human' : 'ai',
                conference: alignment.conference,
                division: alignment.division,
            };
        }),
        ...overrides,
    };
}
export function buildSeasonRosters(league: SeasonLeague, seed: string): SeasonRoster[] {
    const seeded = seasonNamespaceSeed(seed, SEASON_SEED_NAMESPACES.aiRosters);
    return league.teams.map((team, teamIndex) => ({
        franchiseId: team.franchiseId,
        players: Array.from({ length: SEASON_ROSTER_SIZE }, (_, slot) => {
            const playerId = `p-synth-${seeded.slice(0, 6)}-${String(teamIndex + 1)}-${String(slot + 1)}`;
            return {
                playerVersionId: playerVersionId(playerId, team.franchiseId, '1990s', '1995-96'),
                playerId,
                franchiseId: team.franchiseId,
                eraId: '1990s',
                seasonKey: '1995-96',
                displayName: `Fixture ${team.franchiseId} ${String(slot + 1)}`,
            };
        }),
    }));
}
function zeroStandings(league: SeasonLeague): SeasonStandings {
    return {
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
}
function scheduledGames(schedule: SeasonSchedule): SeasonGame[] {
    return schedule.games.map((game) => ({
        gameId: game.gameId,
        round: game.round,
        homeFranchiseId: game.homeFranchiseId,
        awayFranchiseId: game.awayFranchiseId,
        status: 'scheduled' as const,
        homeScore: null,
        awayScore: null,
        forfeitLoserFranchiseId: null,
    }));
}
function emptyPostseason(rootSeed: string): SeasonRun['postseason'] {
    return buildInitialPostseasonState(rootSeed);
}
export function buildSeasonRunFixture(input: {
    schedule: SeasonSchedule;
    league?: SeasonLeague;
    seed?: string;
    humanFranchiseId?: string;
    scheduleContentHash?: string;
    stateDigest?: string;
}): SeasonRun {
    const seed = input.seed ?? 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';
    const league = input.league ?? buildSeasonLeague({}, { humanFranchiseId: input.humanFranchiseId });
    const rosters = buildSeasonRosters(league, seed);
    const aiAssignments = buildSeasonAiAssignments(league);
    const rotations = rosters.map((roster) => buildSeasonRotation(roster.franchiseId, roster.players.map((player) => player.playerVersionId)));
    return {
        schemaVersion: SEASON_RUN_SCHEMA_VERSION,
        runId: 'fixture-season-run-1',
        rootSeed: seed,
        versions: {
            runSchemaVersion: SEASON_RUN_SCHEMA_VERSION,
            leagueVersion: league.leagueVersion,
            scheduleVersion: input.schedule.scheduleVersion,
            scheduleFormulaVersion: input.schedule.formulaVersion,
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
        },
        league,
        authority: {
            kind: 'local-solo',
            soloFranchiseId: league.teams.find(t => t.control === 'human')?.franchiseId ?? null,
            authorityVersion: SEASON_AUTHORITY_VERSION,
        },
        rosters,
        ownership: rosters.flatMap((roster) => roster.players.map((player) => ({
            playerVersionId: player.playerVersionId,
            ownerFranchiseId: roster.franchiseId,
        }))),
        schedule: {
            leagueVersion: input.schedule.leagueVersion,
            scheduleVersion: input.schedule.scheduleVersion,
            formulaVersion: input.schedule.formulaVersion,
            generationSeed: input.schedule.generationSeed,
            contentHash: input.scheduleContentHash ?? '0'.repeat(64),
        },
        games: scheduledGames(input.schedule),
        standings: zeroStandings(league),
        cursor: { schemaVersion: 1, completedRounds: 0 },
        stage: 'regular-season',
        postseason: emptyPostseason(seed),
        awards: null,
        completion: null,
        draft: buildFixtureSeasonDraftFacts(),
        aiAssignments,
        aiPools: buildSeasonAiPools(aiAssignments, 'lakers'),
        rotations,
        generationAudit: buildFixtureGenerationAudit(seed),
        evaluations: buildFixtureEvaluations(rosters, aiAssignments),
        trade: null,
        freeAgency: emptyFreeAgency(),
        objectives: {
            schemaVersion: 1,
            objectiveVersion: SEASON_OBJECTIVE_VERSION,
            catalog: [...SEASON_OBJECTIVE_CATALOG],
            selections: {},
        },
        health: emptyHealth(),
        transactions: [],
        influence: initialInfluence(league),
        checkpointState: null,
        stateRevision: 0,
        stateDigest: input.stateDigest ?? '0'.repeat(32),
    };
}
