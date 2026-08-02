import type { HoopRushManifest, PoolAvailability, Seed } from '@hoop-rush/data-contracts';
import { seedSchema } from '@hoop-rush/data-contracts';

/**
 * Validated URL state shared by the sandbox draft (spec/08). The draft page
 * carries the selected franchise + decade (both required) plus an optional
 * seed through the URL so drafts survive refresh without persistence. The
 * combination is re-validated against the manifest availability matrix at
 * load time; pool content is never encoded in the URL.
 */

export interface SandboxUrlState {
  /** Selected modern franchise slot. */
  franchiseId: string;
  /** Selected decade (pool era and simulation environment era). */
  eraId: string;
  /** Five drafted player ids in slot order; re-validated against the pool. */
  slots?: string[];
  seed?: Seed;
}

export interface UrlStateValidation {
  ok: boolean;
  state: SandboxUrlState | null;
  /** Human-readable reason for an invalid state. */
  error: string | null;
}

/** Route template literal so callers can pass the result through resolve(). */
export type SandboxUrlTarget = `/sandbox?${string}`;

/** Typed sandbox hrefs: members of the app's route union, so resolve() accepts them. */
export type SandboxHref = `/sandbox?${string}`;

/** Full sandbox href for the draft route (callers pass it through resolve()). */
export function buildSandboxUrl(state: SandboxUrlState): SandboxHref {
  const params = new URLSearchParams();
  params.set('franchise', state.franchiseId);
  params.set('era', state.eraId);
  if (state.slots !== undefined && state.slots.length > 0) {
    params.set('slots', state.slots.join(','));
  }
  if (state.seed !== undefined) params.set('seed', state.seed);
  return `/sandbox?${params.toString()}`;
}

export function parseSandboxUrl(
  url: URL,
  manifest: HoopRushManifest | null,
): UrlStateValidation {
  if (manifest === null) {
    return { ok: false, state: null, error: 'Data is still loading.' };
  }
  const franchiseId = url.searchParams.get('franchise');
  const eraId = url.searchParams.get('era');
  if (franchiseId === null || eraId === null) {
    return { ok: false, state: null, error: 'Missing franchise or decade in the URL.' };
  }
  if (!manifest.modernFranchiseSlots.some((slot) => slot.franchiseId === franchiseId)) {
    return { ok: false, state: null, error: `Unknown franchise "${franchiseId}".` };
  }
  if (!manifest.eras.some((era) => era.eraId === eraId)) {
    return { ok: false, state: null, error: `Unknown decade "${eraId}".` };
  }
  const availability: PoolAvailability | undefined = manifest.availability.find(
    (entry) => entry.franchiseId === franchiseId && entry.eraId === eraId,
  );
  if (availability === undefined || availability.status !== 'available') {
    return {
      ok: false,
      state: null,
      error: `${franchiseId}/${eraId} is not available.`,
    };
  }
  let seed: Seed | undefined;
  const seedParam = url.searchParams.get('seed');
  if (seedParam !== null) {
    if (!seedSchema.safeParse(seedParam).success) {
      return { ok: false, state: null, error: 'The seed in the URL is invalid.' };
    }
    seed = seedParam;
  }
  let slots: string[] | undefined;
  const slotsParam = url.searchParams.get('slots');
  if (slotsParam !== null) {
    const parts = slotsParam.split(',');
    if (parts.length !== 5 || parts.some((part) => part === '')) {
      return { ok: false, state: null, error: 'A lineup needs exactly five players.' };
    }
    if (new Set(parts).size !== 5) {
      return { ok: false, state: null, error: 'A lineup cannot repeat a player.' };
    }
    slots = parts;
  }

  return {
    ok: true,
    state: { franchiseId, eraId, slots, seed },
    error: null,
  };
}

/** Generates a fresh game seed at the UI boundary (never in domain logic). */
export function generateSeed(): Seed {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // SSR fallback: deterministic placeholder is never used by gameplay because
  // seed generation happens in a client-side effect.
  return '00000000000000000000000000000000';
}
