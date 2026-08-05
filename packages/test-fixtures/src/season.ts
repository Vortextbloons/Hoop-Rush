import {
  SEASON_AI_VERSION,
  SEASON_AGGREGATES_VERSION,
  SEASON_BLOCK_VERSION,
  SEASON_CHECKPOINT_VERSION,
  SEASON_DRAFT_VERSION,
  SEASON_GAME_SUMMARY_VERSION,
  SEASON_GAME_TARGETS_VERSION,
  SEASON_GAME_VERSION,
  SEASON_HOME_COURT_VERSION,
  SEASON_LEADERS_VERSION,
  SEASON_POSTSEASON_VERSION,
  SEASON_RECAP_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_RULES_VERSION,
  SEASON_ROSTER_TARGETS_VERSION,
  SEASON_ROSTER_SIZE,
  SEASON_ROTATION_PLANNER_VERSION,
  SEASON_ROTATION_VERSION,
  SEASON_SEED_NAMESPACES,
  seasonNamespaceSeed,
  playerVersionId,
  type SeasonGame,
  type SeasonLeague,
  type SeasonPostseasonState,
  type SeasonRoster,
  type SeasonRun,
  type SeasonSchedule,
  type SeasonStandings,
} from '@hoop-rush/data-contracts';
import {
  buildFixtureEvaluations,
  buildFixtureGenerationAudit,
  buildFixtureSeasonDraftFacts,
  buildSeasonAiAssignments,
  buildSeasonRotation,
} from './season-draft.ts';

/**
 * Deterministic Season Run fixture builders (spec/2.0 M2.0, M2.1). Every
 * builder returns schema-valid records so engine tests and CLI fixtures can
 * rely on the frozen contracts. Rosters are synthetic: ten peak
 * player-versions per team with derived, unique playerVersionIds, plus the
 * M2.1 draft facts, AI assignments, rotations, evaluations, and audit fields.
 */

interface AlignmentEntry {
  conference: 'east' | 'west';
  division: 'atlantic' | 'central' | 'southeast' | 'northwest' | 'pacific' | 'southwest';
}

/** Accepted NBA conference/division alignment (league-v1). */
const ALIGNMENT: Record<string, AlignmentEntry> = {
  hawks: { conference: 'east', division: 'southeast' },
  celtics: { conference: 'east', division: 'atlantic' },
  nets: { conference: 'east', division: 'atlantic' },
  hornets: { conference: 'east', division: 'southeast' },
  bulls: { conference: 'east', division: 'central' },
  cavaliers: { conference: 'east', division: 'central' },
  pistons: { conference: 'east', division: 'central' },
  pacers: { conference: 'east', division: 'central' },
  heat: { conference: 'east', division: 'southeast' },
  bucks: { conference: 'east', division: 'central' },
  knicks: { conference: 'east', division: 'atlantic' },
  magic: { conference: 'east', division: 'southeast' },
  sixers: { conference: 'east', division: 'atlantic' },
  raptors: { conference: 'east', division: 'atlantic' },
  wizards: { conference: 'east', division: 'southeast' },
  mavericks: { conference: 'west', division: 'southwest' },
  nuggets: { conference: 'west', division: 'northwest' },
  warriors: { conference: 'west', division: 'pacific' },
  rockets: { conference: 'west', division: 'southwest' },
  clippers: { conference: 'west', division: 'pacific' },
  lakers: { conference: 'west', division: 'pacific' },
  grizzlies: { conference: 'west', division: 'southwest' },
  timberwolves: { conference: 'west', division: 'northwest' },
  pelicans: { conference: 'west', division: 'southwest' },
  thunder: { conference: 'west', division: 'northwest' },
  suns: { conference: 'west', division: 'pacific' },
  blazers: { conference: 'west', division: 'northwest' },
  kings: { conference: 'west', division: 'pacific' },
  spurs: { conference: 'west', division: 'southwest' },
  jazz: { conference: 'west', division: 'northwest' },
};

const FRANCHISE_ORDER = Object.keys(ALIGNMENT);

