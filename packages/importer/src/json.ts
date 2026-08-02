/**
 * JSON and filesystem helpers for the import pipeline.
 *
 * Output formatting mirrors the Python importer: `JSON.stringify(value, null, 2)`
 * without a trailing newline (with-newline variants are used where the Python
 * source appended "\n"). Number formatting differs cosmetically from Python's
 * `json.dumps` (e.g. `60` vs `60.0`); content hashes are recomputed on rebuild.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function fileExists(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/** Write JSON with 2-space indent; `newline` appends "\n" like the Python source did. */
export function writeJson(path: string, value: unknown, newline = false): void {
  ensureDir(dirname(path));
  const text = JSON.stringify(value, null, 2) + (newline ? '\n' : '');
  writeFileSync(path, text, 'utf8');
}

/**
 * Write JSON with retry: synced/filtered filesystems (OneDrive, AV scanners)
 * intermittently fail `open` with UV_UNKNOWN on write bursts. Retries with
 * backoff before giving up.
 */
export function writeJsonRetry(path: string, value: unknown, newline = false): void {
  ensureDir(dirname(path));
  const text = JSON.stringify(value, null, 2) + (newline ? '\n' : '');
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      writeFileSync(path, text, 'utf8');
      return;
    } catch (error) {
      if (attempt === 11) throw error;
      const wait = 200 * (attempt + 1);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
    }
  }
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function sha256File(path: string): string {
  return sha256Hex(readFileSync(path));
}

/**
 * Mirror of the Python `_safe_float`/`float(x or 0)` semantics: null, undefined,
 * empty strings and non-numeric values fall back to `fallback`; NaN/Inf also
 * fall back. Booleans coerce like Python floats (true -> 1).
 */
export function safeFloat(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (Number.isNaN(n) || !Number.isFinite(n)) return fallback;
  return n;
}

/**
 * Mirror of the Python `_safe_int` semantics: convert via float then truncate
 * toward zero (Python `int(float(x))`); NaN/Inf/non-numeric fall back.
 */
export function safeInt(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (Number.isNaN(n) || !Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

export function clampRating(value: number): number {
  // Python's clamp_rating is int(clamp(v, 0, 100)): truncation, not rounding.
  return clamp(Math.trunc(value), 0, 100);
}

/** Clamp a rate or percentage stored on the 0..1 scale. Non-finite values become null. */
export function clampUnitInterval(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return clamp(value, 0, 1);
}
