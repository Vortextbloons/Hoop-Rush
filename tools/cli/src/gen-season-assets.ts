/**
 * Generates the committed Season Run assets (spec/2.0 M2.0/M2.1): the frozen
 * league artifact, the complete 30-team fixture under `src/fixtures/` built
 * through the authoritative ten-player draft and AI league generation, the
 * committed draft-commands reproduction fixture, and the manifest `season`
 * hash references. Run with
 * `pnpm --filter @hoop-rush/cli gen-season-assets` AFTER the schedule
 * artifact exists (`hoop-rush season schedule generate --out
 * apps/web/static/data/season/schedule.json`); the script refuses to touch
 * the manifest when the schedule artifact is missing so hashes always match
 * the committed bytes.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SEASON_AGGREGATES_VERSION,
  SEASON_AI_VERSION,
  SEASON_BLOCK_VERSION,
  SEASON_CHECKPOINT_VERSION,
  SEASON_CHEMISTRY_VERSION,
  SEASON_COMMITTED_DRAFT_SEED,
  SEASON_COMMITTED_SCHEDULE_SEED,
  SEASON_DRAFT_VERSION,
  SEASON_EFFECT_TARGETS_VERSION,
  SEASON_GAME_SUMMARY_VERSION,
  SEASON_GAME_TARGETS_VERSION,
  SEASON_GAME_VERSION,
  SEASON_HOME_COURT_VERSION,
  SEASON_LEADERS_VERSION,
  SEASON_RECAP_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_RULES_VERSION,
  SEASON_ROSTER_TARGETS_VERSION,
  SEASON_ROTATION_PLANNER_VERSION,
  SEASON_ROTATION_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  SEASON_STAMINA_VERSION,
  seasonDraftCatalogSchema,
  seasonDraftStateSchema,
  seasonLeagueSchema,
  seasonRosterTargetsSchema,
  seasonRunSchema,
  seasonScheduleSchema,
  type SeasonDraftCommand,
  type SeasonDraftState,
  type SeasonLeague,
  type SeasonLeagueGenerationResult,
  type SeasonRun,
  type SeasonSchedule,
} from '@hoop-rush/data-contracts';
import {
  applySeasonDraftCommand,
  generateAiLeague,
  seasonDraftStateDigest,
} from '@hoop-rush/engine';
import { buildSeasonRunFixture } from '@hoop-rush/test-fixtures';
import { pickBestSelectable } from './commands/season-data.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const STATIC_DATA = resolve(REPO_ROOT, 'apps/web/static/data');
const SEASON_DIR = resolve(STATIC_DATA, 'season');
const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const MANIFEST_PATH = resolve(STATIC_DATA, 'manifest.json');

function sha256Hex(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function cmd(
  commandId: string,
  expectedRevision: number,
  payload: SeasonDraftCommand['payload'],
): SeasonDraftCommand {
  return { commandId, expectedRevision, payload };
}

/**
 * Plays the committed one-human draft to completion through real commands:
 * create -> per round: draw the global eight-card offer, pick the best
 * selectable card -> finalize -> generate the AI league. All commands are
 * recorded so the reproduction fixture replays them byte-for-byte. The AI
 * generation consumes the verified `roster-targets-v2` artifact from the
 * packaged season directory.
 */
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
      rootSeed: SEASON_COMMITTED_DRAFT_SEED,
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
    seed: SEASON_COMMITTED_DRAFT_SEED,
    catalog,
    league,
    humanFranchiseIds: humanRosters.map((roster) => roster.franchiseId),
    humanRosters,
    targets,
  });
  state = apply(cmd('fixture-generate', state.revision, { kind: 'generate-ai-league' }));
  return { state, commands, generation };
}

