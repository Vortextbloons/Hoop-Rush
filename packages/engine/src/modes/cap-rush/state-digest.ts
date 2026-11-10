import type { CapRushDraftState, SeasonDigestState } from '@hoop-rush/data-contracts';
import { canonicalJson, seasonDigestState } from '@hoop-rush/data-contracts';

export const CAP_RUSH_STATE_DIGEST_PREFIX = 'cap-rush-draft-state-v1';
const HASH_OFFSETS = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35] as const;
const lockedPrefixes = new WeakMap<object, { material: string; hash: SeasonDigestState }>();

function hexOf(state: SeasonDigestState): string {
  return state.map((value) => (value >>> 0).toString(16).padStart(8, '0')).join('');
}

/**
 * Digest of a Cap Rush draft state.
 *
 * The frozen `locked` inputs dominate the state size and never change during a
 * season, so their serialization and hash prefix are cached per locked object.
 * The remaining fields hash straight into the running state. That keeps the
 * exact bytes of `seasonDigestHex(prefix + canonicalJson(state))` without
 * materializing the full canonical string on every accepted command.
 *
 * The cache is keyed by the serialized prefix, exactly like the digest it
 * replaces, so a copied and mutated lock still produces the digest of its own
 * bytes instead of a stale cached value.
 */
export function capRushStateDigest(state: CapRushDraftState): string {
  const record = state as unknown as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  const head = `${CAP_RUSH_STATE_DIGEST_PREFIX}\u0000{`;
  let hash = seasonDigestState(head, HASH_OFFSETS);
  let material = head;
  let first = true;
  for (const key of keys) {
    const piece = `${first ? '' : ','}${JSON.stringify(key)}:`;
    first = false;
    const encoded = canonicalJson(record[key]);
    const locked = key === 'locked' && state.locked !== null ? state.locked : null;
    material += piece + encoded;
    if (locked === null) {
      hash = seasonDigestState(piece, hash);
      hash = seasonDigestState(encoded, hash);
      continue;
    }
    const cached = lockedPrefixes.get(locked);
    if (cached !== undefined && cached.material === material) {
      hash = cached.hash;
    } else {
      hash = seasonDigestState(piece, hash);
      hash = seasonDigestState(encoded, hash);
      lockedPrefixes.set(locked, { material, hash });
    }
    // Later keys cannot reuse the cached prefix, so stop tracking it.
    material = '';
  }
  hash = seasonDigestState('}', hash);
  return hexOf(hash);
}
