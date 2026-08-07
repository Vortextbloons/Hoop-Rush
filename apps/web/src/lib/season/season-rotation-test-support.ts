import type { Position, SeasonRotation } from '@hoop-rush/data-contracts';
import { buildMinimalRotation } from '@hoop-rush/engine';
import { buildSeasonDraftCatalog } from '@hoop-rush/test-fixtures';
import type { RotationMember } from './season-rotation-editor';

/**
 * Shared RotationEditor fixtures (season-rotation-editor.test.ts + the
 * RotationEditor component test): the fixture catalog, its ten candidates,
 * the member rows, and an engine-built legal rotation. One copy avoids
 * drift between the pure editor suite and the component wiring suite.
 */

const CATALOG = buildSeasonDraftCatalog({
  franchiseIds: ['lakers'],
  eras: ['1990s'],
  playersPerPool: 10,
});
const POOL = CATALOG.pools[0];
if (POOL === undefined) {
  throw new Error('fixture catalog has no pool');
}

export const CANDIDATES = POOL.playerVersionIds.map((id) => {
  const candidate = CATALOG.candidates.find((c) => c.playerVersionId === id);
  if (candidate === undefined) {
    throw new Error(`fixture catalog misses candidate ${id}`);
  }
  return candidate;
});

export function rotationMembers(): RotationMember[] {
  return CANDIDATES.map((candidate) => ({
    playerVersionId: candidate.playerVersionId,
    displayName: candidate.displayName,
    playable: candidate.positions.playable,
  }));
}

export function rotationPlayableOf(playerVersionId: string): readonly Position[] {
  const candidate = CANDIDATES.find((c) => c.playerVersionId === playerVersionId);
  if (candidate === undefined) {
    throw new Error(`fixture catalog misses candidate ${playerVersionId}`);
  }
  return candidate.positions.playable;
}

/** Legal rotation over the ten fixture candidates (engine-built). */
export function legalRotation(): SeasonRotation {
  return buildMinimalRotation({
    franchiseId: 'lakers',
    members: rotationMembers().map((member) => ({
      playerVersionId: member.playerVersionId,
      playable: member.playable,
    })),
  });
}
