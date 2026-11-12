import type {
  HavocGameInput,
  HavocGameResult,
  HavocGameSummary,
  HavocGameTape,
} from '../../../../../packages/data-contracts/src/index.ts';
import {
  HAVOC_SCHEMA_VERSION,
  havocDigestSchema,
  havocGameSummarySchema,
} from '../../../../../packages/data-contracts/src/index.ts';
import { digestOf } from './core/battle-digests.ts';

export const HAVOC_INPUT_DIGEST_PREFIX = 'havoc-input-v1:';
export const HAVOC_RESULT_DIGEST_PREFIX = 'havoc-result-v1:';
export const HAVOC_TAPE_DIGEST_PREFIX = 'havoc-tape-v1:';

export function havocGameInputDigest(input: HavocGameInput): string {
  return digestOf(HAVOC_INPUT_DIGEST_PREFIX, input);
}

export function havocGameResultDigest(result: HavocGameResult): string {
  return digestOf(HAVOC_RESULT_DIGEST_PREFIX, result);
}

export function havocGameTapeDigest(tape: HavocGameTape): string {
  return digestOf(HAVOC_TAPE_DIGEST_PREFIX, tape);
}

export function havocGameSummaryOf(
  result: HavocGameResult,
  resultDigest: string,
): HavocGameSummary {
  const human = result.humanSide === 'home' ? result.home : result.away;
  const opponent = result.humanSide === 'home' ? result.away : result.home;
  return havocGameSummarySchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    gameNumber: result.gameNumber,
    variant: result.variant,
    seed: result.seed,
    humanSide: result.humanSide,
    humanScore: human.points,
    opponentScore: opponent.points,
    outcome: human.points > opponent.points ? 'win' : 'loss',
    periods: {
      human: [...human.periods],
      opponent: [...opponent.periods],
    },
    overtimePeriods: result.overtimePeriods,
    adjustments: human.adjustments,
    resultDigest: havocDigestSchema.parse(resultDigest),
    inputDigest: result.inputDigest,
  });
}
