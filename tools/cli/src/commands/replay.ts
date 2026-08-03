import { readFileSync } from 'node:fs';
import { gameResultDigest, simulateGame } from '@hoop-rush/engine';
import { createEngineContext } from '@hoop-rush/engine';
import {
  gameResultSchema,
  gameSimulationInputSchema,
  type GameResult,
  type GameSimulationInput,
} from '@hoop-rush/data-contracts';
import { makeReport, EXIT_USAGE_OR_DATA_ERROR, type CliReport } from '../report.js';
import { replayReportSchema } from '../report-schemas.js';
import { UsageError } from './sim.js';

/**
 * `replay` (spec/09): reproduces a saved game input and compares its result
 * against a stored expected result, reporting the first structured
 * difference when determinism fails.
 */

export const REPLAY_OPTIONS: Record<string, boolean> = {
  input: true,
  expected: true,
  format: true,
  verbose: false,
};

function readInputJson<T>(
  path: string,
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
  what: string,
): T {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new UsageError(`${what} file not found: ${path}`);
  }
  const parsed = schema.safeParse(JSON.parse(raw) as unknown);
  if (!parsed.success) {
    throw new UsageError(`${what} file fails validation: ${path}`);
  }
  return parsed.data as T;
}

/** First structured difference between two serializable values, as a path. */
function firstDifference(expected: unknown, actual: unknown): string | null {
  if (Object.is(expected, actual)) return null;
  if (typeof expected !== typeof actual) return '(type)';
  if (expected === null || actual === null) return '(value)';
  if (typeof expected !== 'object' || typeof actual !== 'object') return '(value)';
  const expectedObj = expected as Record<string, unknown>;
  const actualObj = actual as Record<string, unknown>;
  const keys = new Set([...Object.keys(expectedObj), ...Object.keys(actualObj)]);
  for (const key of keys) {
    if (!(key in expectedObj)) return `.${key} (missing)`;
    if (!(key in actualObj)) return `.${key} (unexpected)`;
    const nested = firstDifference(expectedObj[key], actualObj[key]);
    if (nested !== null)
      return `.${key}${nested === '(value)' ? '' : nested === '(type)' ? ' (type)' : nested}`;
  }
  return '(value)';
}

export function replay(args: { input?: string; expected?: string }): CliReport {
  const inputPath = args.input;
  const expectedPath = args.expected;
  if (!inputPath || !expectedPath) {
    throw new UsageError('replay requires --input <game-input.json> --expected <game-result.json>');
  }
  const input = readInputJson<GameSimulationInput>(inputPath, gameSimulationInputSchema, 'input');
  const expected = readInputJson<GameResult>(expectedPath, gameResultSchema, 'expected');

  const result = simulateGame(input, createEngineContext());
  const expectedDigest = gameResultDigest(expected);
  const actualDigest = gameResultDigest(result);
  const identical = expectedDigest === actualDigest;
  const difference = identical ? null : firstDifference(expected, result);

  const payload = replayReportSchema.parse({
    schemaVersion: 1,
    command: 'replay',
    seed: input.seed,
    engineVersion: result.engineVersion,
    identical,
    firstDifference: difference,
    expectedValue: identical ? null : (expected as unknown),
    actualValue: identical ? null : (result as unknown),
  });

  const details = [
    `seed ${input.seed} · engine ${result.engineVersion}`,
    identical
      ? `replay identical (${String(expectedDigest.length)}-char digest)`
      : `first difference: ${difference ?? 'unknown'}`,
  ];
  const failures = identical ? [] : ['replay differs from the stored expected result'];
  return makeReport(
    'replay',
    { input: inputPath, expected: expectedPath },
    { details, failures, payload },
  );
}

export { EXIT_USAGE_OR_DATA_ERROR };
