import { parentPort, workerData } from 'node:worker_threads';
import { readJson } from '../io.ts';
import {
  SeasonAiGenerationError,
  completionTargetsMet,
  generateAiLeague,
  validateSeasonRoster,
} from '@hoop-rush/engine';
import {
  seasonDraftCatalogSchema,
  seasonLeagueSchema,
  seedSchema,
  type Seed,
  type SeasonDraftCatalog,
  type SeasonLeague,
  type SeasonRosterTargets,
  type SeasonStrengthBand,
} from '@hoop-rush/data-contracts';
import { poolLegalFailuresOf, roleTierThresholdsOf, tierOfPool } from './season-data.ts';
export interface RosterCalibrationWorkerRun {
  seed: Seed;
  teams: Array<{
    franchiseId: string;
    band: SeasonStrengthBand;
    identity: string;
    strengthScore: number;
    rolesCovered: number;
    roleIds: string[];
  }>;
  repairs: number;
  backtracks: number;
  nodesVisited: number;
  failed: boolean;
  digest: string;
  poolFailures: string[];
  selectionFailures: string[];
  anchorsTotal: number;
  extraEliteTeams: number;
  guaranteedAnchorShortfall: number;
  tierCounts: Record<
    SeasonStrengthBand,
    {
      elite: number;
      strong: number;
      useful: number;
      total: number;
    }
  >;
}
interface WorkerInput {
  catalogPath: string;
  leaguePath: string;
  seeds: string[];
  humanRosters: Array<{
    franchiseId: string;
    playerVersionIds: string[];
  }>;
  targets: SeasonRosterTargets;
  variant: 'roster' | 'order-invariance';
}
type WorkerOutput =
  | {
      runs: RosterCalibrationWorkerRun[];
    }
  | {
      orderInvariance: Array<{
        seed: Seed;
        digests: string[];
      }>;
    };
