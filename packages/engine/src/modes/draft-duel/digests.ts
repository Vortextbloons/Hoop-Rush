import type {
  ContentHash,
  DraftDuelGameOutput,
  DraftDuelSimulationInput,
  GameResult,
} from '@hoop-rush/data-contracts';
import { canonicalJson, contentHashSchema, seasonDigestHex } from '@hoop-rush/data-contracts';

function digest64(namespace: string, material: string): ContentHash {
  return contentHashSchema.parse(
    `${seasonDigestHex(`${namespace}-v1:${material}`)}${seasonDigestHex(`${namespace}-v2:${material}`)}`,
  );
}
export function draftDuelSimulationInputDigest(input: DraftDuelSimulationInput): ContentHash {
  return digest64('draft-duel-input', canonicalJson(input));
}
export function draftDuelGameResultDigest(result: GameResult): ContentHash {
  return digest64('draft-duel-result', canonicalJson(result));
}
export function draftDuelGameTapeDigest(tape: DraftDuelGameOutput['tape']): ContentHash {
  return digest64('draft-duel-tape', canonicalJson(tape));
}
