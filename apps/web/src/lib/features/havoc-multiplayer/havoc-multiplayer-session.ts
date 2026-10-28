import {
  HavocMultiplayerSession,
  type HavocMultiplayerSessionDeps,
} from '@hoop-rush/application/havoc-multiplayer';
import { newRequestId } from '#lib/ids.js';
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

function profileAwareHavocMultiplayerRepository(
  repository: HavocMultiplayerSessionDeps['repository'],
): HavocMultiplayerSessionDeps['repository'] {
  return withRepositoryHooks(repository, {
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
  const repository = overrides.repository
    ? baseRepository
    : profileAwareHavocMultiplayerRepository(baseRepository);
  return new HavocMultiplayerSession({
    transport: overrides.transport ?? getHavocMultiplayerTransport(),
    repository,
    runner: overrides.runner ?? new HavocMultiplayerRunner(),
    loadAssets: overrides.loadAssets ?? (() => loadHavocMultiplayerAssets()),
    now: overrides.now ?? (() => Date.now()),
    newCommandId: overrides.newCommandId ?? (() => newRequestId()),
    friendlyError: overrides.friendlyError ?? friendlyHavocMultiplayerError,
    loadMembership: overrides.loadMembership ?? loadHavocMultiplayerMembership,
    saveMembership: overrides.saveMembership ?? saveHavocMultiplayerMembership,
  });
}

export type { HavocMultiplayerSession } from '@hoop-rush/application/havoc-multiplayer';
