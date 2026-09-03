import { describe, expect, it } from 'vitest';
import {
  buildCompletedSeasonRunReplayExport,
  seasonReplayAssetHashesOf,
} from './season-completed-export';
import type { HoopRushManifest } from '@hoop-rush/data-contracts';
import type { SeasonCompletedSeason } from '@hoop-rush/persistence';
import {
  SEASON_EMPTY_COMMAND_LOG_DIGEST,
  SEASON_RUN_SCHEMA_VERSION,
  seasonCommandLogDigest,
} from '@hoop-rush/data-contracts';
function manifest(): HoopRushManifest {
  return {
    schemaVersion: 4,
    dataVersion: 'test',
    modernFranchiseSlots: Array.from({ length: 30 }, (_, index) => ({
      franchiseId: `team-${String(index)}`,
      displayName: `Team ${String(index)}`,
      teamExternalId: `team-${String(index)}`,
    })),
    franchiseLineage: [],
    eras: [{ eraId: '1990s', label: '1990s', fromSeasonKey: '1990-91', toSeasonKey: '1999-00' }],
    pools: [],
    availability: [],
    eraSimulationProfiles: [
      { eraId: '1990s', url: 'era-sim/1990s.json', contentHash: 'a'.repeat(64) },
    ],
    season: {
      league: { url: 'season/league.json', contentHash: 'b'.repeat(64) },
      schedule: { url: 'season/schedule.json', contentHash: 'c'.repeat(64) },
      draftCatalog: { url: 'season/draft-catalog.json', contentHash: 'd'.repeat(64) },
      rosterTargets: { url: 'season/roster-targets.json', contentHash: 'e'.repeat(64) },
      freeAgencyIndex: { url: 'season/free-agency-index.json', contentHash: 'f'.repeat(64) },
      freeAgencyTargets: { url: 'season/free-agency-targets.json', contentHash: '1'.repeat(64) },
    },
    assets: {
      headshotUrlTemplate: null,
      headshotUrlTemplateSecondary: null,
      logoUrlTemplate: null,
      logoUrlTemplateSecondary: null,
      source: 'test',
      cacheVersion: 'test',
    },
  };
}
function completedSeason(): SeasonCompletedSeason {
  const season = {
    run: {
      schemaVersion: SEASON_RUN_SCHEMA_VERSION,
      runId: 'run-1',
      rootSeed: 'a'.repeat(32),
      versions: {
        runSchemaVersion: SEASON_RUN_SCHEMA_VERSION,
        leagueVersion: 'league-v1',
        scheduleVersion: 'schedule-v1',
        scheduleFormulaVersion: 'schedule-formula-v1',
        standingsVersion: 'standings-v1',
        postseasonVersion: 'postseason-v2',
        seedDerivationVersion: 'season-seeds-v1',
        playerVersionIdVersion: 'player-version-id-v1',
        draftVersion: 'season-draft-v2',
        rosterRulesVersion: 'season-roster-v2',
        rosterGenerationVersion: 'roster-generation-v3',
        aiVersion: 'season-ai-v3',
        rotationVersion: 'season-rotation-v3',
        minutePolicyVersion: 'minute-policy-v1',
        rotationPlannerVersion: 'rotation-planner-v1',
        gameVersion: 'season-game-v4',
        gameTargetsVersion: 'season-game-targets-v4',
        rosterTargetsVersion: 'roster-targets-v3',
        blockVersion: 'season-block-v5',
        summaryVersion: 'season-game-summary-v3',
        aggregatesVersion: 'season-aggregates-v2',
        recapVersion: 'season-recap-v5',
        leadersVersion: 'season-leaders-v1',
        homeCourtVersion: 'season-home-court-v1',
        checkpointVersion: 'season-checkpoint-v5',
        staminaVersion: 'season-stamina-v2',
        chemistryVersion: 'season-chemistry-v2',
        effectsTargetsVersion: 'season-effect-targets-v2',
        healthVersion: 'season-health-v2',
        tradeVersion: 'season-trade-v3',
        influenceVersion: 'season-influence-v2',
        objectiveVersion: 'season-objective-v1',
        campaignVersion: 'season-campaign-v1',
        campaignTargetsVersion: 'campaign-targets-v1',
        injuryTargetsVersion: 'injury-targets-v2',
        tradeTargetsVersion: 'trade-targets-v3',
        influenceTargetsVersion: 'influence-targets-v2',
        tiebreakVersion: 'tiebreaker-v1',
        postseasonSummaryVersion: 'postseason-summary-v1',
        awardsVersion: 'awards-v1',
        tradeGradeVersion: 'trade-grade-v1',
        commandLogVersion: 'command-log-v1',
        almanacVersion: 'almanac-v1',
        replayExportVersion: 'replay-export-v1',
        postseasonTargetsVersion: 'postseason-targets-v1',
        freeAgencyVersion: 'season-free-agency-v1',
        freeAgencyIndexVersion: 'free-agency-index-v1',
        freeAgencyTargetsVersion: 'free-agency-targets-v1',
        durabilityVersion: 'durability-v1',
      },
      league: {
        schemaVersion: 1,
        leagueVersion: 'league-v1',
        teams: Array.from({ length: 30 }, (_, index) => ({
          franchiseId: index === 0 ? 'lakers' : `team-${String(index)}`,
          control: index === 0 ? 'human' : 'ai',
          conference: index < 15 ? 'west' : 'east',
          division: 'pacific',
        })),
      },
      stage: 'completed',
      stateRevision: 3,
      stateDigest: '2'.repeat(32),
      rosters: [
        {
          franchiseId: 'lakers',
          players: [
            {
              playerVersionId: 'pv-1',
              playerId: 'p-1',
              franchiseId: 'lakers',
              eraId: '1990s',
              seasonKey: '1990-91',
              displayName: 'Test Player',
              positionsPlayable: ['PG'],
            },
          ],
        },
      ],
      ownership: {},
      rotations: {},
      standings: { schemaVersion: 1, standingsVersion: 'standings-v1', teams: [] },
      games: [],
      postseason: {
        schemaVersion: 2,
        postseasonVersion: 'postseason-v2',
        stage: 'completed',
        championFranchiseId: 'lakers',
        tiebreakResolutions: [],
        playIn: { east: [], west: [] },
        bracket: { east: [], west: [] },
        finals: null,
      },
      awards: null,
      completion: {
        championFranchiseId: 'lakers',
        almanacDigest: '0'.repeat(32),
        finalizedAtStateRevision: 3,
      },
      health: { schemaVersion: 1, healthVersion: 'season-health-v2', players: [] },
      influence: {
        schemaVersion: 1,
        influenceVersion: 'season-influence-v2',
        balances: {},
        ledger: [],
      },
      transactions: [],
      trade: null,
      objectives: null,
      campaign: null,
      effects: {
        schemaVersion: 1,
        staminaVersion: 'season-stamina-v2',
        chemistryVersion: 'season-chemistry-v2',
        players: [],
        pairs: [],
      },
      freeAgency: null,
      checkpointState: null,
    },
    almanac: {
      schemaVersion: 1,
      almanacVersion: 'almanac-v1',
      runId: 'run-1',
      rootSeed: 'a'.repeat(32),
      championFranchiseId: 'lakers',
      postseasonDigest: '0'.repeat(32),
      commandLogDigest: SEASON_EMPTY_COMMAND_LOG_DIGEST,
      awardsDigest: '0'.repeat(32),
      tradeGradesDigest: '0'.repeat(32),
      digest: '0'.repeat(32),
    },
    commandLog: {
      schemaVersion: 1,
      commandLogVersion: 'command-log-v1',
      runId: 'run-1',
      entries: [],
    },
    summaries: [],
    postseasonSummaries: [],
  } as unknown as SeasonCompletedSeason;
  (
    season as unknown as {
      almanac: {
        commandLogDigest: string;
      };
    }
  ).almanac.commandLogDigest = seasonCommandLogDigest(
    (
      season as unknown as {
        commandLog: {
          entries: unknown[];
        };
      }
    ).commandLog.entries as never,
  );
  return season;
}
describe('season-completed-export', () => {
  it('builds replay asset hashes from the manifest era profile', () => {
    expect(seasonReplayAssetHashesOf(manifest(), '1990s').eraProfile).toBe('a'.repeat(64));
  });
  it('builds a full-run replay export for a completed season', () => {
    const artifact = buildCompletedSeasonRunReplayExport(completedSeason(), manifest());
    expect(artifact.kind).toBe('full-run');
    expect(artifact.runId).toBe('run-1');
    expect(artifact.eraId).toBe('1990s');
    expect(artifact.digest).toMatch(/^[0-9a-f]{32}$/);
  });
});
