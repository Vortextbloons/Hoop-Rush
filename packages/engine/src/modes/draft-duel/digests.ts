import type {
  ContentHash,
  DraftDuelGameOutput,
  DraftDuelSimulationInput,
  GameResult,
} from '@hoop-rush/data-contracts';
import { canonicalJsonData } from '@hoop-rush/data-contracts';
import { gameDigest64 } from '../../sim/digests.ts';

export function draftDuelSimulationInputDigest(input: DraftDuelSimulationInput): ContentHash {
  return gameDigest64('draft-duel-input', canonicalJsonData(input));
}
export function draftDuelGameResultDigest(result: GameResult): ContentHash {
  return gameDigest64('draft-duel-result', canonicalJsonData(result));
}
export function draftDuelGameTapeDigest(tape: DraftDuelGameOutput['tape']): ContentHash {
  return gameDigest64('draft-duel-tape', canonicalJsonData(tape));
}
