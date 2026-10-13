export const LITE_ATTRIBUTE = 'data-lite';
export const LITE_MANUAL_STORAGE_KEY = 'hoop-rush:lite-mode';
export const LITE_TOGGLE_EVENT = 'hoop-rush:lite-mode-changed';
export const LITE_MEDIA_QUERY = '(prefers-reduced-motion: reduce)';

const LOW_DEVICE_MEMORY_GB = 4;
const LOW_HARDWARE_CONCURRENCY = 4;

interface NavigatorWithHints extends Navigator {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
}

export interface DeviceSnapshot {
  hardwareConcurrency: number;
  deviceMemory: number;
  saveData: boolean;
  prefersReducedMotion: boolean;
  lowEnd: boolean;
}

export type LiteModePreference = 'auto' | 'on' | 'off';

function prefersReducedMotion(): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(LITE_MEDIA_QUERY).matches;
  } catch {
    return false;
  }
}

export function detectLowEndDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  try {
    const nav = navigator as NavigatorWithHints;
    if (nav.connection?.saveData === true) return true;
    if (
      typeof nav.deviceMemory === 'number' &&
      nav.deviceMemory > 0 &&
      nav.deviceMemory < LOW_DEVICE_MEMORY_GB
    )
      return true;
    if (
      typeof nav.hardwareConcurrency === 'number' &&
      nav.hardwareConcurrency > 0 &&
      nav.hardwareConcurrency <= LOW_HARDWARE_CONCURRENCY
    )
      return true;
    if (prefersReducedMotion()) return true;
    return false;
  } catch {
    return false;
  }
}

export function getDeviceSnapshot(): DeviceSnapshot {
  const nav = (typeof navigator === 'undefined' ? null : (navigator as NavigatorWithHints)) ?? null;
  return {
    hardwareConcurrency: nav?.hardwareConcurrency ?? 0,
    deviceMemory: nav?.deviceMemory ?? 0,
    saveData: nav?.connection?.saveData === true,
    prefersReducedMotion: prefersReducedMotion(),
    lowEnd: detectLowEndDevice(),
  };
}

export function readLiteModePreference(): LiteModePreference {
  try {
    if (typeof localStorage === 'undefined') return 'auto';
    const raw = localStorage.getItem(LITE_MANUAL_STORAGE_KEY);
    if (raw === 'on' || raw === 'off') return raw;
    return 'auto';
  } catch {
    return 'auto';
  }
}

export function liteModePreferenceToStorageValue(preference: LiteModePreference): string | null {
  return preference === 'auto' ? null : preference;
}

export function applyLiteMode(lite: boolean): void {
  try {
    if (typeof document === 'undefined') return;
    document.documentElement.toggleAttribute(LITE_ATTRIBUTE, lite);
  } catch {}
}

export function setLiteModePreference(preference: LiteModePreference): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = liteModePreferenceToStorageValue(preference);
      if (stored === null) localStorage.removeItem(LITE_MANUAL_STORAGE_KEY);
      else localStorage.setItem(LITE_MANUAL_STORAGE_KEY, stored);
    }
  } catch {}
  const active = isLiteModeActive(preference);
  applyLiteMode(active);
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(LITE_TOGGLE_EVENT, { detail: { preference, active } }));
    }
  } catch {}
}

export function initLiteMode(): boolean {
  const active = isLiteModeActive();
  applyLiteMode(active);
  return active;
}

export function isLiteMode(): boolean {
  try {
    if (typeof document === 'undefined') return false;
    return document.documentElement.hasAttribute(LITE_ATTRIBUTE);
  } catch {
    return false;
  }
}

export function deferIdle(work: () => void, timeoutMs = 2000): void {
  if (typeof window === 'undefined') return;
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(
      () => {
        work();
      },
      { timeout: timeoutMs },
    );
    return;
  }
  setTimeout(work, 0);
}

export function isLiteModeActive(
  preference: LiteModePreference = readLiteModePreference(),
): boolean {
  if (preference === 'on') return true;
  if (preference === 'off') return false;
  return detectLowEndDevice();
}
