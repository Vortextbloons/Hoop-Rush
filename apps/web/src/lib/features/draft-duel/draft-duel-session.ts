import { DraftDuelSession, type DraftDuelSessionDeps } from '@hoop-rush/application/draft-duel';
import { newRequestId } from '#lib/ids.js';
import { visibilityTickScheduler } from '../multiplayer/visibility-tick-scheduler';
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
import { rematchAchievementHooks } from '#lib/features/profile/rematch-achievement.js';

function profileAwareDraftDuelRepository(
  repository: DraftDuelSessionDeps['repository'],
  rematch: Partial<DraftDuelSessionDeps['repository']>,
): DraftDuelSessionDeps['repository'] {
  return withRepositoryHooks(repository, {
    ...rematch,
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
  const loadMembership = overrides.loadMembership ?? loadDraftDuelMembership;
  const rematch =
    overrides.repository || overrides.transport
      ? undefined
      : rematchAchievementHooks({
          mode: 'draft-duel',
          bindingPrefix: 'draft-duel',
          loadMembership,
          loadCompleted: (id) => baseRepository.loadCompleted(id),
          complete: (recap) => baseRepository.complete(recap),
        });
  const repository = overrides.repository
    ? baseRepository
    : profileAwareDraftDuelRepository(baseRepository, {
        ...(rematch && { complete: rematch.complete, loadCompleted: rematch.loadCompleted }),
      });
  return new DraftDuelSession({
    transport: overrides.transport ?? getDraftDuelTransport(),
    repository,
    scheduleTick: overrides.scheduleTick ?? visibilityTickScheduler,
    runner: overrides.runner ?? new DraftDuelRunner(),
    loadAssets: overrides.loadAssets ?? (() => loadDraftDuelAssets()),
    now: overrides.now ?? (() => Date.now()),
    newCommandId: overrides.newCommandId ?? (() => newRequestId()),
    friendlyError: overrides.friendlyError ?? friendlyDraftDuelJoinError,
    loadMembership,
    rememberRematch: overrides.rememberRematch ?? rematch?.rememberRematch,
    saveMembership: overrides.saveMembership ?? saveDraftDuelMembership,
  });
}

export type { DraftDuelSession } from '@hoop-rush/application/draft-duel';
