import { z } from 'zod';
import { seasonDigestHex } from './season-hash.ts';
import { PLAYER_VERSION_ID_VERSION } from './season-versions.ts';

export const playerVersionIdSchema = z.string().regex(/^pv-[0-9a-f]{32}$/);
export type PlayerVersionId = z.infer<typeof playerVersionIdSchema>;

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
