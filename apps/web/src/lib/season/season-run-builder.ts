import { SEASON_AGGREGATES_VERSION, SEASON_AI_VERSION, SEASON_ALMANAC_VERSION, SEASON_AWARDS_VERSION, SEASON_BLOCK_VERSION, SEASON_CHECKPOINT_VERSION, SEASON_CHEMISTRY_VERSION, SEASON_COMMAND_LOG_VERSION, SEASON_DRAFT_VERSION, SEASON_EFFECT_TARGETS_VERSION, SEASON_FREE_AGENCY_INDEX_VERSION, SEASON_FREE_AGENCY_TARGETS_VERSION, SEASON_FREE_AGENCY_VERSION, SEASON_GAME_SUMMARY_VERSION, SEASON_GAME_TARGETS_VERSION, SEASON_GAME_VERSION, SEASON_HEALTH_VERSION, SEASON_HOME_COURT_VERSION, SEASON_INFLUENCE_TARGETS_VERSION, SEASON_INFLUENCE_VERSION, SEASON_INJURY_TARGETS_VERSION, SEASON_LEADERS_VERSION, SEASON_LEAGUE_VERSION, SEASON_OBJECTIVE_CATALOG, SEASON_OBJECTIVE_VERSION, SEASON_POSTSEASON_SUMMARY_VERSION, SEASON_POSTSEASON_TARGETS_VERSION, SEASON_POSTSEASON_VERSION, SEASON_RECAP_VERSION, SEASON_REPLAY_EXPORT_VERSION, SEASON_ROSTER_GENERATION_VERSION, SEASON_ROSTER_RULES_VERSION, SEASON_ROSTER_TARGETS_VERSION, SEASON_MINUTE_POLICY_VERSION, SEASON_ROTATION_PLANNER_VERSION, SEASON_ROTATION_VERSION, SEASON_RUN_SCHEMA_VERSION, SEASON_SEED_DERIVATION_VERSION, SEASON_STAMINA_VERSION, SEASON_STANDINGS_VERSION, SEASON_TIEBREAK_VERSION, SEASON_TRADE_GRADE_VERSION, SEASON_TRADE_TARGETS_VERSION, SEASON_TRADE_VERSION, PLAYER_VERSION_ID_VERSION, buildInitialPostseasonState, seasonRunSchema, sha256Hex as sha256Bytes, type SeasonDraftState, type SeasonLeague, type SeasonLeagueGenerationResult, type SeasonRun, type SeasonSchedule, type Seed, } from '@hoop-rush/data-contracts';
import { createInitialSeasonInfluenceState } from '@hoop-rush/engine';
export async function sha256Hex(material: string): Promise<string | null> {
    return sha256Bytes(new TextEncoder().encode(material));
}
function emptyPostseason(rootSeed: Seed): SeasonRun['postseason'] {
    return buildInitialPostseasonState(rootSeed);
}
export interface BuildSeasonRunInput {
    runId: string;
    rootSeed: Seed;
    league: SeasonLeague;
    schedule: SeasonSchedule;
    scheduleContentHash: string;
    draft: SeasonDraftState;
    generation: SeasonLeagueGenerationResult;
    stateDigest?: string;
}
export function buildSeasonRunFromGeneration(input: BuildSeasonRunInput): SeasonRun {
    const { runId, rootSeed, league, schedule, scheduleContentHash, draft, generation, stateDigest = '0'.repeat(32), } = input;
    const humanFranchiseIds = draft.participants.map((participant) => participant.franchiseId);
    const correctedLeague: SeasonLeague = {
        ...league,
        teams: league.teams.map((team) => ({
            ...team,
            control: humanFranchiseIds.includes(team.franchiseId) ? 'human' : 'ai',
        })),
    };
    const run: SeasonRun = {
        schemaVersion: SEASON_RUN_SCHEMA_VERSION,
        runId,
        rootSeed,
        versions: {
            runSchemaVersion: SEASON_RUN_SCHEMA_VERSION,
            leagueVersion: SEASON_LEAGUE_VERSION,
            scheduleVersion: schedule.scheduleVersion,
            scheduleFormulaVersion: schedule.formulaVersion,
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
        league: correctedLeague,
        rosters: generation.rosters,
        ownership: generation.ownership,
        schedule: {
            leagueVersion: schedule.leagueVersion,
            scheduleVersion: schedule.scheduleVersion,
            formulaVersion: schedule.formulaVersion,
            generationSeed: schedule.generationSeed,
            contentHash: scheduleContentHash,
        },
        games: schedule.games.map((game) => ({
            gameId: game.gameId,
            round: game.round,
            homeFranchiseId: game.homeFranchiseId,
            awayFranchiseId: game.awayFranchiseId,
            status: 'scheduled' as const,
            homeScore: null,
            awayScore: null,
            forfeitLoserFranchiseId: null,
        })),
        standings: {
            schemaVersion: 1,
            standingsVersion: SEASON_STANDINGS_VERSION,
            rows: correctedLeague.teams.map((team) => ({
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
                headToHead: correctedLeague.teams
                    .filter((other) => other.franchiseId !== team.franchiseId)
                    .map((other) => ({ franchiseId: other.franchiseId, wins: 0, losses: 0 })),
            })),
        },
        cursor: { schemaVersion: 1, completedRounds: 0 },
        stage: 'regular-season',
        postseason: emptyPostseason(rootSeed),
        awards: null,
        completion: null,
        draft: {
            draftVersion: SEASON_DRAFT_VERSION,
            participants: draft.participants.map((participant) => ({
                participantId: participant.participantId,
                franchiseId: participant.franchiseId,
                offers: draft.offers
                    .filter((offer) => offer.participantId === participant.participantId)
                    .map((offer) => ({
                    round: offer.round,
                    pickOrdinal: offer.pickOrdinal,
                    seedPath: offer.seedPath,
                    cards: offer.cards.map((card) => ({
                        playerVersionId: card.playerVersionId,
                        selectable: card.selectable,
                        coverageReason: card.coverageReason,
                    })),
                })),
                picks: draft.picks
                    .filter((pick) => pick.participantId === participant.participantId)
                    .map((pick) => ({
                    round: pick.round,
                    playerVersionId: pick.playerVersionId,
                    franchiseId: pick.franchiseId,
                    eraId: pick.eraId,
                    seedPath: pick.seedPath,
                })),
            })),
        },
        aiAssignments: generation.aiAssignments,
        aiPools: generation.aiPools,
        rotations: generation.rotations,
        generationAudit: {
            seed: generation.seed,
            aiVersion: SEASON_AI_VERSION,
            rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
            rotationVersion: SEASON_ROTATION_VERSION,
            minutePolicyVersion: SEASON_MINUTE_POLICY_VERSION,
            rosterTargetsVersion: SEASON_ROSTER_TARGETS_VERSION,
            digest: generation.digest,
            diagnostics: generation.diagnostics,
        },
        evaluations: generation.evaluations,
        trade: null,
        freeAgency: {
            schemaVersion: 1,
            freeAgencyVersion: SEASON_FREE_AGENCY_VERSION,
            windows: [],
            canonicalCandidates: {},
            signingCounts: Object.fromEntries(correctedLeague.teams.map((team) => [team.franchiseId, 0])),
            seasonSpend: Object.fromEntries(correctedLeague.teams.map((team) => [team.franchiseId, 0])),
        },
        objectives: {
            schemaVersion: 1,
            objectiveVersion: SEASON_OBJECTIVE_VERSION,
            catalog: [...SEASON_OBJECTIVE_CATALOG],
            selections: {},
        },
        health: {
            schemaVersion: 1,
            healthVersion: SEASON_HEALTH_VERSION,
            injuries: [],
        },
        transactions: [],
        influence: createInitialSeasonInfluenceState(league.teams.map((team) => team.franchiseId)),
        checkpointState: null,
        stateRevision: 0,
        stateDigest,
    };
    return seasonRunSchema.parse(run);
}
