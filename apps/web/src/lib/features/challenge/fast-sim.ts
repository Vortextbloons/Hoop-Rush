const FAST_SIM_STORAGE_KEY = 'hoop-rush:challenge-fast-sim';

/**
 * Fast Sim is a per-device preference for the classic/sandbox run view. It skips
 * the game-by-game reveal cadence and commits accepted games in ordered batches.
 */
export function readFastSimPreference(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(FAST_SIM_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

export function writeFastSimPreference(enabled: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (enabled) localStorage.setItem(FAST_SIM_STORAGE_KEY, 'on');
    else localStorage.removeItem(FAST_SIM_STORAGE_KEY);
  } catch {}
}
