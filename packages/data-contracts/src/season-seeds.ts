import { z } from 'zod';
import { seedSchema } from './ids.ts';
import { seasonDigestHex } from './season-hash.ts';
import { SEASON_SEED_DERIVATION_VERSION } from './season-versions.ts';

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
  /** M2.5 deterministic objective-choice offers per block. */
  objectives: 'objectives',
  /** Reserved: roguelike upgrade offers (M2.9). */
  upgrades: 'upgrades',
  /** M2.6 standings ties (Play-In qualification and playoff seeding). */
  postseasonTies: 'postseason-ties',
  /** M2.6 Play-In game simulation. */
  playInGames: 'postseason-play-in',
  /** M2.6 playoff game simulation. */
  playoffGames: 'postseason-playoff-games',
  /** M2.6 AI postseason rotation decisions. */
  aiPostseasonRotations: 'postseason-ai-rotations',
  /** M2.6 postseason injury occurrence, severity, and recovery. */
  postseasonInjuries: 'postseason-injuries',
  /** M2.6 deterministic draws (e.g. the Finals home-court fallback). */
  postseasonDraws: 'postseason-draws',
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
