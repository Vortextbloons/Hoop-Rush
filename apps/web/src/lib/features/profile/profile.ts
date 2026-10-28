import type { AchievementId } from '@hoop-rush/data-contracts';
import { randomUUID } from '#lib/ids.js';
import { getPersistence } from '#lib/persistence.js';

export const achievements: Record<
  AchievementId,
  { name: string; description: string; reward: string }
> = {
  welcome: {
    name: 'Welcome to the Court',
    description: 'Complete your first game.',
    reward: 'Achievement badge',
  },
  'first-multiplayer-win': {
    name: 'The First of Many',
    description: 'Win your first multiplayer game.',
    reward: 'Achievement badge',
  },
  'hands-off': {
    name: 'Hands Off!',
    description: 'A player records 3 steals in one game.',
    reward: 'Blue name color',
  },
  'no-easy-buckets': {
    name: 'No Easy Buckets',
    description: 'A player blocks 3 shots in one game.',
    reward: 'Defensive Wall title',
  },
  'silent-carry': {
    name: 'The Silent Carry',
    description: 'Win with a player recording 8 assists and fewer than 5 points.',
    reward: 'Floor General title',
  },
  'built-different': {
    name: 'Built Different',
    description: 'Win 5 multiplayer games in a row.',
    reward: 'Crown avatar and gold border',
  },
};

export function profileRepository() {
  return getPersistence().profileRepository;
}

export async function selectedProfile() {
  return profileRepository().initialize(randomUUID());
}

export function withRepositoryHooks<T extends object>(repository: T, hooks: Partial<T>): T {
  return new Proxy(repository, {
    get(target, property) {
      if (typeof property === 'string' && hooks[property as keyof T] !== undefined) {
        return hooks[property as keyof T];
      }
      const key = property as keyof T;
      const member = target[key];
      if (typeof member === 'function') {
        return member.bind(target) as T[typeof key];
      }
      return member;
    },
  });
}
