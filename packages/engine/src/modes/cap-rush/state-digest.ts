import type { CapRushDraftState, SeasonDigestState } from '@hoop-rush/data-contracts';
import { canonicalJson, seasonDigestHex, seasonDigestState } from '@hoop-rush/data-contracts';

export const CAP_RUSH_STATE_DIGEST_PREFIX = 'cap-rush-draft-state-v1';
const lockedPrefixes = new WeakMap<object, { material: string; hash: SeasonDigestState }>();

export function capRushStateDigest(state: CapRushDraftState): string {
  const material = `${CAP_RUSH_STATE_DIGEST_PREFIX}\u0000${canonicalJson(state)}`;
  if (state.locked === null) return seasonDigestHex(material);
  const end =
    material.indexOf('"locked":') + '"locked":'.length + canonicalJson(state.locked).length;
  const prefix = material.slice(0, end);
  let cached = lockedPrefixes.get(state.locked);
  if (cached === undefined || cached.material !== prefix) {
    cached = { material: prefix, hash: seasonDigestState(prefix) };
    lockedPrefixes.set(state.locked, cached);
  }
  return seasonDigestHex(material.slice(end), cached.hash);
}
