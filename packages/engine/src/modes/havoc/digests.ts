import type {
  HavocGameInput,
  HavocGameResult,
  HavocGameSummary,
  HavocGameTape,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_SCHEMA_VERSION,
  canonicalJson,
  havocDigestSchema,
  havocGameSummarySchema,
  seasonDigestHex,
} from '@hoop-rush/data-contracts';

export const HAVOC_INPUT_DIGEST_PREFIX = 'havoc-input-v1:';
export const HAVOC_RESULT_DIGEST_PREFIX = 'havoc-result-v1:';
export const HAVOC_TAPE_DIGEST_PREFIX = 'havoc-tape-v1:';

export function havocGameInputDigest(input: HavocGameInput): string {
  return havocDigestSchema.parse(
    seasonDigestHex(`${HAVOC_INPUT_DIGEST_PREFIX}${canonicalJson(input)}`),
  );
}

export function havocGameResultDigest(result: HavocGameResult): string {
  return havocDigestSchema.parse(
    seasonDigestHex(`${HAVOC_RESULT_DIGEST_PREFIX}${canonicalJson(result)}`),
  );
}

export function havocGameTapeDigest(tape: HavocGameTape): string {
  return havocDigestSchema.parse(
    seasonDigestHex(`${HAVOC_TAPE_DIGEST_PREFIX}${canonicalJson(tape)}`),
  );
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
