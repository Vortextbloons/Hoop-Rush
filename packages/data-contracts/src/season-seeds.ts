import { z } from 'zod';
import { seedSchema } from './ids.js';
import { seasonDigestHex } from './season-hash.js';
import { SEASON_SEED_DERIVATION_VERSION } from './season-versions.js';

/**
 * Named Season Run seed tree (spec/2.0/07 deterministic seed tree). Each
 * subsystem derives its own subseed from the root run seed through a named
 * namespace; adding a new namespace never perturbs an existing one, and
 * derivation is a pure function of (root seed, namespace, keys) so call
 * order, worker count, and unrelated draws cannot change another subsystem's
 * seeds.
 */

/** Canonical Season Run seed namespaces. */
export const SEASON_SEED_NAMESPACES = {
  /** M2.1 turn-based draft rolls. */
  draft: 'draft',
  /** M2.1 AI roster generation. */
  aiRosters: 'ai-rosters',
  /** Per-league-game simulation seeds (M2.3 block simulation). */
  scheduleGames: 'schedule-games',
  /** M2.5 injury occurrence, severity, and recovery. */
  injuries: 'injuries',
  /** M2.5 generated trade offers. */
  trades: 'trades',
  /** Reserved: roguelike upgrade offers (M2.9). */
  upgrades: 'upgrades',
  /** M2.6 final random draw for tied postseason qualification. */
  postseasonTies: 'postseason-ties',
} as const;
export type SeasonSeedNamespace = keyof typeof SEASON_SEED_NAMESPACES;

/**
 * Derives a namespace subseed from the root run seed. `keys` allow
 * fine-grained streams inside one namespace (for example one key per game
 * or per trade offer); the full key list participates in the digest. The
 * result is a 32-hex-digit seed valid for the packaged `seedSchema`.
 */
export function seasonNamespaceSeed(
  rootSeed: z.infer<typeof seedSchema>,
  namespace: string,
  ...keys: string[]
): z.infer<typeof seedSchema> {
  return seasonDigestHex(
    [
      SEASON_SEED_DERIVATION_VERSION,
      rootSeed,
      namespace,
      ...keys.map((key) => key.replaceAll('\u0000', '')),
    ].join('\u0000'),
  );
}