/** Builds the v3 Season Run snapshot from the committed draft + generation. */
function buildRun(
  schedule: SeasonSchedule,
  league: SeasonLeague,
  draft: SeasonDraftState,
  generation: SeasonLeagueGenerationResult,
): SeasonRun {
  const humanFranchiseIds = draft.participants.map((p) => p.franchiseId);
  const correctedLeague: SeasonLeague = {
    ...league,
    teams: league.teams.map((team) => ({
      ...team,
      control: humanFranchiseIds.includes(team.franchiseId) ? 'human' : 'ai',
    })),
  };
  const run: SeasonRun = {
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    runId: 'fixture-season-run-1',
    rootSeed: SEASON_COMMITTED_DRAFT_SEED,
    versions: {
      runSchemaVersion: SEASON_RUN_SCHEMA_VERSION,
      leagueVersion: league.leagueVersion,
      scheduleVersion: schedule.scheduleVersion,
      scheduleFormulaVersion: schedule.formulaVersion,
      standingsVersion: 'standings-v1',
      postseasonVersion: 'postseason-v1',
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
      staminaVersion: SEASON_STAMINA_VERSION,
      chemistryVersion: SEASON_CHEMISTRY_VERSION,
      effectsTargetsVersion: SEASON_EFFECT_TARGETS_VERSION,
    },
    league: correctedLeague,
    rosters: generation.rosters,
    ownership: generation.ownership,
    schedule: {
      leagueVersion: schedule.leagueVersion,
      scheduleVersion: schedule.scheduleVersion,
      formulaVersion: schedule.formulaVersion,
      generationSeed: schedule.generationSeed,
      contentHash: sha256Hex(`${JSON.stringify(schedule)}\n`),
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
    postseason: {
      schemaVersion: 1,
      postseasonVersion: 'postseason-v1',
      seed: SEASON_COMMITTED_DRAFT_SEED,
      playIn: {
        east: {
          conference: 'east',
          ranking: null,
          games: {
            sevenEight: {
              gameId: 'seven-eight',
              status: 'scheduled',
              homeFranchiseId: null,
              awayFranchiseId: null,
              winnerFranchiseId: null,
              loserFranchiseId: null,
              homeScore: null,
              awayScore: null,
            },
            nineTen: {
              gameId: 'nine-ten',
              status: 'scheduled',
              homeFranchiseId: null,
              awayFranchiseId: null,
              winnerFranchiseId: null,
              loserFranchiseId: null,
              homeScore: null,
              awayScore: null,
            },
            final: {
              gameId: 'final',
              status: 'scheduled',
              homeFranchiseId: null,
              awayFranchiseId: null,
              winnerFranchiseId: null,
              loserFranchiseId: null,
              homeScore: null,
              awayScore: null,
            },
          },
          playoffSeeds: null,
        },
        west: {
          conference: 'west',
          ranking: null,
          games: {
            sevenEight: {
              gameId: 'seven-eight',
              status: 'scheduled',
              homeFranchiseId: null,
              awayFranchiseId: null,
              winnerFranchiseId: null,
              loserFranchiseId: null,
              homeScore: null,
              awayScore: null,
            },
            nineTen: {
              gameId: 'nine-ten',
              status: 'scheduled',
              homeFranchiseId: null,
              awayFranchiseId: null,
              winnerFranchiseId: null,
              loserFranchiseId: null,
              homeScore: null,
              awayScore: null,
            },
            final: {
              gameId: 'final',
              status: 'scheduled',
              homeFranchiseId: null,
              awayFranchiseId: null,
              winnerFranchiseId: null,
              loserFranchiseId: null,
              homeScore: null,
              awayScore: null,
            },
          },
          playoffSeeds: null,
        },
      },
      bracket: null,
      championFranchiseId: null,
    },
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
      seed: SEASON_COMMITTED_DRAFT_SEED,
      aiVersion: SEASON_AI_VERSION,
      rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
      rotationVersion: SEASON_ROTATION_VERSION,
      rosterTargetsVersion: SEASON_ROSTER_TARGETS_VERSION,
      digest: generation.digest,
      diagnostics: generation.diagnostics,
    },
    evaluations: generation.evaluations,
  };
  return seasonRunSchema.parse(run);
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
  const fixture = buildRun(schedule, league, state, generation);
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

  // Legacy builders stay available for tests; the committed fixture now
  // reflects the real pipeline.
  void buildSeasonRunFixture;
  void seasonDraftStateSchema;

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
    season?: Record<string, { url?: string; contentHash?: string }>;
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
