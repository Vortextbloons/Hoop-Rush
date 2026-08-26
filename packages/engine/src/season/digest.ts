import { seasonDigestHex, type SeasonAiAssignment, type SeasonAiPool, type SeasonGenerationDiagnostics, type SeasonOwnership, type SeasonRoster, type SeasonRotation, } from '@hoop-rush/data-contracts';
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
function rosterCanonical(rosters: readonly SeasonRoster[]): unknown[] {
    return [...rosters]
        .sort((a, b) => (a.franchiseId < b.franchiseId ? -1 : 1))
        .map((roster) => ({
        franchiseId: roster.franchiseId,
        players: roster.players.map((player) => player.playerVersionId).sort(),
    }));
}
function rotationCanonical(rotations: readonly SeasonRotation[]): unknown[] {
    return [...rotations]
        .sort((a, b) => (a.franchiseId < b.franchiseId ? -1 : 1))
        .map((rotation) => ({
        franchiseId: rotation.franchiseId,
        starters: rotation.starters,
        benchOrder: rotation.benchOrder,
        targetMinutes: [...rotation.targetMinutes].sort((a, b) => a.playerVersionId < b.playerVersionId ? -1 : 1),
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
        failedTeams: [...diagnostics.failedTeams].sort(),
        unmetConstraints: [...diagnostics.unmetConstraints].sort(),
    };
}
function aiPoolsCanonical(pools: readonly SeasonAiPool[]): unknown[] {
    return [...pools]
        .sort((a, b) => (a.franchiseId < b.franchiseId ? -1 : 1))
        .map((pool) => ({
        franchiseId: pool.franchiseId,
        band: pool.band,
        identity: pool.identity,
        playerVersionIds: [...pool.playerVersionIds].sort(),
        anchors: [...pool.anchors]
            .sort((a, b) => (a.playerVersionId < b.playerVersionId ? -1 : 1))
            .map((anchor) => ({
            playerVersionId: anchor.playerVersionId,
            qualifyingRole: anchor.qualifyingRole,
            percentileTier: anchor.percentileTier,
            roleScore: anchor.roleScore,
            percentileThreshold: anchor.percentileThreshold,
            seedPath: anchor.seedPath,
        })),
        selections: [...pool.selections].sort(),
        allocationSeedPaths: [...pool.allocationSeedPaths].sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1),
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
        ownership: [...input.ownership].sort((a, b) => a.playerVersionId < b.playerVersionId ? -1 : 1),
        rotations: rotationCanonical(input.rotations),
        aiAssignments: [...input.aiAssignments].sort((a, b) => a.franchiseId < b.franchiseId ? -1 : 1),
        aiPools: aiPoolsCanonical(input.aiPools),
        diagnostics: diagnosticsCanonical(input.diagnostics),
    });
    return seasonDigestHex(canonical);
}
