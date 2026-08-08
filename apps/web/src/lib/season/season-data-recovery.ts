import { DexieSeasonDraftRepository } from '@hoop-rush/persistence';
import { clearCachedSeasonSnapshot } from './season-state-cache';
import { getSeasonRunRepository, resetSeasonRepositories } from './season-repo';

/**
 * Clears every Season Run row (active run, draft, session cache) from this
 * browser. Used when persisted state is corrupt and normal quit/discard
 * paths cannot recover.
 */
export async function clearAllSeasonData(): Promise<void> {
  const repo = await getSeasonRunRepository();
  await repo.forceClearActiveSeasonRun();
  await new DexieSeasonDraftRepository().clearSeasonDraft();
  clearCachedSeasonSnapshot();
  resetSeasonRepositories();
}
