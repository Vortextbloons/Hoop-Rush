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

export function createHavocMultiplayerSession(
  overrides: Partial<HavocMultiplayerSessionDeps> = {},
): HavocMultiplayerSession {
  return new HavocMultiplayerSession({
    transport: overrides.transport ?? getHavocMultiplayerTransport(),
    repository: overrides.repository ?? getPersistence().havocMultiplayerRepository,
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
