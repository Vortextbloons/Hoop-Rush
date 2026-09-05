import { fatigueBandOf, seasonRotationSetDigest } from '@hoop-rush/engine';
import {
  SEASON_BLOCK_TEAM_GAMES,
  SEASON_FINAL_BLOCK_TEAM_GAMES,
  blockRoundRange,
  resolveHomeGameRule,
  type SeasonEffectsState,
  type SeasonEvolutionState,
  type SeasonGame,
  type SeasonGameRule,
  type SeasonRotation,
  type SeasonUpcomingHumanGame,
} from '@hoop-rush/data-contracts';
import { rotationRoleOf } from './season-rotation-editor';
import { FATIGUE_BAND_LABEL, projectedFatigueBand } from './season-effects-view';
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
  homeRule: SeasonGameRule;
}
export interface FatigueProjection {
  playerVersionId: string;
  displayName: string;
  minutesAfter: number | null;
  bandNow: string;
  bandAfterBlock: string;
  continuous: boolean;
}
export interface LockPreview {
  gamesToLock: number;
  roundRange: {
    fromRound: number;
    toRound: number;
  };
  pendingDigest: string;
  lastLockedDigest: string | null;
  unchangedSinceLastLock: boolean;
  changes: RotationChange[];
  upcomingGames: UpcomingGame[];
  fatigueProjections: FatigueProjection[];
  objective: {
    objectiveId: string;
    name: string;
  } | null;
}
export function gamesToLockForBlock(blockIndex: number): number {
  return blockIndex >= 8 ? SEASON_FINAL_BLOCK_TEAM_GAMES : SEASON_BLOCK_TEAM_GAMES;
}
export function humanUpcomingGames(
  games: readonly SeasonGame[],
  humanFranchiseId: string,
  blockIndex: number,
  evolution: SeasonEvolutionState | null = null,
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
      homeRule: resolveHomeGameRule(evolution, game.homeFranchiseId),
    }));
}
export function buildLockPreview(input: {
  pendingHumanRotation: SeasonRotation;
  baselineHumanRotation: SeasonRotation;
  pendingSetDigest: string;
  lastLockedDigest: string | null;
  blockIndex: number;
  names: ReadonlyMap<string, string>;
  games: readonly SeasonGame[];
  humanFranchiseId: string;
  fatigue?: {
    effects: SeasonEffectsState;
    staminaByVersion: ReadonlyMap<string, number>;
  } | null;
  objective?: {
    objectiveId: string;
    name: string;
  } | null;
  evolution?: SeasonEvolutionState | null;
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
    evolution,
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
    upcomingGames: humanUpcomingGames(games, humanFranchiseId, blockIndex, evolution ?? null),
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
