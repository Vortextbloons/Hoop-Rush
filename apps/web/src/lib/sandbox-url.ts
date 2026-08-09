import type {
  HoopRushManifest,
  PlayersIndex,
  PlayersIndexEntry,
  RunPlayerSelection,
  Seed,
} from '@hoop-rush/data-contracts';
import { seedSchema } from '@hoop-rush/data-contracts';
import { validateLineup } from '@hoop-rush/engine';
import { randomHex } from '$lib/random-hex';

/**
 * Validated URL state shared by the sandbox draft (spec/08). The draft page
 * carries five player selections (player + franchise/era pool provenance)
 * and an optional seed through the URL so drafts survive refresh without
 * persistence; every value is re-validated against the manifest and the
 * global players index at load time.
 */

export interface SandboxUrlState {
  /** Five player selections in slot order 0..4. */
  slots: RunPlayerSelection[];
  seed?: Seed;
}

export interface UrlStateValidation {
  ok: boolean;
  state: SandboxUrlState | null;
  /** Human-readable reason for an invalid state. */
  error: string | null;
}

export type SandboxHref = `/sandbox?${string}`;

const SLOT_PATTERN = /^([^@]+)@([^/]+)\/([^/]+)$/;

export function parseSandboxUrl(
  url: URL,
  manifest: HoopRushManifest | null,
  index: PlayersIndex | null,
): UrlStateValidation {
  if (manifest === null && index === null) {
    return { ok: false, state: null, error: 'Data is still loading.' };
  }
  const slotsParam = url.searchParams.get('slots');
  if (slotsParam === null) {
    return { ok: false, state: null, error: 'Missing slots in the URL.' };
  }
  const parts = slotsParam.split(',');
  if (parts.length !== 5) {
    return { ok: false, state: null, error: 'A lineup needs exactly five players.' };
  }
  const slots: RunPlayerSelection[] = [];
  for (const part of parts) {
    const match = SLOT_PATTERN.exec(part);
    const playerId = match?.[1];
    const franchiseId = match?.[2];
    const eraId = match?.[3];
    if (!playerId || !franchiseId || !eraId) {
      return { ok: false, state: null, error: `Invalid slot "${part}" in the URL.` };
    }
    slots.push({ playerId, franchiseId, eraId });
  }
  if (new Set(slots.map((s) => s.playerId)).size !== 5) {
    return { ok: false, state: null, error: 'A lineup cannot repeat a player.' };
  }
  let seed: Seed | undefined;
  const seedParam = url.searchParams.get('seed');
  if (seedParam !== null) {
    if (!seedSchema.safeParse(seedParam).success) {
      return { ok: false, state: null, error: 'The seed in the URL is invalid.' };
    }
    seed = seedParam;
  }

  if (manifest !== null) {
    for (const slot of slots) {
      if (!manifest.modernFranchiseSlots.some((s) => s.franchiseId === slot.franchiseId)) {
        return { ok: false, state: null, error: `Unknown franchise "${slot.franchiseId}".` };
      }
      if (!manifest.eras.some((e) => e.eraId === slot.eraId)) {
        return { ok: false, state: null, error: `Unknown decade "${slot.eraId}".` };
      }
    }
  }

  if (index !== null) {
    const rows: PlayersIndexEntry[] = [];
    for (const slot of slots) {
      const entry = index.players.find(
        (p) =>
          p.playerId === slot.playerId &&
          p.franchiseId === slot.franchiseId &&
          p.eraId === slot.eraId,
      );
      if (!entry) {
        return {
          ok: false,
          state: null,
          error: `Some drafted players are not in the players index: ${slot.playerId}.`,
        };
      }
      rows.push(entry);
    }
    const validation = validateLineup({
      structure: ['G', 'G', 'F', 'F', 'C'],
      assignments: rows.map((row, slotIndex) => ({
        slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
        playerId: row.playerId,
        positions: row.positionsPlayable,
      })),
    });
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
    state: { slots, seed },
    error: null,
  };
}

export function buildSandboxHref(slots: RunPlayerSelection[]): SandboxHref {
  const params = new URLSearchParams();
  params.set(
    'slots',
    slots.map((slot) => `${slot.playerId}@${slot.franchiseId}/${slot.eraId}`).join(','),
  );
  return `/sandbox?${params.toString()}`;
}

export function generateSeed(): Seed {
  return randomHex(16);
}
