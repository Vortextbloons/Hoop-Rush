import type { FixedFiveRepository } from '@hoop-rush/persistence';
import { getPersistence } from '#lib/persistence.js';
import {
  profileRepository,
  selectedProfile,
  withRepositoryHooks,
} from '#lib/features/profile/profile.js';
import { loadFixedFiveMembership } from './fixed-five-identity';

const baseRepository = getPersistence().fixedFiveRepository;
export const fixedFiveRepository: FixedFiveRepository = withRepositoryHooks(baseRepository, {
  saveActiveSnapshot: async (...args) => {
    const membership = loadFixedFiveMembership(args[0].roomId);
    if (membership) {
      await selectedProfile();
      await profileRepository().bind(`fixed-five:${args[0].roomId}`, membership.participantId);
    }
    return baseRepository.saveActiveSnapshot(...args);
  },
});
