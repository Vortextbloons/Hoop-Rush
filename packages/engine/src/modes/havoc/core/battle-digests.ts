import type {
  HavocBattleInput,
  HavocBattleResult,
  HavocBattleTape,
} from '@hoop-rush/data-contracts';
import { canonicalJson, havocDigestSchema, seasonDigestHex } from '@hoop-rush/data-contracts';

/**
 * Digest prefixes are part of the frozen digest discipline: a value written by
 * one prefix must never collide with another. Version them with the rules.
 */
export const HAVOC_BATTLE_INPUT_DIGEST_PREFIX = 'havoc-battle-input-v1:';
export const HAVOC_BATTLE_RESULT_DIGEST_PREFIX = 'havoc-battle-result-v1:';
export const HAVOC_BATTLE_TAPE_DIGEST_PREFIX = 'havoc-battle-tape-v1:';

export function havocBattleGameInputDigest(input: HavocBattleInput): string {
  return havocDigestSchema.parse(
    seasonDigestHex(`${HAVOC_BATTLE_INPUT_DIGEST_PREFIX}${canonicalJson(input)}`),
  );
}

export function havocBattleGameResultDigest(result: HavocBattleResult): string {
  return havocDigestSchema.parse(
    seasonDigestHex(`${HAVOC_BATTLE_RESULT_DIGEST_PREFIX}${canonicalJson(result)}`),
  );
}

export function havocBattleGameTapeDigest(tape: HavocBattleTape): string {
  return havocDigestSchema.parse(
    seasonDigestHex(`${HAVOC_BATTLE_TAPE_DIGEST_PREFIX}${canonicalJson(tape)}`),
  );
}
