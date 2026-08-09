import { fatigueBandOf } from '@hoop-rush/engine';
import {
  SEASON_BLOCK_TEAM_GAMES,
  SEASON_FINAL_BLOCK_TEAM_GAMES,
  blockRoundRange,
  type SeasonEffectsState,
  type SeasonGame,
  type SeasonRotation,
  type SeasonUpcomingHumanGame,
} from '@hoop-rush/data-contracts';
import { rotationRoleOf } from './season-rotation-editor';
import { seasonRotationSetDigest } from './season-rotation-digest';
import { FATIGUE_BAND_LABEL, projectedFatigueBand } from './season-effects-view';

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

/**
 * M2.4: continuity and fatigue-risk projection for one rostered player under
 * the pending rotation. Presented as a projection (deterministic workload
 * model), never as a precise future outcome.
 */
export interface FatigueProjection {
  playerVersionId: string;
  displayName: string;
  minutesAfter: number | null;
  bandNow: string;
  bandAfterBlock: string;
  /** Continuity: same role + same minutes as the locked baseline. */
  continuous: boolean;
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
  /** M2.4 fatigue-risk + continuity projections for pending starters/closing. */
  fatigueProjections: FatigueProjection[];
  /**
   * M2.5: the objective locked into the block submission (null for the
   * final two-game block 8, or when no selection exists yet).
   */
  objective: { objectiveId: string; name: string } | null;
}

export function gamesToLockForBlock(blockIndex: number): number {
  return blockIndex >= 8 ? SEASON_FINAL_BLOCK_TEAM_GAMES : SEASON_BLOCK_TEAM_GAMES;
}

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
  /** M2.4: recorded load + stamina for the projection (null = skip). */
  fatigue?: {
    effects: SeasonEffectsState;
    staminaByVersion: ReadonlyMap<string, number>;
  } | null;
  /** M2.5: the objective locked into this block submission (if any). */
  objective?: { objectiveId: string; name: string } | null;
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
    fatigue,
    objective,
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

  const fatigueProjections: FatigueProjection[] = [];
  if (fatigue !== null && fatigue !== undefined) {
    const { effects, staminaByVersion } = fatigue;
    const projectedIds = [...pendingHumanRotation.starters, ...pendingHumanRotation.closingFive];
    const projected = new Set(projectedIds);
    for (const playerVersionId of projected) {
      const load = effects.playerStates.find((p) => p.playerVersionId === playerVersionId);
      if (load === undefined) continue;
      const stamina = staminaByVersion.get(playerVersionId) ?? 70;
      const minutes = pendingMinutes.get(playerVersionId) ?? 0;
      const roleBefore = rotationRoleOf(baselineHumanRotation, playerVersionId);
      const roleAfter = rotationRoleOf(pendingHumanRotation, playerVersionId);
      const minutesBefore = baselineMinutes.get(playerVersionId) ?? null;
      const continuous = roleBefore === roleAfter && minutesBefore === minutes;
      fatigueProjections.push({
        playerVersionId,
        displayName: names.get(playerVersionId) ?? playerVersionId,
        minutesAfter: minutes,
        bandNow: fatigueBandName(load.fatigueBasisPoints),
        bandAfterBlock: projectedFatigueBandName(
          load.fatigueBasisPoints,
          minutes,
          stamina,
          gamesToLockForBlock(blockIndex),
        ),
        continuous,
      });
    }
    fatigueProjections.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  return {
    gamesToLock: gamesToLockForBlock(blockIndex),
    roundRange: blockRoundRange(blockIndex),
    pendingDigest: pendingSetDigest,
    lastLockedDigest,
    unchangedSinceLastLock: lastLockedDigest !== null && lastLockedDigest === pendingSetDigest,
    changes,
    upcomingGames: humanUpcomingGames(games, humanFranchiseId, blockIndex),
    fatigueProjections,
    objective: objective ?? null,
  };
}

function fatigueBandName(fatigueBasisPoints: number): string {
  return FATIGUE_BAND_LABEL[fatigueBandOf(fatigueBasisPoints)];
}

function projectedFatigueBandName(
  currentFatigueBp: number,
  minutesPerGame: number,
  staminaRating: number,
  games: number,
): string {
  return FATIGUE_BAND_LABEL[
    projectedFatigueBand(currentFatigueBp, minutesPerGame, staminaRating, games)
  ];
}

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
