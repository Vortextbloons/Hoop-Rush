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

export function createDraftDuelSession(
  overrides: Partial<DraftDuelSessionDeps> = {},
): DraftDuelSession {
  return new DraftDuelSession({
    transport: overrides.transport ?? getDraftDuelTransport(),
    repository: overrides.repository ?? getPersistence().draftDuelRepository,
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
