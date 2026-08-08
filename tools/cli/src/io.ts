/**
 * Shared CLI file/hash helpers (deduplicated across the command modules).
 *
 * `sha256Hex` and `readJson` match the majority convention of the former
 * per-command copies: utf8 reads and a `cannot read <path>: <message>`
 * wrapper on parse errors. `tryReadJson` keeps the null-returning variant
 * used by the read-only report commands (a missing/invalid manifest is
 * reported, never thrown).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function sha256Hex(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Parses a JSON file; wraps read/parse failures with the file path. */
export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`cannot read ${path}: ${(error as Error).message}`);
  }
}

/** Reads a JSON file as null when it is missing or malformed. */
export function tryReadJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}
