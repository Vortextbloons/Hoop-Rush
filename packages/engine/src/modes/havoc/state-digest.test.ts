import { describe, expect, it } from 'vitest';
import { canonicalJson, seasonDigestHex } from '@hoop-rush/data-contracts';
import { buildHavocRunState, buildHavocRunStateLocked } from '@hoop-rush/test-fixtures';
import { HAVOC_STATE_DIGEST_PREFIX, HavocStateDigest } from './state-digest.ts';

describe('havoc state digest', () => {
  it('hashes the canonical state under the documented prefix', () => {
    const state = buildHavocRunState();
    const expected = seasonDigestHex(`${HAVOC_STATE_DIGEST_PREFIX}\u0000${canonicalJson(state)}`);
    expect(HAVOC_STATE_DIGEST_PREFIX).toBe('havoc-run-state-v1');
    expect(HavocStateDigest(state)).toBe(expected);
    expect(HavocStateDigest(state)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is stable for equal states and changes with the revision', () => {
    const state = buildHavocRunStateLocked();
    const same = { ...state };
    expect(HavocStateDigest(same)).toBe(HavocStateDigest(state));
    const bumped = { ...state, revision: state.revision + 1 };
    expect(HavocStateDigest(bumped)).not.toBe(HavocStateDigest(state));
    const movedCursor = { ...state, havocCursor: 1 };
    expect(HavocStateDigest(movedCursor)).not.toBe(HavocStateDigest(state));
  });

  it('differs between draft and run phases of the same run seed', () => {
    const draft = buildHavocRunState();
    const run = buildHavocRunStateLocked();
    expect(HavocStateDigest(draft)).not.toBe(HavocStateDigest(run));
  });
});
