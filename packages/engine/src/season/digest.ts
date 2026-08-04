import {
  seasonDigestHex,
  type SeasonAiAssignment,
  type SeasonOwnership,
  type SeasonRoster,
  type SeasonRotation,
} from '@hoop-rush/data-contracts';

/**
 * Canonical Season Run generation digests (spec/2.0/07, M2.1). The digest is
 * a pure function of the result's recorded facts: rosters, ownership rows,
 * rotations, AI assignments, and the material versions. Every serialization
 * step sorts canonically so call order, worker counts, and unrelated draws
 * can never change the digest.
 */

export interface SeasonGenerationDigestInput {
  seed: string;
  aiVersion: string;
  rosterGenerationVersion: string;
  rotationVersion: string;
  rosters: readonly SeasonRoster[];
  ownership: readonly SeasonOwnership[];
  rotations: readonly SeasonRotation[];
  aiAssignments: readonly SeasonAiAssignment[];
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
      targetMinutes: [...rotation.targetMinutes].sort((a, b) =>
        a.playerVersionId < b.playerVersionId ? -1 : 1,
      ),
      closingFive: rotation.closingFive,
    }));
}

/** Canonical digest of a league generation result. */
export function seasonGenerationDigest(input: SeasonGenerationDigestInput): string {
  const canonical = JSON.stringify({
    seed: input.seed,
    aiVersion: input.aiVersion,
    rosterGenerationVersion: input.rosterGenerationVersion,
    rotationVersion: input.rotationVersion,
    rosters: rosterCanonical(input.rosters),
    ownership: [...input.ownership].sort((a, b) =>
      a.playerVersionId < b.playerVersionId ? -1 : 1,
    ),
    rotations: rotationCanonical(input.rotations),
    aiAssignments: [...input.aiAssignments].sort((a, b) =>
      a.franchiseId < b.franchiseId ? -1 : 1,
    ),
  });
  return seasonDigestHex(canonical);
}
