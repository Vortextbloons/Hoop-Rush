import type {
  SeasonAiIdentity,
  SeasonDraftCatalog,
  SeasonLeague,
  SeasonRosterCalibrationRun,
  SeasonRosterTargets,
  SeasonStrengthBand,
  Seed,
} from '@hoop-rush/data-contracts';
import { generateAiLeague } from './generation.ts';
import { SeasonAiGenerationError } from './state.ts';

export interface SeasonRosterCalibrationRunV2 extends SeasonRosterCalibrationRun {
  superTeamIncidence: string[];
  poolFacts: Array<{
    franchiseId: string;
    band: SeasonStrengthBand;
    identity: SeasonAiIdentity;
    anchorCount: number;
    extraEliteFlags: number;
    poolLegalityFailures: string[];
    selectionFailures: string[];
  }>;
}
export function runSeasonRosterCalibrationSeeds(input: {
  seeds: readonly Seed[];
  catalog: SeasonDraftCatalog;
  league: SeasonLeague;
  humanRosters: ReadonlyArray<{
    franchiseId: string;
    playerVersionIds: string[];
  }>;
  targets: SeasonRosterTargets;
}): SeasonRosterCalibrationRunV2[] {
  return input.seeds.map((seed) => {
    let generation: ReturnType<typeof generateAiLeague>;
    try {
      generation = generateAiLeague({
        seed,
        catalog: input.catalog,
        league: input.league,
        humanFranchiseIds: input.humanRosters.map((roster) => roster.franchiseId),
        humanRosters: input.humanRosters,
        targets: input.targets,
      });
    } catch (error) {
      if (error instanceof SeasonAiGenerationError) {
        return {
          seed,
          teams: [],
          pools: [],
          repairs: error.repairs,
          backtracks: error.diagnostics.backtracks,
          nodesVisited: error.diagnostics.nodesVisited,
          failed: true,
          diagnostics: error.diagnostics,
          superTeamIncidence: [],
          poolFacts: [],
        };
      }
      throw error;
    }
    const contenderScores = generation.evaluations
      .filter((evaluation) => evaluation.band === 'contender')
      .map((evaluation) => evaluation.strengthScore)
      .sort((a, b) => a - b);
    const contenderMedian = contenderScores[Math.floor(contenderScores.length / 2)] ?? 0;
    const superTeamIncidence = generation.evaluations
      .filter(
        (evaluation) =>
          (evaluation.band === 'average' || evaluation.band === 'weaker') &&
          evaluation.strengthScore > contenderMedian,
      )
      .map((evaluation) => evaluation.franchiseId);
    return {
      seed,
      teams: generation.evaluations.map((evaluation) => ({
        franchiseId: evaluation.franchiseId,
        band: evaluation.band,
        identity: evaluation.identity,
        strengthScore: evaluation.strengthScore,
        rolesCovered: evaluation.rolesCovered.length,
        roleIds: evaluation.rolesCovered,
      })),
      pools: generation.aiPools,
      repairs: generation.diagnostics.teamsRepaired,
      backtracks: generation.diagnostics.backtracks,
      nodesVisited: generation.diagnostics.nodesVisited,
      failed: false,
      diagnostics: null,
      superTeamIncidence,
      poolFacts: generation.aiPools.map((pool) => ({
        franchiseId: pool.franchiseId,
        band: pool.band,
        identity: pool.identity,
        anchorCount: pool.anchors.length,
        extraEliteFlags: pool.anchors.some((anchor) => anchor.seedPath.includes('extra-elite'))
          ? 1
          : 0,
        poolLegalityFailures: [],
        selectionFailures: [],
      })),
    };
  });
}
