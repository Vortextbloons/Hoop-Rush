import type { HavocRunState } from '@hoop-rush/data-contracts';
import {
  canonicalHavocLockedInputs,
  canonicalJson,
  seasonDigestHex,
} from '@hoop-rush/data-contracts';

export const HAVOC_STATE_DIGEST_PREFIX = 'havoc-run-state-v1';

export function HavocStateDigest(state: HavocRunState): string {
  let material: string;
  if (state.locked === null) {
    material = canonicalJson(state);
  } else {
    const locked = canonicalHavocLockedInputs(state.locked);
    const parts: string[] = [];
    const record: Record<string, unknown> = state;
    for (const key of Object.keys(record).sort()) {
      const value = record[key];
      if (value === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${key === 'locked' ? locked : canonicalJson(value)}`);
    }
    material = `{${parts.join(',')}}`;
  }
  return seasonDigestHex(`${HAVOC_STATE_DIGEST_PREFIX}\u0000${material}`);
}
