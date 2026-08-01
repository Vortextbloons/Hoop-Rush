import type {
  FranchiseEraPool,
  HoopRushManifest,
  Lineup,
  PeakPlayerSeason,
  Seed,
} from '@hoop-rush/data-contracts';
import { seedSchema } from '@hoop-rush/data-contracts';
import { validateLineup } from '@hoop-rush/engine';

/**
 * Validated URL state shared by the sandbox draft (spec/08). The draft page
 * carries franchise, era, slot assignments, and player IDs through the URL so
 * drafts survive refresh without persistence; every value is re-validated
 * against the manifest and pool at load time.
 */

export interface SandboxUrlState {
  franchiseId: string;
  eraId: string;
  /** Five player IDs in slot order 0..4. */
  playerIds: string[];
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

/** The query-string portion of a sandbox URL (combined with resolve() by pages). */
export function buildSandboxQuery(state: SandboxUrlState): string {
  const params = new URLSearchParams({
    franchise: state.franchiseId,
    era: state.eraId,
    slots: state.playerIds.join(','),
  });
  if (state.seed !== undefined) params.set('seed', state.seed);
  return params.toString();
}

/** Typed sandbox hrefs: members of the app's route union, so resolve() accepts them. */
export type SandboxHref = `/sandbox?${string}`;

/** Full sandbox href for the draft route (callers pass it through resolve()). */
export function buildSandboxUrl(state: SandboxUrlState): SandboxHref {
  return `/sandbox?${buildSandboxQuery(state)}`;
}

export function parseSandboxUrl(
  url: URL,
  manifest: HoopRushManifest | null,
  pool: FranchiseEraPool | null,
): UrlStateValidation {
  const franchiseId = url.searchParams.get('franchise');
  const eraId = url.searchParams.get('era');
  const slotsParam = url.searchParams.get('slots');
  const seedParam = url.searchParams.get('seed');

  if (!franchiseId || !eraId || !slotsParam) {
    return {
      ok: false,
      state: null,
      error: 'Missing franchise, era, or slots in the URL.',
    };
  }
  if (manifest === null) {
    return { ok: false, state: null, error: 'Data is still loading.' };
  }
  const franchise = manifest.franchiseLineage.find((e) => e.franchiseId === franchiseId);
  if (!franchise) {
    return { ok: false, state: null, error: `Unknown franchise "${franchiseId}".` };
  }
  if (!manifest.eras.some((e) => e.eraId === eraId)) {
    return { ok: false, state: null, error: `Unknown decade "${eraId}".` };
  }
  const playerIds = slotsParam.split(',');
  if (playerIds.length !== 5 || playerIds.some((id) => id.length === 0)) {
    return { ok: false, state: null, error: 'A lineup needs exactly five players.' };
  }
  if (new Set(playerIds).size !== 5) {
    return { ok: false, state: null, error: 'A lineup cannot repeat a player.' };
  }
  let seed: Seed | undefined;
  if (seedParam !== null) {
    if (!seedSchema.safeParse(seedParam).success) {
      return { ok: false, state: null, error: 'The seed in the URL is invalid.' };
    }
    seed = seedParam;
  }

  if (pool !== null) {
    const byId = new Map(pool.players.map((p) => [p.playerId, p]));
    const missing = playerIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      return {
        ok: false,
        state: null,
        error: `Some drafted players are not in this pool: ${missing.join(', ')}.`,
      };
    }
    const players = playerIds
      .map((id) => byId.get(id))
      .filter((p): p is PeakPlayerSeason => p !== undefined);
    const lineup: Lineup = {
      structure: ['G', 'G', 'F', 'F', 'C'],
      assignments: players.map((player, slotIndex) => ({
        slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
        playerId: player.playerId,
        positions: player.positions.canonical,
      })),
    };
    const validation = validateLineup(lineup);
    if (!validation.ok) {
      const issue = validation.issues[0];
      return {
        ok: false,
        state: null,
        error: issue ? `Lineup is not legal: ${issue.message}` : 'Lineup is not legal.',
      };
    }
  }

  return {
    ok: true,
    state: { franchiseId, eraId, playerIds, seed },
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
