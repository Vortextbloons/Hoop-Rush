import { buildSeasonDraftCatalog } from '@hoop-rush/test-fixtures';
import {
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_ROTATION_VERSION,
  franchiseIdSchema,
  type Position,
  type SeasonDraftCandidate,
  type SeasonRotation,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
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
  const byPosition = (position: Position) =>
    pool.filter((player) => player.positions.includes(position));
  const pgs = byPosition('PG');
  const sgs = byPosition('SG');
  const sfs = byPosition('SF');
  const pfs = byPosition('PF');
  const centers = byPosition('C');
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
  const starters = [pick(pgs, 0), pick(sgs, 0), pick(sfs, 0), pick(pfs, 0), pick(centers, 0)];
  const bench = [pick(pgs, 1), pick(sfs, 1), pick(centers, 1), pick(sgs, 1), pick(pfs, 1)];
  const rotation: SeasonRotation = {
    franchiseId: franchiseIdSchema.parse('lakers'),
    starters: starters.map((player) => player.playerVersionId ?? ''),
    benchOrder: bench.map((player) => player.playerVersionId ?? ''),
    targetMinutes: [
      ...starters.map((player) => ({ playerVersionId: player.playerVersionId ?? '', minutes: 32 })),
      ...bench.map((player) => ({ playerVersionId: player.playerVersionId ?? '', minutes: 16 })),
    ],
    closingFive: starters.map((player) => player.playerVersionId ?? ''),
    minutePolicy: { policyVersion: SEASON_MINUTE_POLICY_VERSION, strategy: 'balanced' },
    rotationVersion: SEASON_ROTATION_VERSION,
  };
  const ten = [...starters, ...bench];
  return { catalog, players: ten, rotation };
}
