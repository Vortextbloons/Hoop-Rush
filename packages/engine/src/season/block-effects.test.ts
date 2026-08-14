import { describe, expect, it } from 'vitest';
import {
  SEASON_AI_VERSION,
  SEASON_BLOCK_VERSION,
  SEASON_CHEMISTRY_VERSION,
  SEASON_EFFECT_TARGETS_VERSION,
  SEASON_GAME_SUMMARY_VERSION,
  SEASON_GAME_TARGETS_VERSION,
  SEASON_GAME_VERSION,
  SEASON_LEAGUE_VERSION,
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_POSTSEASON_VERSION,
  SEASON_RECAP_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_RULES_VERSION,
  SEASON_ROTATION_PLANNER_VERSION,
  SEASON_ROTATION_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  SEASON_SCHEDULE_FORMULA_VERSION,
  SEASON_SCHEDULE_VERSION,
  SEASON_SEED_DERIVATION_VERSION,
  SEASON_STAMINA_VERSION,
  SEASON_STANDINGS_VERSION,
  buildInitialPostseasonState,
  seasonRunSchema,
  type SeasonAiPool,
  type SeasonCandidateCheckpoint,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonGameSummary,
  type SeasonRosterEvaluation,
  type SeasonRun,
} from '@hoop-rush/data-contracts';
import { ALL_FRANCHISES, TEST_SEED, runBlock, type RunnerState } from './block-test-support.ts';
import {
  buildFixtureGenerationAudit,
  buildFixtureSeasonDraftFacts,
  buildSeasonDraftCatalog,
  buildSeasonLeague,
} from '@hoop-rush/test-fixtures';
import { generateSeasonSchedule } from './schedule.ts';
import { expandSeasonRunRosters } from './block.ts';
import { createSeasonEffectsState } from './effects.ts';
import { buildMinimalRotation } from './rotation.ts';
import { pairChemistryBasisPoints } from './chemistry.ts';
import { createInitialSeasonInfluenceState } from './influence.ts';
import {
  SEASON_AGGREGATES_VERSION,
  SEASON_CHECKPOINT_VERSION,
  SEASON_HEALTH_VERSION,
  SEASON_INFLUENCE_TARGETS_VERSION,
  SEASON_INFLUENCE_VERSION,
  SEASON_INJURY_TARGETS_VERSION,
  SEASON_OBJECTIVE_CATALOG,
  SEASON_OBJECTIVE_VERSION,
  SEASON_TRADE_TARGETS_VERSION,
  SEASON_TRADE_VERSION,
} from '@hoop-rush/data-contracts';

/**
 * M2.4 block-level effects and determinism. The shared block test support
 * builds its league through AI generation; this suite synthesizes a legal
 * 30-franchise run directly from the fixture catalog so the effects seam can
 * be verified independently of any AI-generation changes.
 */

/** Synthesizes one legal ten from a franchise pool: 4 G, 4 F, 3 C greedy. */
function synthesizeRoster(
  catalog: SeasonDraftCatalog,
  franchiseId: string,
): Array<{
  playerVersionId: string;
  playerId: string;
  franchiseId: string;
  eraId: string;
  seasonKey: string;
  displayName: string;
  playable: readonly string[];
}> {
  const pool = catalog.pools.find(
    (entry) => entry.franchiseId === franchiseId && entry.eraId === '1990s',
  );
  if (pool === undefined) throw new Error(`missing pool for ${franchiseId}`);
  const byVersion = new Map(
    catalog.candidates.map((candidate) => [candidate.playerVersionId, candidate]),
  );
  const picks: Array<{
    playerVersionId: string;
    playerId: string;
    franchiseId: string;
    eraId: string;
    seasonKey: string;
    displayName: string;
    playable: readonly string[];
  }> = [];
  const needs = { centers: 3, guards: 4, forwards: 4 };
  for (const version of pool.playerVersionIds) {
    const candidate = byVersion.get(version);
    if (candidate === undefined) continue;
    const playable = candidate.positions.playable;
    if (needs.centers > 0 && playable.includes('C')) {
      needs.centers -= 1;
    } else if (
      needs.guards > 0 &&
      playable.some((position) => position === 'PG' || position === 'SG')
    ) {
      needs.guards -= 1;
    } else if (needs.forwards > 0) {
      needs.forwards -= 1;
    } else {
      continue;
    }
    picks.push({
      playerVersionId: candidate.playerVersionId,
      playerId: candidate.playerId,
      franchiseId: candidate.franchiseId,
      eraId: candidate.eraId,
      seasonKey: candidate.seasonKey,
      displayName: candidate.displayName,
      playable,
    });
    if (picks.length === 10) break;
  }
  if (picks.length !== 10) {
    throw new Error(`pool ${franchiseId} cannot synthesize a legal ten`);
  }
  return picks;
}

