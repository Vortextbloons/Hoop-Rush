import {
  HavocMultiplayerSession,
  type HavocMultiplayerSessionDeps,
} from '@hoop-rush/application/havoc-multiplayer';
import { newRequestId } from '#lib/ids.js';
import { visibilityTickScheduler } from '../multiplayer/visibility-tick-scheduler';
import { getPersistence } from '#lib/persistence.js';
import { loadHavocMultiplayerAssets } from './havoc-multiplayer-assets';
import { getHavocMultiplayerTransport } from './havoc-multiplayer-transport';
import { HavocMultiplayerRunner } from './havoc-multiplayer-runner';
import {
  friendlyHavocMultiplayerError,
  loadHavocMultiplayerMembership,
  saveHavocMultiplayerMembership,
} from './havoc-multiplayer-identity';
import {
  profileRepository,
  selectedProfile,
  withRepositoryHooks,
} from '#lib/features/profile/profile.js';
import { rematchAchievementHooks } from '#lib/features/profile/rematch-achievement.js';

function profileAwareHavocMultiplayerRepository(
  repository: HavocMultiplayerSessionDeps['repository'],
  rematch: Partial<HavocMultiplayerSessionDeps['repository']>,
): HavocMultiplayerSessionDeps['repository'] {
  return withRepositoryHooks(repository, {
    ...rematch,
    saveActive: async (state) => {
      const membership = loadHavocMultiplayerMembership(state.roomId);
      if (membership) {
        await selectedProfile();
        await profileRepository().bind(
          `havoc-multiplayer:${state.roomId}`,
          membership.participantId,
        );
      }
      return repository.saveActive(state);
    },
  });
}

export function createHavocMultiplayerSession(
  overrides: Partial<HavocMultiplayerSessionDeps> = {},
): HavocMultiplayerSession {
  const baseRepository = overrides.repository ?? getPersistence().havocMultiplayerRepository;
  const loadMembership = overrides.loadMembership ?? loadHavocMultiplayerMembership;
  const rematch =
    overrides.repository || overrides.transport
      ? undefined
      : rematchAchievementHooks({
          mode: 'havoc',
          bindingPrefix: 'havoc-multiplayer',
          loadMembership,
          loadCompleted: (id) => baseRepository.loadCompleted(id),
          complete: (recap) => baseRepository.complete(recap),
        });
  const repository = overrides.repository
    ? baseRepository
    : profileAwareHavocMultiplayerRepository(baseRepository, {
        ...(rematch && { complete: rematch.complete, loadCompleted: rematch.loadCompleted }),
      });
  return new HavocMultiplayerSession({
    transport: overrides.transport ?? getHavocMultiplayerTransport(),
    repository,
    scheduleTick: overrides.scheduleTick ?? visibilityTickScheduler,
    runner: overrides.runner ?? new HavocMultiplayerRunner(),
    loadAssets: overrides.loadAssets ?? (() => loadHavocMultiplayerAssets()),
    now: overrides.now ?? (() => Date.now()),
    newCommandId: overrides.newCommandId ?? (() => newRequestId()),
    friendlyError: overrides.friendlyError ?? friendlyHavocMultiplayerError,
    loadMembership,
    rememberRematch: overrides.rememberRematch ?? rematch?.rememberRematch,
    saveMembership: overrides.saveMembership ?? saveHavocMultiplayerMembership,
  });
}

export type { HavocMultiplayerSession } from '@hoop-rush/application/havoc-multiplayer';
