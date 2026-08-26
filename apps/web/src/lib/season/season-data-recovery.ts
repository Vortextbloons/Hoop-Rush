import { DexieSeasonDraftRepository } from '@hoop-rush/persistence';
import { clearCachedSeasonSnapshot } from './season-state-cache';
import { getSeasonRunRepository, resetSeasonRepositories } from './season-repo';
export async function clearAllSeasonData(): Promise<void> {
    const repo = await getSeasonRunRepository();
    await repo.forceClearActiveSeasonRun();
    await new DexieSeasonDraftRepository().clearSeasonDraft();
    clearCachedSeasonSnapshot();
    resetSeasonRepositories();
}