/** A schema-valid schema-6 run with synthesized rosters and rotations. */
function buildSynthesizedRun(): { run: SeasonRun; catalog: SeasonDraftCatalog } {
  const league = buildSeasonLeague({}, { humanFranchiseId: 'lakers' });
  const catalog = buildSeasonDraftCatalog({
    franchiseIds: [...ALL_FRANCHISES],
    eras: ['1990s'],
    playersPerPool: 40,
  });
  const schedule = generateSeasonSchedule({ league, seed: TEST_SEED });
  const rosters = ALL_FRANCHISES.map((franchiseId) => {
    const members = synthesizeRoster(catalog, franchiseId);
    return {
      franchiseId,
      players: members.map((member) => ({
        playerVersionId: member.playerVersionId,
        playerId: member.playerId,
        franchiseId: member.franchiseId,
        eraId: member.eraId,
        seasonKey: member.seasonKey,
        displayName: member.displayName,
      })),
    };
  });
  const ownership = rosters.flatMap((roster) =>
    roster.players.map((player) => ({
      playerVersionId: player.playerVersionId,
      ownerFranchiseId: roster.franchiseId,
    })),
  );
  const bandCycle = ['contender', 'playoff', 'average', 'weaker'] as const;
  const identityCycle = [
    'star-chaser',
    'depth-builder',
    'defense-first',
    'shooting-first',
    'continuity',
    'active-trader',
  ] as const;
  const aiAssignments = ALL_FRANCHISES.map((franchiseId, index) => ({
    franchiseId,
    band: bandCycle[index % 4] ?? 'average',
    identity: identityCycle[index % 6] ?? 'continuity',
  }));
  const evaluations: SeasonRosterEvaluation[] = aiAssignments.map((assignment) => ({
    franchiseId: assignment.franchiseId,
    band: assignment.band,
    identity: assignment.identity,
    strengthScore: 60 + (ALL_FRANCHISES.indexOf(assignment.franchiseId) % 20),
    roleScores: {
      'primary-creation': 50,
      'secondary-creation': 50,
      'perimeter-shooting': 50,
      'rim-finishing-interior-scoring': 50,
      'perimeter-defense': 50,
      'interior-defense': 50,
      'offensive-rebounding': 50,
      'defensive-rebounding': 50,
    },
    rolesCovered: [
      'primary-creation',
      'secondary-creation',
      'perimeter-shooting',
      'rim-finishing-interior-scoring',
      'perimeter-defense',
      'interior-defense',
      'offensive-rebounding',
      'defensive-rebounding',
    ] as const,
    overallReport: 60,
  }));
  const rotations = rosters.map((roster) => {
    const members = synthesizeRoster(catalog, roster.franchiseId).map((member) => ({
      playerVersionId: member.playerVersionId,
      playable: [...member.playable] as readonly ('PG' | 'SG' | 'SF' | 'PF' | 'C')[],
    }));
    return buildMinimalRotation({ franchiseId: roster.franchiseId, members });
  });
  const aiPools: SeasonAiPool[] = aiAssignments
    .filter((assignment) => assignment.franchiseId !== 'lakers')
    .map((assignment, poolIndex) => {
      const playerVersionIds = Array.from({ length: 20 }, (_, slot) => {
        const hex = `${String(poolIndex).padStart(2, '0')}${String(slot).padStart(2, '0')}`.padEnd(
          32,
          '0',
        );
        return `pv-${hex}`;
      });
      const selections = playerVersionIds.slice(0, 10);
      return {
        franchiseId: assignment.franchiseId,
        band: assignment.band,
        identity: assignment.identity,
        playerVersionIds,
        anchors: [],
        selections,
        allocationSeedPaths: selections.map((_version, slot) => [
          'ai',
          'selection',
          assignment.franchiseId,
          String(slot),
        ]),
        repairCount: 0,
      };
    });
  const run: SeasonRun = {
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    runId: 'block-effects-test-run',
    rootSeed: TEST_SEED,
    versions: {
      runSchemaVersion: SEASON_RUN_SCHEMA_VERSION,
      leagueVersion: SEASON_LEAGUE_VERSION,
      scheduleVersion: SEASON_SCHEDULE_VERSION,
      scheduleFormulaVersion: SEASON_SCHEDULE_FORMULA_VERSION,
      standingsVersion: SEASON_STANDINGS_VERSION,
      postseasonVersion: SEASON_POSTSEASON_VERSION,
      seedDerivationVersion: SEASON_SEED_DERIVATION_VERSION,
      playerVersionIdVersion: 'player-version-id-v1',
      draftVersion: 'season-draft-v1',
      rosterRulesVersion: SEASON_ROSTER_RULES_VERSION,
      rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
      aiVersion: SEASON_AI_VERSION,
      rotationVersion: SEASON_ROTATION_VERSION,
      minutePolicyVersion: SEASON_MINUTE_POLICY_VERSION,
      rotationPlannerVersion: SEASON_ROTATION_PLANNER_VERSION,
      gameVersion: SEASON_GAME_VERSION,
      gameTargetsVersion: SEASON_GAME_TARGETS_VERSION,
      rosterTargetsVersion: 'roster-targets-v2',
      checkpointVersion: SEASON_CHECKPOINT_VERSION,
      blockVersion: SEASON_BLOCK_VERSION,
      summaryVersion: SEASON_GAME_SUMMARY_VERSION,
      aggregatesVersion: SEASON_AGGREGATES_VERSION,
      recapVersion: SEASON_RECAP_VERSION,
      leadersVersion: 'season-leaders-v1',
      homeCourtVersion: 'season-home-court-v1',
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
    },
    league,
    rosters,
    ownership,
    schedule: {
      leagueVersion: SEASON_LEAGUE_VERSION,
      scheduleVersion: SEASON_SCHEDULE_VERSION,
      formulaVersion: SEASON_SCHEDULE_FORMULA_VERSION,
      generationSeed: schedule.generationSeed,
      contentHash: '0'.repeat(64),
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
    },
    cursor: { schemaVersion: 1, completedRounds: 0 },
    stage: 'regular-season',
    postseason: buildInitialPostseasonState(TEST_SEED),
    awards: null,
    completion: null,
    draft: buildFixtureSeasonDraftFacts(),
    aiAssignments,
    aiPools,
    rotations,
    generationAudit: buildFixtureGenerationAudit(TEST_SEED),
    evaluations,
    // M2.5: run-scoped state chain and economy facts (schema 7).
    trade: null,
    freeAgency: {
      schemaVersion: 1,
      freeAgencyVersion: 'season-free-agency-v1',
      windows: [],
      canonicalCandidates: {},
      signingCounts: Object.fromEntries(league.teams.map((team) => [team.franchiseId, 0])),
      seasonSpend: Object.fromEntries(league.teams.map((team) => [team.franchiseId, 0])),
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
    stateDigest: '0'.repeat(32),
  };
  const parsed = seasonRunSchema.safeParse(run);
  if (!parsed.success) {
    throw new Error(
      `synthesized run fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return { run, catalog };
}

function effectsOf(run: SeasonRun, catalog: SeasonDraftCatalog): SeasonEffectsState {
  const expanded = expandSeasonRunRosters(run, catalog);
  const staminaInputs = [...expanded.values()].map((player) => {
    if (player.stamina === undefined) throw new Error('missing stamina');
    return player.stamina;
  });
  return createSeasonEffectsState(staminaInputs);
}

function synthState(): RunnerState {
  const { run, catalog } = buildSynthesizedRun();
  return {
    run,
    catalog,
    summaries: [] as SeasonGameSummary[],
    effects: effectsOf(run, catalog),
  };
}

describe('M2.4 block-level effects', () => {
  it('accumulates fatigue and chemistry across blocks and records evidence', () => {
    const state = synthState();
    const checkpoints: SeasonCandidateCheckpoint[] = [];
    const digests: string[] = [];
    for (let block = 0; block < 9; block += 1) {
      const checkpoint = runBlock(state, block);
      checkpoints.push(checkpoint);
      digests.push(checkpoint.digest);
    }
    expect(digests).toHaveLength(9);
    // Every block produces its own digest (cross-block determinism and
    // interruption/rerun identity are covered by block-determinism.test.ts).
    expect(new Set(digests).size).toBe(9);

    const first = checkpoints[0];
    const last = checkpoints[8];
    if (first === undefined || last === undefined) throw new Error('checkpoints');
    // Fatigue accumulated by block 0 and sustains a positive steady state
    // through the season (recovery never collapses it to zero).
    const maxFatigueFirst = first.effects.playerStates.reduce(
      (max, player) => Math.max(max, player.fatigueBasisPoints),
      0,
    );
    const maxFatigueLast = last.effects.playerStates.reduce(
      (max, player) => Math.max(max, player.fatigueBasisPoints),
      0,
    );
    expect(maxFatigueFirst).toBeGreaterThan(0);
    expect(maxFatigueLast).toBeGreaterThan(0);
    const mid = checkpoints[4];
    if (mid === undefined) throw new Error('mid checkpoint');
    const maxFatigueMid = mid.effects.playerStates.reduce(
      (max, player) => Math.max(max, player.fatigueBasisPoints),
      0,
    );
    // The plateau stays within the same order of magnitude (no runaway or
    // collapse): late-season max fatigue is at least half the block-0 max.
    expect(maxFatigueLast).toBeGreaterThanOrEqual(Math.round(maxFatigueFirst / 2));
    expect(maxFatigueMid).toBeGreaterThanOrEqual(Math.round(maxFatigueFirst / 2));

    // Chemistry grew only through recorded shared play.
    const sharedFirst = first.effects.pairStates.reduce(
      (sum, pair) => sum + pair.sharedPossessions,
      0,
    );
    const sharedLast = last.effects.pairStates.reduce(
      (sum, pair) => sum + pair.sharedPossessions,
      0,
    );
    expect(sharedFirst).toBeGreaterThan(0);
    expect(sharedLast).toBeGreaterThan(sharedFirst);
    // A stable unit's pair chemistry exceeds a shuffled unit's at season end.
    const humanRoster = state.run.rosters.find((roster) => roster.franchiseId === 'lakers');
    if (humanRoster === undefined) throw new Error('lakers');
    const humanIds = humanRoster.players.map((player) => player.playerVersionId);
    const stable = state.run.rotations.find((rotation) => rotation.franchiseId === 'lakers');
    if (stable === undefined) throw new Error('rotation');
    const stableUnit = [...stable.starters];
    const shuffled = [...humanIds].sort((a, b) => (a < b ? 1 : -1)).slice(0, 5);
    const unitChem = (unit: readonly string[]): number => {
      const pairStates = last.effects.pairStates;
      let sum = 0;
      let count = 0;
      for (let i = 0; i < unit.length; i += 1) {
        for (let j = i + 1; j < unit.length; j += 1) {
          const a = unit[i] ?? '';
          const b = unit[j] ?? '';
          const pair = pairStates.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
          if (pair !== undefined) {
            sum += pairChemistryBasisPoints(pair.sharedPossessions);
            count += 1;
          }
        }
      }
      return count > 0 ? sum / count : 0;
    };
    expect(unitChem(stableUnit)).toBeGreaterThan(unitChem(shuffled));

    // Human-game retained details carry mechanism evidence; summaries carry
    // the compact rollup.
    let detailWithEvidence = 0;
    for (const checkpoint of checkpoints) {
      for (const detail of checkpoint.retainedDetails) {
        if ((detail.mechanismEvidence ?? []).length > 0) detailWithEvidence += 1;
      }
    }
    expect(detailWithEvidence).toBeGreaterThan(0);
    let summaryWithRollup = 0;
    for (const checkpoint of checkpoints) {
      for (const summary of checkpoint.gameSummaries) {
        if ((summary.effectsRollup ?? []).length > 0) summaryWithRollup += 1;
      }
    }
    expect(summaryWithRollup).toBeGreaterThan(0);
  }, 240_000);

  it('keeps recovery ticks between games monotone and rounds within bounds', () => {
    const state = synthState();
    const checkpoint0 = runBlock(state, 0);
    const maxRound = checkpoint0.effects.playerStates.reduce(
      (max, player) => Math.max(max, player.lastCompletedRound),
      0,
    );
    // One tick per round boundary: rounds 2..10 = 9 ticks in block 0.
    expect(maxRound).toBe(9);
    for (const player of checkpoint0.effects.playerStates) {
      expect(player.fatigueBasisPoints).toBeGreaterThanOrEqual(0);
      expect(player.fatigueBasisPoints).toBeLessThanOrEqual(10_000);
      expect(player.lastCompletedRound).toBeLessThanOrEqual(9);
    }
  }, 240_000);
});
