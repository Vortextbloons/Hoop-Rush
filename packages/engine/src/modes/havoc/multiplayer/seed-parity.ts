import type { HavocMultiplayerParticipantId, Seed } from '@hoop-rush/data-contracts';

/**
 * Server-mirrorable draw: the parity of a root-seed byte (even -> p1, odd -> p2),
 * matching the Supabase byte-parity functions used for the first picker (offset 0)
 * and the series home side (offset 2).
 */
export function havocMultiplayerByteDraw(
  rootSeed: Seed,
  offset: number,
): HavocMultiplayerParticipantId {
  return Number.parseInt(rootSeed.slice(offset, offset + 2), 16) % 2 === 0 ? 'p1' : 'p2';
}
