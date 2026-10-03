import {
  seasonDigestHex,
  type SeasonAiAssignment,
  type SeasonAiPool,
  type SeasonGenerationDiagnostics,
  type SeasonOwnership,
  type SeasonRoster,
  type SeasonRotation,
} from '@hoop-rush/data-contracts';
export interface SeasonGenerationDigestInput {
  seed: string;
  aiVersion: string;
  rosterGenerationVersion: string;
  rotationVersion: string;
  rosters: readonly SeasonRoster[];
  ownership: readonly SeasonOwnership[];
  rotations: readonly SeasonRotation[];
  aiAssignments: readonly SeasonAiAssignment[];
  targetsVersion: string;
  aiPools: readonly SeasonAiPool[];
  diagnostics: SeasonGenerationDiagnostics;
}
import { sortedBy, sortedStrings } from './canonical.ts';
function rosterCanonical(rosters: readonly SeasonRoster[]): unknown[] {
  return sortedBy(rosters, (roster) => roster.franchiseId).map((roster) => ({
    franchiseId: roster.franchiseId,
    players: sortedStrings(roster.players.map((player) => player.playerVersionId)),
  }));
}
function rotationCanonical(rotations: readonly SeasonRotation[]): unknown[] {
  return sortedBy(rotations, (rotation) => rotation.franchiseId).map((rotation) => ({
    franchiseId: rotation.franchiseId,
    starters: rotation.starters,
    benchOrder: rotation.benchOrder,
    targetMinutes: sortedBy(rotation.targetMinutes, (entry) => entry.playerVersionId),
    closingFive: rotation.closingFive,
  }));
}
function diagnosticsCanonical(diagnostics: SeasonGenerationDiagnostics): unknown {
  return {
    seed: diagnostics.seed,
    aiVersion: diagnostics.aiVersion,
    rosterGenerationVersion: diagnostics.rosterGenerationVersion,
    teamsGenerated: diagnostics.teamsGenerated,
    teamsRepaired: diagnostics.teamsRepaired,
    backtracks: diagnostics.backtracks,
    nodesVisited: diagnostics.nodesVisited,
    nodeBudget: diagnostics.nodeBudget,
    failedTeams: sortedStrings(diagnostics.failedTeams),
    unmetConstraints: sortedStrings(diagnostics.unmetConstraints),
  };
}
function aiPoolsCanonical(pools: readonly SeasonAiPool[]): unknown[] {
  return sortedBy(pools, (pool) => pool.franchiseId).map((pool) => ({
      franchiseId: pool.franchiseId,
      band: pool.band,
      identity: pool.identity,
      playerVersionIds: sortedStrings(pool.playerVersionIds),
      anchors: sortedBy(pool.anchors, (anchor) => anchor.playerVersionId).map((anchor) => ({
          playerVersionId: anchor.playerVersionId,
          qualifyingRole: anchor.qualifyingRole,
          percentileTier: anchor.percentileTier,
          roleScore: anchor.roleScore,
          percentileThreshold: anchor.percentileThreshold,
          seedPath: anchor.seedPath,
        })),
      selections: sortedStrings(pool.selections),
      allocationSeedPaths: [...pool.allocationSeedPaths].sort((a, b) =>
        JSON.stringify(a) < JSON.stringify(b) ? -1 : 1,
      ),
      repairCount: pool.repairCount,
    }));
}
export function seasonGenerationDigest(input: SeasonGenerationDigestInput): string {
  const canonical = JSON.stringify({
    seed: input.seed,
    aiVersion: input.aiVersion,
    rosterGenerationVersion: input.rosterGenerationVersion,
    rotationVersion: input.rotationVersion,
    targetsVersion: input.targetsVersion,
    rosters: rosterCanonical(input.rosters),
    ownership: sortedBy(input.ownership, (row) => row.playerVersionId),
    rotations: rotationCanonical(input.rotations),
    aiAssignments: sortedBy(input.aiAssignments, (row) => row.franchiseId),
    aiPools: aiPoolsCanonical(input.aiPools),
    diagnostics: diagnosticsCanonical(input.diagnostics),
  });
  return seasonDigestHex(canonical);
}
