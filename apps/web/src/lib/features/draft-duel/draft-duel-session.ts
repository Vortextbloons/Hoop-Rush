import { DraftDuelSession, type DraftDuelSessionDeps } from '@hoop-rush/application/draft-duel';
import { newRequestId } from '#lib/ids.js';
import { getPersistence } from '#lib/persistence.js';
import { getDraftDuelTransport } from './draft-duel-transport';
import { DraftDuelRunner } from './draft-duel-runner';
import {
  friendlyDraftDuelJoinError,
  loadDraftDuelMembership,
  saveDraftDuelMembership,
} from './draft-duel-identity';
import { loadDraftDuelAssets } from './draft-duel-assets';
import {
  profileRepository,
  selectedProfile,
  withRepositoryHooks,
} from '#lib/features/profile/profile.js';

function profileAwareDraftDuelRepository(
  repository: DraftDuelSessionDeps['repository'],
): DraftDuelSessionDeps['repository'] {
  return withRepositoryHooks(repository, {
    saveActive: async (state) => {
      await selectedProfile();
      await profileRepository().bind(`draft-duel:${state.roomId}`);
      return repository.saveActive(state);
    },
  });
}

export function createDraftDuelSession(
  overrides: Partial<DraftDuelSessionDeps> = {},
): DraftDuelSession {
  const baseRepository = overrides.repository ?? getPersistence().draftDuelRepository;
  const repository = overrides.repository
    ? baseRepository
    : profileAwareDraftDuelRepository(baseRepository);
  return new DraftDuelSession({
    transport: overrides.transport ?? getDraftDuelTransport(),
    repository,
    runner: overrides.runner ?? new DraftDuelRunner(),
    loadAssets: overrides.loadAssets ?? (() => loadDraftDuelAssets()),
    now: overrides.now ?? (() => Date.now()),
    newCommandId: overrides.newCommandId ?? (() => newRequestId()),
    friendlyError: overrides.friendlyError ?? friendlyDraftDuelJoinError,
    loadMembership: overrides.loadMembership ?? loadDraftDuelMembership,
    saveMembership: overrides.saveMembership ?? saveDraftDuelMembership,
  });
}

export type { DraftDuelSession } from '@hoop-rush/application/draft-duel';
