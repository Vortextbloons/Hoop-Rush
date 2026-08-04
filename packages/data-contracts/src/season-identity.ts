import { z } from 'zod';
import { seasonDigestHex } from './season-hash.js';
import { PLAYER_VERSION_ID_VERSION } from './season-versions.js';

/**
 * Season Run player-version identity (spec/2.0/03). One peak player-season
 * version is identified by its four existing identity fields — player,
 * franchise, era, and season — without changing any 1.0 identity rule. The
 * derived `playerVersionId` is the exclusive ownership key for Season Run
 * rosters, so two different versions of the same person remain distinct
 * while every roster claim stays deterministic.
 */

/** Derived player-version identity; the ownership key for Season Run claims. */
export const playerVersionIdSchema = z.string().regex(/^pv-[0-9a-f]{32}$/);
export type PlayerVersionId = z.infer<typeof playerVersionIdSchema>;

/**
 * Deterministic player-version identity derived from the existing identity
 * fields. Regenerating from the same fields always produces the same id;
 * changing any field produces a different id. The derivation material
 * includes the derivation version so a future rule change cannot silently
 * reinterpret old ids.
 */
export function playerVersionId(
  playerId: string,
  franchiseId: string,
  eraId: string,
  seasonKey: string,
): PlayerVersionId {
  return `pv-${seasonDigestHex(
    `${PLAYER_VERSION_ID_VERSION}\u0000${playerId}\u0000${franchiseId}\u0000${eraId}\u0000${seasonKey}`,
  )}`;
}
