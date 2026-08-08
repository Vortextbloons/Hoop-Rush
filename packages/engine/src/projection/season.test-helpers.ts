import { buildSeasonDraftCatalog } from '@hoop-rush/test-fixtures';
import type { SeasonDraftCandidate, SimulationPlayer } from '@hoop-rush/data-contracts';

/**
 * Shared projection test fixtures: a slot-legal ten-player roster and
 * rotation built from the deterministic season draft catalog.
 */

export function candidateToPlayer(candidate: SeasonDraftCandidate): SimulationPlayer {
  return {
    playerId: candidate.playerId,
    playerVersionId: candidate.playerVersionId,
    displayName: candidate.displayName,
    positions: candidate.positions.playable,
    heightInches: candidate.heightInches,
    weightLbs: candidate.weightLbs,
    ratings: candidate.detailedRatings,
    tendencies: candidate.tendencies,
    anchors: candidate.anchors,
    reconstructedThreePoint: candidate.reconstructedThreePoint,
  };
}

export function buildInput() {
  const catalog = buildSeasonDraftCatalog({
    franchiseIds: ['lakers'],
    eras: ['2010s'],
    playersPerPool: 20,
  });
  const pool = catalog.candidates.slice(0, 20).map((candidate) => candidateToPlayer(candidate));
  // Build a slot-legal ten: 2 G, 2 F, 1 C starters and the same for the bench.
  const canPlay = (player: SimulationPlayer, group: 'G' | 'F' | 'C') =>
    group === 'G'
      ? player.positions.includes('PG') || player.positions.includes('SG')
      : group === 'F'
        ? player.positions.includes('SF') || player.positions.includes('PF')
        : player.positions.includes('C');
  const guards = pool.filter((player) => canPlay(player, 'G'));
  const forwards = pool.filter((player) => canPlay(player, 'F'));
  const centers = pool.filter((player) => canPlay(player, 'C'));
  const used = new Set<string>();
  const pick = (list: SimulationPlayer[], index: number) => {
    for (const player of list.slice(index)) {
      const id = player.playerVersionId ?? player.playerId;
      if (used.has(id)) continue;
      used.add(id);
      return player;
    }
    throw new Error('not enough unique position players in fixture');
  };
  const starters = [
    pick(guards, 0),
    pick(guards, 1),
    pick(forwards, 0),
    pick(forwards, 1),
    pick(centers, 0),
  ];
  const bench = [
    pick(guards, 2),
    pick(forwards, 2),
    pick(centers, 1),
    pick(guards, 3),
    pick(forwards, 3),
  ];
  const rotation = {
    franchiseId: 'lakers',
    starters: starters.map((player) => player.playerVersionId ?? ''),
    benchOrder: bench.map((player) => player.playerVersionId ?? ''),
    targetMinutes: [
      ...starters.map((player) => ({ playerVersionId: player.playerVersionId ?? '', minutes: 32 })),
      ...bench.map((player) => ({ playerVersionId: player.playerVersionId ?? '', minutes: 16 })),
    ],
    closingFive: starters.map((player) => player.playerVersionId ?? ''),
    rotationVersion: 'season-rotation-v2' as const,
  };
  const ten = [...starters, ...bench];
  return { catalog, players: ten, rotation };
}
