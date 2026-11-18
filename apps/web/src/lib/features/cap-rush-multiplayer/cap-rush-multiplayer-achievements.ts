import type {
  AchievementUnlock,
  CapRushMultiplayerSeatId,
  CapRushMultiplayerState,
} from '@hoop-rush/data-contracts';
import { capRushMultiplayerAchievements } from '@hoop-rush/application/cap-rush-multiplayer';
import { profileRepository, selectedProfile } from '#lib/features/profile/profile.js';

export interface CapRushMultiplayerAchievementAward {
  /** Stable per room through the binding; one record per achievement. */
  readonly eventId: string;
  readonly candidate: AchievementUnlock;
}

export function capRushMultiplayerBindingId(roomId: string): string {
  return `cap-rush-multiplayer:${roomId}`;
}

export function capRushMultiplayerAchievementAwards(
  state: CapRushMultiplayerState,
  seat: CapRushMultiplayerSeatId,
): CapRushMultiplayerAchievementAward[] {
  return capRushMultiplayerAchievements({ state, seat }).map((achievement) => ({
    eventId: `cap-rush:${achievement.id}`,
    candidate: achievement,
  }));
}

export async function bindCapRushMultiplayerProfile(
  roomId: string,
  seat: CapRushMultiplayerSeatId,
): Promise<void> {
  await selectedProfile();
  await profileRepository().bind(capRushMultiplayerBindingId(roomId), seat);
}

export async function awardCapRushMultiplayerAchievement(
  roomId: string,
  award: CapRushMultiplayerAchievementAward,
): Promise<void> {
  await profileRepository().awardAchievements(capRushMultiplayerBindingId(roomId), award.eventId, [
    award.candidate,
  ]);
}
