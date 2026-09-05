import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SEASON_AGGREGATES_VERSION,
  SEASON_AI_VERSION,
  SEASON_ALMANAC_VERSION,
  SEASON_AWARDS_VERSION,
  SEASON_BLOCK_VERSION,
  SEASON_CAMPAIGN_TARGETS_VERSION,
  SEASON_CAMPAIGN_VERSION,
  SEASON_CHALLENGE_TARGETS_VERSION,
  SEASON_CHALLENGE_VERSION,
  SEASON_CHECKPOINT_VERSION,
  SEASON_CHEMISTRY_VERSION,
  SEASON_COMMAND_LOG_VERSION,
  SEASON_COMMITTED_DRAFT_SEED,
  SEASON_COMMITTED_SCHEDULE_SEED,
  contentHashSchema,
  idSchema,
  seedSchema,
  SEASON_DRAFT_VERSION,
  SEASON_EFFECT_TARGETS_VERSION,
  SEASON_FREE_AGENCY_INDEX_VERSION,
  SEASON_FREE_AGENCY_TARGETS_VERSION,
  SEASON_FREE_AGENCY_VERSION,
  SEASON_GAME_SUMMARY_VERSION,
  SEASON_GAME_TARGETS_VERSION,
  SEASON_GAME_VERSION,
  SEASON_HEALTH_VERSION,
  SEASON_HOME_COURT_VERSION,
  SEASON_INFLUENCE_TARGETS_VERSION,
  SEASON_INFLUENCE_VERSION,
  SEASON_INJURY_TARGETS_VERSION,
  SEASON_LEADERS_VERSION,
  SEASON_OBJECTIVE_CATALOG,
  SEASON_OBJECTIVE_VERSION,
  SEASON_POSTSEASON_SUMMARY_VERSION,
  SEASON_POSTSEASON_TARGETS_VERSION,
  SEASON_POSTSEASON_VERSION,
  SEASON_RECAP_VERSION,
  SEASON_REPLAY_EXPORT_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_RULES_VERSION,
  SEASON_ROSTER_TARGETS_VERSION,
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_ROTATION_PLANNER_VERSION,
  SEASON_ROTATION_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  SEASON_STAMINA_VERSION,
  SEASON_TIEBREAK_VERSION,
  SEASON_TRADE_GRADE_VERSION,
  SEASON_TRADE_TARGETS_VERSION,
  SEASON_TRADE_VERSION,
  buildInitialPostseasonState,
  seasonDraftCatalogSchema,
  seasonDraftStateSchema,
  seasonLeagueSchema,
  seasonObjectiveStateSchema,
  buildEmptyChallengeState,
  seasonRosterTargetsSchema,
  seasonRunSchema,
  seasonScheduleSchema,
  seasonFreeAgencyStateSchema,
  type SeasonDraftCommand,
  type SeasonDraftState,
  type SeasonLeague,
  type SeasonLeagueGenerationResult,
  type SeasonRun,
  type SeasonSchedule,
} from '@hoop-rush/data-contracts';
import {
  applySeasonDraftCommand,
  buildEmptyCampaignState,
  buildLocalSoloAuthority,
  createInitialSeasonInfluenceState,
  createSeasonEffectsState,
  dealSeasonBlockChallenges,
  expandSeasonRunRosters,
  generateAiLeague,
  seasonDraftStateDigest,
  seasonRunStateDigest,
} from '@hoop-rush/engine';
import { pickBestSelectable } from './commands/season-data.ts';
import { readJson, sha256Hex } from './io.ts';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const STATIC_DATA = resolve(REPO_ROOT, 'apps/web/static/data');
const SEASON_DIR = resolve(STATIC_DATA, 'season');
const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const MANIFEST_PATH = resolve(STATIC_DATA, 'manifest.json');
function cmd(
  commandId: string,
  expectedRevision: number,
  payload: SeasonDraftCommand['payload'],
): SeasonDraftCommand {
  return { commandId, expectedRevision, payload };
}
function playCommittedDraft(
  catalog: ReturnType<typeof seasonDraftCatalogSchema.parse>,
  league: SeasonLeague,
  targets: ReturnType<typeof seasonRosterTargetsSchema.parse>,
): {
  state: SeasonDraftState;
  commands: SeasonDraftCommand[];
  generation: SeasonLeagueGenerationResult;
} {
  const commands: SeasonDraftCommand[] = [];
  let state: SeasonDraftState | null = null;
  const apply = (command: SeasonDraftCommand): SeasonDraftState => {
    const result = applySeasonDraftCommand(state, catalog, command, {
      generate: (input) => generateAiLeague({ ...input, targets }),
    });
    if (result.record.status !== 'accepted' || result.state === null) {
      const message =
        result.record.status === 'rejected' ? result.record.message : 'no state produced';
      throw new Error(`fixture command ${command.commandId} rejected: ${message}`);
    }
    commands.push(command);
    state = result.state;
    return result.state;
  };
  state = apply(
    cmd('fixture-create', 0, {
      kind: 'create-season-draft',
      runId: 'fixture-season-run-1',
      rootSeed: seedSchema.parse(SEASON_COMMITTED_DRAFT_SEED),
      league,
      humanParticipantIds: ['fixture-human'],
      catalogVersion: SEASON_DRAFT_VERSION,
    }),
  );
  let sequence = 0;
  while (state.status === 'drafting' && state.currentTurnParticipantId !== null) {
    const pid = state.currentTurnParticipantId;
    state = apply(
      cmd(`fixture-draw-${String(sequence)}`, state.revision, {
        kind: 'draw-season-offer',
        participantId: pid,
      }),
    );
    const best = pickBestSelectable(state, catalog);
    state = apply(
      cmd(`fixture-pick-${String(sequence)}`, state.revision, {
        kind: 'select-draft-player',
        participantId: pid,
        playerVersionId: best.playerVersionId,
      }),
    );
    sequence += 1;
  }
  const finalState = state;
  state = apply(cmd('fixture-finalize', finalState.revision, { kind: 'finalize-human-rosters' }));
  const humanRosters = finalState.participants.map((participant) => ({
    franchiseId: participant.franchiseId,
    playerVersionIds: finalState.picks
      .filter((pick) => pick.participantId === participant.participantId)
      .map((pick) => pick.playerVersionId),
  }));
  const generation = generateAiLeague({
    seed: seedSchema.parse(SEASON_COMMITTED_DRAFT_SEED),
    catalog,
    league,
    humanFranchiseIds: humanRosters.map((roster) => roster.franchiseId),
    humanRosters,
    targets,
  });
  state = apply(cmd('fixture-generate', state.revision, { kind: 'generate-ai-league' }));
  return { state, commands, generation };
}
function buildInitialFixtureChallenges(
  league: SeasonLeague,
  schedule: SeasonSchedule,
  rootSeed: ReturnType<typeof seedSchema.parse>,
  humanFranchiseId: string | null,
) {
  const base = buildEmptyChallengeState();
  if (humanFranchiseId === null) return base;
  const standings = {
    schemaVersion: 1 as const,
    standingsVersion: 'standings-v1' as const,
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
  const deal = dealSeasonBlockChallenges(rootSeed, 0, {
    league,
    schedule,
    standings,
    humanFranchiseId,
  });
  if (deal === null) return base;
  return { ...base, deals: { 0: deal } };
}
function buildRun(
  schedule: SeasonSchedule,
  league: SeasonLeague,
  draft: SeasonDraftState,
  generation: SeasonLeagueGenerationResult,
  catalog: ReturnType<typeof seasonDraftCatalogSchema.parse>,
): SeasonRun {
  const humanFranchiseIds = draft.participants.map((p) => p.franchiseId);
  const correctedLeague: SeasonLeague = {
    ...league,
    teams: league.teams.map((team) => ({
      ...team,
      control: humanFranchiseIds.includes(team.franchiseId) ? 'human' : 'ai',
    })),
  };
  const franchiseIds = correctedLeague.teams.map((team) => team.franchiseId);
  const objectives = seasonObjectiveStateSchema.parse({
    schemaVersion: 1,
    objectiveVersion: SEASON_OBJECTIVE_VERSION,
    catalog: [...SEASON_OBJECTIVE_CATALOG],
    selections: {},
  });
  const run: SeasonRun = {
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    runId: idSchema.parse('fixture-season-run-1'),
    rootSeed: seedSchema.parse(SEASON_COMMITTED_DRAFT_SEED),
    authority: buildLocalSoloAuthority(null),
    versions: {
      runSchemaVersion: SEASON_RUN_SCHEMA_VERSION,
      leagueVersion: league.leagueVersion,
      scheduleVersion: schedule.scheduleVersion,
      scheduleFormulaVersion: schedule.formulaVersion,
      standingsVersion: 'standings-v1',
      postseasonVersion: SEASON_POSTSEASON_VERSION,
      seedDerivationVersion: 'season-seeds-v1',
      playerVersionIdVersion: 'player-version-id-v1',
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
      challengeVersion: SEASON_CHALLENGE_VERSION,
      challengeTargetsVersion: SEASON_CHALLENGE_TARGETS_VERSION,
      campaignVersion: SEASON_CAMPAIGN_VERSION,
      campaignTargetsVersion: SEASON_CAMPAIGN_TARGETS_VERSION,
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
      contentHash: contentHashSchema.parse(sha256Hex(`${JSON.stringify(schedule)}\n`)),
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
      standingsVersion: 'standings-v1',
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
    postseason: buildInitialPostseasonState(seedSchema.parse(SEASON_COMMITTED_DRAFT_SEED)),
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
      seed: seedSchema.parse(SEASON_COMMITTED_DRAFT_SEED),
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
    objectives,
    challenges: buildInitialFixtureChallenges(
      correctedLeague,
      schedule,
      seedSchema.parse(SEASON_COMMITTED_DRAFT_SEED),
      draft.participants[0]?.franchiseId ?? null,
    ),
    campaign: buildEmptyCampaignState(),
    health: {
      schemaVersion: 1,
      healthVersion: SEASON_HEALTH_VERSION,
      injuries: [],
    },
    freeAgency: seasonFreeAgencyStateSchema.parse({
      schemaVersion: 1,
      freeAgencyVersion: SEASON_FREE_AGENCY_VERSION,
      windows: [],
      canonicalCandidates: {},
      signingCounts: Object.fromEntries(franchiseIds.map((franchiseId) => [franchiseId, 0])),
      seasonSpend: Object.fromEntries(franchiseIds.map((franchiseId) => [franchiseId, 0])),
    }),
    transactions: [],
    influence: createInitialSeasonInfluenceState(franchiseIds),
    checkpointState: null,
    stateRevision: 0,
    stateDigest: '0'.repeat(32),
  };
  const expanded = expandSeasonRunRosters(run, catalog);
  const staminaInputs = [...expanded.values()].map((player) => {
    if (player.stamina === undefined) {
      throw new Error(`expanded player ${player.playerVersionId} has no stamina profile`);
    }
    return player.stamina;
  });
  const initialEffects = createSeasonEffectsState(staminaInputs);
  const digest = seasonRunStateDigest({
    stateRevision: run.stateRevision,
    stage: run.stage,
    postseason: run.postseason,
    awards: run.awards,
    completion: run.completion,
    checkpointState: run.checkpointState,
    health: run.health,
    influence: run.influence,
    transactions: run.transactions,
    trade: run.trade,
    freeAgency: run.freeAgency,
    objectives: run.objectives,
    challenges: run.challenges ?? null,
    campaign: run.campaign,
    rosters: run.rosters,
    ownership: run.ownership,
    rotations: run.rotations,
    effects: initialEffects,
  });
  return seasonRunSchema.parse({ ...run, stateDigest: digest });
}
function main(): void {
  const league = seasonLeagueSchema.parse(readJson(resolve(SEASON_DIR, 'league.json')));
  const leagueJson = JSON.stringify(league, null, 2);
  mkdirSync(SEASON_DIR, { recursive: true });
  writeFileSync(resolve(SEASON_DIR, 'league.json'), `${leagueJson}\n`);
  const schedulePath = resolve(SEASON_DIR, 'schedule.json');
  if (!existsSync(schedulePath)) {
    console.log(
      `SKIP fixture regeneration: ${schedulePath} missing (run season schedule generate first)`,
    );
    return;
  }
  const scheduleBytes = readFileSync(schedulePath);
  const schedule = seasonScheduleSchema.parse(JSON.parse(scheduleBytes.toString('utf8')));
  const catalog = seasonDraftCatalogSchema.parse(
    readJson(resolve(SEASON_DIR, 'draft-catalog.json')),
  );
  const targets = seasonRosterTargetsSchema.parse(
    readJson(resolve(SEASON_DIR, 'roster-targets.json')),
  );
  const { state, commands, generation } = playCommittedDraft(catalog, league, targets);
  const fixture = buildRun(schedule, league, state, generation, catalog);
  mkdirSync(FIXTURES_DIR, { recursive: true });
  writeFileSync(resolve(FIXTURES_DIR, 'season-run.json'), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${resolve(FIXTURES_DIR, 'season-run.json')}`);
  const finalDigest = seasonDraftStateDigest(state);
  const reproduceFixture = {
    schemaVersion: 1,
    command: 'season draft reproduce',
    seed: SEASON_COMMITTED_DRAFT_SEED,
    catalogVersion: SEASON_DRAFT_VERSION,
    initialState: null,
    commands,
    expected: { finalDigest, finalRevision: state.revision },
  };
  writeFileSync(
    resolve(FIXTURES_DIR, 'season-draft-commands.json'),
    `${JSON.stringify(reproduceFixture, null, 2)}\n`,
  );
  console.log(
    `wrote ${resolve(FIXTURES_DIR, 'season-draft-commands.json')} (${String(commands.length)} commands, digest ${finalDigest})`,
  );
  const finalizedState = seasonDraftStateSchema.parse(state);
  writeFileSync(
    resolve(FIXTURES_DIR, 'season-draft-finalized.json'),
    `${JSON.stringify(finalizedState, null, 2)}\n`,
  );
  console.log(`wrote ${resolve(FIXTURES_DIR, 'season-draft-finalized.json')}`);
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
    season?: Record<
      string,
      {
        url?: string;
        contentHash?: string;
      }
    >;
  };
  if (manifest.season === undefined) {
    console.log('SKIP manifest update: season section missing');
    return;
  }
  manifest.season.league = { url: 'season/league.json', contentHash: sha256Hex(`${leagueJson}\n`) };
  manifest.season.schedule = { url: 'season/schedule.json', contentHash: sha256Hex(scheduleBytes) };
  const draftCatalogBytes = readFileSync(resolve(SEASON_DIR, 'draft-catalog.json'));
  manifest.season.draftCatalog = {
    url: 'season/draft-catalog.json',
    contentHash: sha256Hex(draftCatalogBytes),
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`manifest season hashes updated (league, schedule, draftCatalog)`);
  console.log(`schedule schema check: ok; seed ${SEASON_COMMITTED_SCHEDULE_SEED}`);
  console.log(`draft seed ${SEASON_COMMITTED_DRAFT_SEED} · final digest ${finalDigest}`);
}
main();