function selectionFailuresOf(
  catalog: SeasonDraftCatalog,
  league: SeasonLeague,
  rosterIds: Map<string, string[]>,
  humanFranchiseIds: readonly string[],
): string[] {
  const failures: string[] = [];
  const byId = new Map(catalog.candidates.map((c) => [c.playerVersionId, c]));
  for (const team of league.teams) {
    if (humanFranchiseIds.includes(team.franchiseId)) continue;
    const ids = rosterIds.get(team.franchiseId);
    if (ids === undefined) {
      failures.push(`${team.franchiseId}: no generated roster`);
      continue;
    }
    const members = ids.map((playerVersionId) => {
      const candidate = byId.get(playerVersionId);
      if (candidate === undefined) {
        throw new Error(`catalog is missing roster version ${playerVersionId}`);
      }
      return { playerVersionId, playable: candidate.positions.playable };
    });
    const legality = validateSeasonRoster(members);
    if (legality.length > 0) failures.push(`${team.franchiseId}: ${legality.join('; ')}`);
    if (!completionTargetsMet(members)) {
      failures.push(`${team.franchiseId}: completion target (4/4/3) missed`);
    }
  }
  return failures;
}
function rosterOf(generation: {
  rosters: Array<{
    franchiseId: string;
    players: Array<{
      playerVersionId: string;
    }>;
  }>;
}): Map<string, string[]> {
  const rosterIds = new Map<string, string[]>();
  for (const roster of generation.rosters) {
    rosterIds.set(
      roster.franchiseId,
      roster.players.map((player) => player.playerVersionId),
    );
  }
  return rosterIds;
}
function runRosterSeeds(input: WorkerInput): RosterCalibrationWorkerRun[] {
  const catalog = seasonDraftCatalogSchema.parse(readJson(input.catalogPath));
  const league = seasonLeagueSchema.parse(readJson(input.leaguePath));
  const humanFranchiseIds = input.humanRosters.map((roster) => roster.franchiseId);
  const humanVersionIds = new Set(input.humanRosters.flatMap((roster) => roster.playerVersionIds));
  const thresholds = roleTierThresholdsOf(catalog, humanVersionIds);
  return input.seeds.map((rawSeed) => {
    const seed = seedSchema.parse(rawSeed);
    let generation: ReturnType<typeof generateAiLeague>;
    try {
      generation = generateAiLeague({
        seed,
        catalog,
        league,
        humanFranchiseIds,
        humanRosters: input.humanRosters,
        targets: input.targets,
      });
    } catch (error) {
      if (error instanceof SeasonAiGenerationError) {
        return {
          seed,
          teams: [],
          repairs: 0,
          backtracks: error.diagnostics.backtracks,
          nodesVisited: error.diagnostics.nodesVisited,
          failed: true,
          digest: '',
          poolFailures: [],
          selectionFailures: [],
          anchorsTotal: 0,
          extraEliteTeams: 0,
          guaranteedAnchorShortfall: 0,
          tierCounts: emptyTierCounts(),
        };
      }
      throw error;
    }
    const poolFailures: string[] = [];
    let anchorsTotal = 0;
    let extraEliteTeams = 0;
    let guaranteedAnchorShortfall = 0;
    const tierCounts = emptyTierCounts();
    const seenVersions = new Map<string, string>();
    for (const pool of generation.aiPools) {
      poolFailures.push(...poolLegalFailuresOf(pool, thresholds, catalog, input.targets));
      anchorsTotal += pool.anchors.length;
      const guaranteed = input.targets.policy.guaranteedAnchors[pool.band];
      guaranteedAnchorShortfall += Math.max(0, guaranteed - pool.anchors.length);
      if (pool.anchors.length > guaranteed) extraEliteTeams += 1;
      const tier = tierOfPool(pool, thresholds, catalog);
      const bandCounts = tierCounts[pool.band];
      bandCounts.total += 1;
      if (tier === 'elite') bandCounts.elite += 1;
      else if (tier === 'strong') bandCounts.strong += 1;
      else if (tier === 'useful') bandCounts.useful += 1;
      for (const versionId of pool.playerVersionIds) {
        const owner = seenVersions.get(versionId);
        if (owner !== undefined) {
          poolFailures.push(
            `exclusivity: ${versionId} appears in pools ${owner} and ${pool.franchiseId}`,
          );
        } else {
          seenVersions.set(versionId, pool.franchiseId);
        }
      }
    }
    const rosterIds = rosterOf(generation);
    const selectionFailures = selectionFailuresOf(catalog, league, rosterIds, humanFranchiseIds);
    return {
      seed,
      teams: generation.evaluations.map((evaluation) => ({
        franchiseId: evaluation.franchiseId,
        band: evaluation.band,
        identity: evaluation.identity,
        strengthScore: evaluation.strengthScore,
        rolesCovered: evaluation.rolesCovered.length,
        roleIds: [...evaluation.rolesCovered],
      })),
      repairs: generation.diagnostics.teamsRepaired,
      backtracks: generation.diagnostics.backtracks,
      nodesVisited: generation.diagnostics.nodesVisited,
      failed: false,
      digest: generation.digest,
      poolFailures,
      selectionFailures,
      anchorsTotal,
      extraEliteTeams,
      guaranteedAnchorShortfall,
      tierCounts,
    };
  });
}
function runOrderInvarianceSeeds(input: WorkerInput): Array<{
  seed: Seed;
  digests: string[];
}> {
  const catalog = seasonDraftCatalogSchema.parse(readJson(input.catalogPath));
  const league = seasonLeagueSchema.parse(readJson(input.leaguePath));
  const humanFranchiseIds = input.humanRosters.map((roster) => roster.franchiseId);
  const variants = [
    league,
    { ...league, teams: [...league.teams].reverse() },
    { ...league, teams: [...league.teams.slice(15), ...league.teams.slice(0, 15)] },
  ];
  return input.seeds.map((rawSeed) => {
    const seed = seedSchema.parse(rawSeed);
    const digests: string[] = [];
    for (const variant of variants) {
      try {
        const generation = generateAiLeague({
          seed,
          catalog,
          league: variant,
          humanFranchiseIds,
          humanRosters: input.humanRosters,
          targets: input.targets,
        });
        digests.push(generation.digest);
      } catch (error) {
        if (error instanceof SeasonAiGenerationError) {
          digests.push(`failed:${seed}`);
        } else {
          throw error;
        }
      }
    }
    return { seed, digests };
  });
}
function emptyTierCounts(): RosterCalibrationWorkerRun['tierCounts'] {
  return {
    contender: { elite: 0, strong: 0, useful: 0, total: 0 },
    playoff: { elite: 0, strong: 0, useful: 0, total: 0 },
    average: { elite: 0, strong: 0, useful: 0, total: 0 },
    weaker: { elite: 0, strong: 0, useful: 0, total: 0 },
  };
}
function main(): void {
  const input = workerData as WorkerInput;
  const output: WorkerOutput =
    input.variant === 'order-invariance'
      ? { orderInvariance: runOrderInvarianceSeeds(input) }
      : { runs: runRosterSeeds(input) };
  parentPort?.postMessage(output);
}
main();
