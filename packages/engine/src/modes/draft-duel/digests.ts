import type {
  ContentHash,
  DraftDuelGameOutput,
  DraftDuelSimulationInput,
  GameResult,
} from '@hoop-rush/data-contracts';
import { canonicalJson, contentHashSchema, seasonDigestHex } from '@hoop-rush/data-contracts';

export function draftDuelSimulationInputDigest(input: DraftDuelSimulationInput): ContentHash {
  return contentHashSchema.parse(seasonDigestHex(`draft-duel-input-v1:${canonicalJson(input)}`));
}
export function draftDuelGameResultDigest(result: GameResult): ContentHash {
  return contentHashSchema.parse(seasonDigestHex(`draft-duel-result-v1:${canonicalJson(result)}`));
}
export function draftDuelGameTapeDigest(tape: DraftDuelGameOutput['tape']): ContentHash {
  return contentHashSchema.parse(seasonDigestHex(`draft-duel-tape-v1:${canonicalJson(tape)}`));
}