/** The frozen league: 30 teams; one human franchise (default lakers), rest AI. */
export function buildSeasonLeague(
  overrides: Partial<SeasonLeague> = {},
  options: { humanFranchiseId?: string } = {},
): SeasonLeague {
  const human = options.humanFranchiseId ?? 'lakers';
  return {
    schemaVersion: 1,
    leagueVersion: 'league-v1',
    teams: FRANCHISE_ORDER.map((franchiseId) => {
      const alignment = ALIGNMENT[franchiseId];
      if (!alignment) throw new Error(`no alignment for ${franchiseId}`);
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

/**
 * Deterministic ten-player rosters for every team: playerVersionIds derived
 * from synthetic identity fields, unique across the league.
 */
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
    standingsVersion: 'standings-v1',
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

function emptyPostseason(rootSeed: string): SeasonPostseasonState {
  const game = (gameId: 'seven-eight' | 'nine-ten' | 'final') => ({
    gameId,
    status: 'scheduled' as const,
    homeFranchiseId: null,
    awayFranchiseId: null,
    winnerFranchiseId: null,
    loserFranchiseId: null,
    homeScore: null,
    awayScore: null,
  });
  const conference = (id: 'east' | 'west') => ({
    conference: id,
    ranking: null,
    games: {
      sevenEight: game('seven-eight'),
      nineTen: game('nine-ten'),
      final: game('final'),
    },
    playoffSeeds: null,
  });
  return {
    schemaVersion: 1,
    postseasonVersion: SEASON_POSTSEASON_VERSION,
    seed: seasonNamespaceSeed(rootSeed, SEASON_SEED_NAMESPACES.postseasonTies),
    playIn: { east: conference('east'), west: conference('west') },
    bracket: null,
    championFranchiseId: null,
  };
}

/**
 * Complete 30-team Season Run snapshot: committed schedule (caller-supplied
 * schedule — use the packaged artifact or regenerate it with
 * SEASON_COMMITTED_SCHEDULE_SEED), empty results, initial standings, block
 * cursor at round 0, postseason-ready derived seeds, and schema-v4 M2.3
 * fields (synthetic draft facts, assignments, rotations, evaluations, the
 * generation audit, and the frozen block/summary/aggregates/recap/leaders/
 * home-court/checkpoint versions).
 */
export function buildSeasonRunFixture(input: {
  schedule: SeasonSchedule;
  league?: SeasonLeague;
  seed?: string;
  humanFranchiseId?: string;
  /** SHA-256 of the schedule artifact; fixtures default to a placeholder. */
  scheduleContentHash?: string;
}): SeasonRun {
  const seed = input.seed ?? 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';
  const league =
    input.league ?? buildSeasonLeague({}, { humanFranchiseId: input.humanFranchiseId });
  const rosters = buildSeasonRosters(league, seed);
  const aiAssignments = buildSeasonAiAssignments(league);
  const rotations = rosters.map((roster) =>
    buildSeasonRotation(
      roster.franchiseId,
      roster.players.map((player) => player.playerVersionId),
    ),
  );
  return {
    schemaVersion: 4,
    runId: 'fixture-season-run-1',
    rootSeed: seed,
    versions: {
      runSchemaVersion: 4,
      leagueVersion: league.leagueVersion,
      scheduleVersion: input.schedule.scheduleVersion,
      scheduleFormulaVersion: input.schedule.formulaVersion,
      standingsVersion: 'standings-v1',
      postseasonVersion: SEASON_POSTSEASON_VERSION,
      seedDerivationVersion: 'season-seeds-v1',
      playerVersionIdVersion: 'player-version-id-v1',
      draftVersion: SEASON_DRAFT_VERSION,
      rosterRulesVersion: SEASON_ROSTER_RULES_VERSION,
      rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
      aiVersion: SEASON_AI_VERSION,
      rotationVersion: SEASON_ROTATION_VERSION,
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
    },
    league,
    rosters,
    ownership: rosters.flatMap((roster) =>
      roster.players.map((player) => ({
        playerVersionId: player.playerVersionId,
        ownerFranchiseId: roster.franchiseId,
      })),
    ),
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
    postseason: emptyPostseason(seed),
    draft: buildFixtureSeasonDraftFacts(),
    aiAssignments,
    rotations,
    generationAudit: buildFixtureGenerationAudit(seed),
    evaluations: buildFixtureEvaluations(rosters, aiAssignments),
  };
}
