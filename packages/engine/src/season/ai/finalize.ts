import {
  SEASON_AI_VERSION,
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_TARGETS_VERSION,
  SEASON_ROTATION_VERSION,
  franchiseIdSchema,
  seasonDigestHex,
  seasonLeagueGenerationResultSchema,
  type EraSimulationProfile,
  type ProjectionModelArtifact,
  type SeasonAiAssignment,
  type SeasonAiPool,
  type SeasonDraftCatalog,
  type SeasonGenerationDiagnostics,
  type SeasonLeague,
  type SeasonLeagueGenerationResult,
  type SeasonMinutePlanSummary,
  type SeasonRosterEvaluation,
  type SeasonRosterRole,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import {
  ProjectionCache,
  projectSeasonRoster,
  searchRosterRotationCandidates,
} from '../../projection/index.ts';
import {
  buildMinutePlanCandidates,
  minutePlanHorizonGames,
  type MinutePlanPlayerInput,
} from '../minute-plan.ts';
import { buildMinimalRotation } from '../rotation.ts';
import { seasonGenerationDigest } from '../digest.ts';
import {
  ROLE_COVERAGE_THRESHOLD,
  ROSTER_ROLES,
  identityScore,
  overallReportOf,
  roleScoresOf,
  type SeasonScoreMember,
} from '../ai-scoring.ts';
import { nodeBudgetOf, reportProgress, totalRepairs } from './state.ts';
import type { GenerationState, PoolTeam } from './types.ts';

const searchCache = new ProjectionCache();
export function evaluateSeasonRoster(input: {
  franchiseId: string;
  band: SeasonAiAssignment['band'];
  identity: SeasonAiAssignment['identity'];
  members: readonly SeasonScoreMember[];
}): SeasonRosterEvaluation {
  const roleScores: Record<SeasonRosterRole, number> = {
    'primary-creation': 0,
    'secondary-creation': 0,
    'perimeter-shooting': 0,
    'rim-finishing-interior-scoring': 0,
    'perimeter-defense': 0,
    'interior-defense': 0,
    'offensive-rebounding': 0,
    'defensive-rebounding': 0,
  };
  for (const member of input.members) {
    const scores = roleScoresOf(member);
    for (const role of ROSTER_ROLES) {
      roleScores[role] = Math.max(roleScores[role], scores[role]);
    }
  }
  const rolesCovered = ROSTER_ROLES.filter((role) => roleScores[role] >= ROLE_COVERAGE_THRESHOLD);
  return {
    franchiseId: franchiseIdSchema.parse(input.franchiseId),
    band: input.band,
    identity: input.identity,
    strengthScore: identityScore(roleScores, input.identity),
    roleScores,
    rolesCovered,
    overallReport: overallReportOf(input.members),
  };
}
export function attachAiProjectionSummaries(input: {
  generation: SeasonLeagueGenerationResult;
  catalog: SeasonDraftCatalog;
  eraProfile: EraSimulationProfile;
  model: ProjectionModelArtifact;
  seed: string;
}): SeasonLeagueGenerationResult {
  const { generation, catalog, eraProfile, model, seed } = input;
  const byId = new Map(
    generation.rosters.map((roster) => [
      roster.franchiseId,
      roster.players.map((entry) => entry.playerVersionId),
    ]),
  );
  const rotationById = new Map(
    generation.rotations.map((rotation) => [rotation.franchiseId, rotation]),
  );
  const playerById = new Map(
    catalog.candidates.map((candidate) => [
      candidate.playerVersionId,
      {
        playerId: candidate.playerId,
        playerVersionId: candidate.playerVersionId,
        displayName: candidate.displayName,
        positions: candidate.positions.playable,
        heightInches: candidate.heightInches,
        weightLbs: candidate.weightLbs,
        ratings: candidate.detailedRatings,
        tendencies: candidate.tendencies,
        ...(candidate.anchors !== undefined ? { anchors: candidate.anchors } : {}),
        ...(candidate.reconstructedThreePoint !== undefined
          ? { reconstructedThreePoint: candidate.reconstructedThreePoint }
          : {}),
      } satisfies SimulationPlayer,
    ]),
  );
  const evaluations = generation.evaluations.map((evaluation) => {
    const pool = generation.aiPools.find(
      (candidate) => candidate.franchiseId === evaluation.franchiseId,
    );
    if (pool === undefined) return evaluation;
    const search = searchRosterRotationCandidates({
      catalog,
      locked: [],
      available: pool.playerVersionIds,
      seed: seasonDigestHex(`${seed}\u0000ai-projection\u0000${evaluation.franchiseId}`),
      eraProfile,
      model,
      caps: { completeCandidates: 8, rotationsPerRoster: 8 },
    });
    const selected = byId.get(evaluation.franchiseId) ?? [];
    const rotation = rotationById.get(evaluation.franchiseId);
    let selectedNetRating = 0;
    if (rotation !== undefined) {
      try {
        const selectedPlayers: SimulationPlayer[] = [];
        for (const id of selected) {
          const player = playerById.get(id);
          if (player !== undefined) selectedPlayers.push(player);
        }
        if (selectedPlayers.length === 10) {
          const projection = projectSeasonRoster(
            {
              roster: selectedPlayers.map((player) => ({ player })),
              rotation,
              eraProfile,
              model,
            },
            { cache: searchCache },
          );
          selectedNetRating = projection.metrics.netRating;
        }
      } catch {
        selectedNetRating = 0;
      }
    }
    const best = search.ranked[0];
    const bestIds =
      best === undefined ? null : best.projection.minutes.map((row) => row.playerVersionId);
    const selectedKey = [...selected].sort().join(',');
    const bestKey = bestIds === null ? null : [...bestIds].sort().join(',');
    const selectedIsBest = selectedKey !== '' && bestKey !== null && selectedKey === bestKey;
    const searchDigest = seasonDigestHex(
      JSON.stringify({
        seed: search.audit.seed,
        lens: search.audit.lens,
        rotationsEvaluated: search.audit.rotationsEvaluated,
        nodeCount: search.audit.nodeCount,
        selected: selectedKey,
        best: bestKey,
      }),
    );
    return {
      ...evaluation,
      projectionSummary: {
        modelVersion: model.modelVersion,
        selectedNetRating,
        bestNetRating: best?.projection.metrics.netRating ?? null,
        selectedIsBest,
        searchDigest,
      },
    };
  });
  return { ...generation, evaluations };
}
export function toSeasonAiPool(state: GenerationState, team: PoolTeam): SeasonAiPool {
  const selections = [...(team.selections ?? [])].sort();
  return {
    franchiseId: franchiseIdSchema.parse(team.franchiseId),
    band: team.band,
    identity: team.identity,
    playerVersionIds: [...team.pool].sort(),
    anchors: [...team.anchors].sort((a, b) => (a.playerVersionId < b.playerVersionId ? -1 : 1)),
    selections,
    allocationSeedPaths: selections.map(
      (versionId) => team.memberPaths.get(versionId) ?? ['ai-rosters', team.franchiseId],
    ),
    repairCount: team.repairCount,
  };
}
export function qualityWeightsFromRatings(
  members: readonly {
    playerVersionId: string;
    detailedRatings: Record<string, number>;
  }[],
): ReadonlyMap<string, number> {
  const means = new Map<string, number>();
  let maxMean = 0;
  for (const member of members) {
    const ratings = Object.values(member.detailedRatings);
    const mean = ratings.reduce((sum, value) => sum + value, 0) / Math.max(1, ratings.length);
    means.set(member.playerVersionId, mean);
    maxMean = Math.max(maxMean, mean);
  }
  if (maxMean <= 0) {
    return new Map(members.map((member) => [member.playerVersionId, 0.5]));
  }
  return new Map(
    members.map((member) => [
      member.playerVersionId,
      Math.min(1, Math.max(0, (means.get(member.playerVersionId) ?? 0) / maxMean)),
    ]),
  );
}
export function finalizeResult(
  state: GenerationState,
  league: SeasonLeague,
  humanRosters: readonly {
    franchiseId: string;
    playerVersionIds: string[];
  }[],
): SeasonLeagueGenerationResult {
  const rosters = league.teams.map((team) => {
    const aiTeam = state.teams.get(team.franchiseId);
    const ids =
      aiTeam?.selections ??
      humanRosters.find((r) => r.franchiseId === team.franchiseId)?.playerVersionIds;
    if (!ids) throw new Error(`no roster resolved for ${team.franchiseId}`);
    const players = ids.map((playerVersionId) => {
      const candidate = state.byId.get(playerVersionId);
      if (!candidate) throw new Error(`missing candidate ${playerVersionId}`);
      return {
        playerVersionId,
        playerId: candidate.playerId,
        franchiseId: candidate.franchiseId,
        eraId: candidate.eraId,
        seasonKey: candidate.seasonKey,
        displayName: candidate.displayName,
      };
    });
    return { franchiseId: team.franchiseId, players };
  });
  const ownership = rosters.flatMap((roster) =>
    roster.players.map((player) => ({
      playerVersionId: player.playerVersionId,
      ownerFranchiseId: roster.franchiseId,
    })),
  );
  const talentByVersion = new Map<string, number>();
  for (const candidate of state.canonicalCandidates) {
    const ratings = Object.values(candidate.detailedRatings);
    talentByVersion.set(
      candidate.playerVersionId,
      ratings.reduce((sum, value) => sum + value, 0) / Math.max(1, ratings.length),
    );
  }
  const rotations = rosters.map((roster, index) => {
    const members = roster.players.map((player) => {
      const candidate = state.byId.get(player.playerVersionId);
      if (!candidate) throw new Error(`missing candidate ${player.playerVersionId}`);
      return { playerVersionId: player.playerVersionId, playable: candidate.positions.playable };
    });
    const rotation = buildMinimalRotation({
      franchiseId: roster.franchiseId,
      members,
      order: (a, b) =>
        (talentByVersion.get(b.playerVersionId) ?? 0) -
        (talentByVersion.get(a.playerVersionId) ?? 0),
    });
    reportProgress(state, { phase: 'rotations', completed: index + 1, total: rosters.length });
    return rotation;
  });
  const rotationByFranchise = new Map(
    rotations.map((rotation) => [rotation.franchiseId, rotation]),
  );
  const minutePlanByFranchise = new Map<string, SeasonMinutePlanSummary>();
  const plannedRotations = rosters.map((roster) => {
    const base = rotationByFranchise.get(roster.franchiseId);
    if (base === undefined) throw new Error(`missing rotation for ${roster.franchiseId}`);
    const members = roster.players.map((player) => {
      const candidate = state.byId.get(player.playerVersionId);
      if (!candidate) throw new Error(`missing candidate ${player.playerVersionId}`);
      return {
        playerVersionId: player.playerVersionId,
        playable: candidate.positions.playable,
        detailedRatings: candidate.detailedRatings,
        staminaRating: candidate.stamina.rating,
        durability: candidate.durability.rating,
      };
    });
    try {
      const quality = qualityWeightsFromRatings(members);
      const horizon = minutePlanHorizonGames(82);
      const players = new Map<string, MinutePlanPlayerInput>(
        members.map((member) => [
          member.playerVersionId,
          {
            playerVersionId: member.playerVersionId,
            quality: quality.get(member.playerVersionId) ?? 0.5,
            staminaRating: member.staminaRating,
            durability: member.durability,
            fatigueBasisPoints: 0,
            recentLoadBasisPoints: 0,
          },
        ]),
      );
      const { plans, recommended } = buildMinutePlanCandidates({
        structure: {
          starters: base.starters,
          benchOrder: base.benchOrder,
          closingFive: base.closingFive,
        },
        players,
        horizon,
      });
      const plan = plans.find((candidate) => candidate.strategy === recommended);
      if (plan === undefined) throw new Error('no recommended minute plan');
      minutePlanByFranchise.set(roster.franchiseId, {
        policyVersion: SEASON_MINUTE_POLICY_VERSION,
        strategy: plan.strategy,
        riskAdjustedScore: plan.riskScore,
        quality: plan.quality,
        maxStarterStrainBasisPoints: plan.maxStarterStrainBasisPoints,
        starterStrainBand: plan.strainBand,
        benchRelief: plan.relief,
        fatigueBands: plan.fatigueBands,
        horizonGames: horizon,
        heavyStrain: plan.heavyStrain,
      });
      return { ...plan.rotation, franchiseId: roster.franchiseId };
    } catch {
      return base;
    }
  });
  const aiAssignments = [...state.assignments.values()];
  const evaluations = rosters.map((roster) => {
    const assignment = state.assignments.get(roster.franchiseId);
    const members = roster.players.map((player) => {
      const candidate = state.byId.get(player.playerVersionId);
      if (!candidate) throw new Error(`missing candidate ${player.playerVersionId}`);
      return {
        playable: candidate.positions.playable,
        detailedRatings: candidate.detailedRatings,
        tendencies: candidate.tendencies,
        overall: candidate.summaryRatings.overallRating,
      };
    });
    const minutePlanSummary = minutePlanByFranchise.get(roster.franchiseId);
    return {
      ...evaluateSeasonRoster({
        franchiseId: roster.franchiseId,
        band: assignment?.band ?? 'average',
        identity: assignment?.identity ?? 'continuity',
        members,
      }),
      ...(minutePlanSummary !== undefined ? { minutePlanSummary } : {}),
    };
  });
  const aiPools = state.teamOrder.map((teamId) => {
    const team = state.teams.get(teamId);
    if (team === undefined) throw new Error(`missing AI team ${teamId}`);
    return toSeasonAiPool(state, team);
  });
  const diagnostics: SeasonGenerationDiagnostics = {
    seed: state.seed,
    aiVersion: SEASON_AI_VERSION,
    rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
    teamsGenerated: state.teamOrder.length,
    teamsRepaired: totalRepairs(state),
    backtracks: state.backtracks,
    nodesVisited: state.nodes,
    nodeBudget: nodeBudgetOf(state.targets),
    failedTeams: [],
    unmetConstraints: [],
  };
  const digest = seasonGenerationDigest({
    seed: state.seed,
    aiVersion: SEASON_AI_VERSION,
    rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
    rotationVersion: SEASON_ROTATION_VERSION,
    rosters,
    ownership,
    rotations: plannedRotations,
    aiAssignments,
    targetsVersion: SEASON_ROSTER_TARGETS_VERSION,
    aiPools,
    diagnostics,
  });
  const result: SeasonLeagueGenerationResult = {
    schemaVersion: 2,
    seed: state.seed,
    aiVersion: SEASON_AI_VERSION,
    rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
    rotationVersion: SEASON_ROTATION_VERSION,
    rosters,
    ownership,
    rotations: plannedRotations,
    aiAssignments,
    evaluations,
    aiPools,
    diagnostics,
    digest,
  };
  return seasonLeagueGenerationResultSchema.parse(result);
}
