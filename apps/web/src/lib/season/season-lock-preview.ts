import {
  SEASON_BLOCK_TEAM_GAMES,
  SEASON_FINAL_BLOCK_TEAM_GAMES,
  blockRoundRange,
  type SeasonGame,
  type SeasonRotation,
  type SeasonUpcomingHumanGame,
} from '@hoop-rush/data-contracts';
import { rotationRoleOf } from './season-rotation-editor';
import { seasonRotationSetDigest } from './season-rotation-digest';

/**
 * "What changed?" lock preview (spec/2.0/11 block lock preview, M2.3).
 * Before submitting a block the hub compares the pending rotation state with
 * the last accepted checkpoint: a set-level digest comparison (authoritative:
 * the checkpoint stores only the 32-hex rotation-set digest) plus a granular
 * per-player diff against the run's saved rotation baseline. It states
 * explicitly how many games will lock (10, or 2 in the final block) and lists
 * the upcoming human games from the committed schedule.
 */

export interface RotationChange {
  playerVersionId: string;
  displayName: string;
  roleBefore: string;
  roleAfter: string;
  minutesBefore: number | null;
  minutesAfter: number | null;
}

export interface UpcomingGame {
  gameId: string;
  round: number;
  homeFranchiseId: string;
  awayFranchiseId: string;
  humanIsHome: boolean;
  opponentFranchiseId: string;
}

export interface LockPreview {
  /** Team games that will lock: 10 for blocks 0-7, 2 for block 8. */
  gamesToLock: number;
  roundRange: { fromRound: number; toRound: number };
  /** Digest of the pending 30-rotation set. */
  pendingDigest: string;
  /** Digest of the last accepted block's locked rotations (null pre-block). */
  lastLockedDigest: string | null;
  /** True when the pending set digest matches the last accepted lock. */
  unchangedSinceLastLock: boolean;
  /** Granular per-player changes vs the saved baseline rotation. */
  changes: RotationChange[];
  /** The human team's games in the upcoming block. */
  upcomingGames: UpcomingGame[];
}

export function gamesToLockForBlock(blockIndex: number): number {
  return blockIndex >= 8 ? SEASON_FINAL_BLOCK_TEAM_GAMES : SEASON_BLOCK_TEAM_GAMES;
}

/** The human team's games inside a block's round range, from the schedule. */
export function humanUpcomingGames(
  games: readonly SeasonGame[],
  humanFranchiseId: string,
  blockIndex: number,
): UpcomingGame[] {
  if (gamesToLockForBlock(blockIndex) === 0) return [];
  const { fromRound, toRound } = blockRoundRange(blockIndex);
  return games
    .filter(
      (game) =>
        game.round >= fromRound &&
        game.round <= toRound &&
        (game.homeFranchiseId === humanFranchiseId || game.awayFranchiseId === humanFranchiseId),
    )
    .sort((a, b) => a.round - b.round)
    .map((game) => ({
      gameId: game.gameId,
      round: game.round,
      homeFranchiseId: game.homeFranchiseId,
      awayFranchiseId: game.awayFranchiseId,
      humanIsHome: game.homeFranchiseId === humanFranchiseId,
      opponentFranchiseId:
        game.homeFranchiseId === humanFranchiseId ? game.awayFranchiseId : game.homeFranchiseId,
    }));
}

export function buildLockPreview(input: {
  pendingHumanRotation: SeasonRotation;
  baselineHumanRotation: SeasonRotation;
  /** Digest of the pending full 30-rotation set (all franchises). */
  pendingSetDigest: string;
  /** Digest of the last accepted block's rotation set; null before block 0. */
  lastLockedDigest: string | null;
  blockIndex: number;
  names: ReadonlyMap<string, string>;
  games: readonly SeasonGame[];
  humanFranchiseId: string;
}): LockPreview {
  const {
    pendingHumanRotation,
    baselineHumanRotation,
    pendingSetDigest,
    lastLockedDigest,
    blockIndex,
    names,
    games,
    humanFranchiseId,
  } = input;
  const changes: RotationChange[] = [];
  const pendingMinutes = new Map(
    pendingHumanRotation.targetMinutes.map((entry) => [entry.playerVersionId, entry.minutes]),
  );
  const baselineMinutes = new Map(
    baselineHumanRotation.targetMinutes.map((entry) => [entry.playerVersionId, entry.minutes]),
  );
  const allIds = new Set([
    ...pendingHumanRotation.starters,
    ...pendingHumanRotation.benchOrder,
    ...baselineHumanRotation.starters,
    ...baselineHumanRotation.benchOrder,
  ]);
  for (const playerVersionId of allIds) {
    const roleBefore = rotationRoleOf(baselineHumanRotation, playerVersionId);
    const roleAfter = rotationRoleOf(pendingHumanRotation, playerVersionId);
    const minutesBefore = baselineMinutes.get(playerVersionId) ?? null;
    const minutesAfter = pendingMinutes.get(playerVersionId) ?? null;
    if (roleBefore !== roleAfter || minutesBefore !== minutesAfter) {
      changes.push({
        playerVersionId,
        displayName: names.get(playerVersionId) ?? playerVersionId,
        roleBefore,
        roleAfter,
        minutesBefore,
        minutesAfter,
      });
    }
  }
  changes.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return {
    gamesToLock: gamesToLockForBlock(blockIndex),
    roundRange: blockRoundRange(blockIndex),
    pendingDigest: pendingSetDigest,
    lastLockedDigest,
    unchangedSinceLastLock: lastLockedDigest !== null && lastLockedDigest === pendingSetDigest,
    changes,
    upcomingGames: humanUpcomingGames(games, humanFranchiseId, blockIndex),
  };
}

/** Convenience: the full 30-rotation set digest with the human rotation swapped. */
export function pendingRotationSetDigest(
  runRotations: readonly SeasonRotation[],
  pendingHumanRotation: SeasonRotation,
): string {
  const merged = runRotations.map((rotation) =>
    rotation.franchiseId === pendingHumanRotation.franchiseId ? pendingHumanRotation : rotation,
  );
  return seasonRotationSetDigest(merged);
}

export type { SeasonUpcomingHumanGame };
