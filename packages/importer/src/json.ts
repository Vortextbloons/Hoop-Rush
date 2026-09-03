import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}
export function fileExists(path: string): boolean {
  return existsSync(path);
}
export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}
export function writeJson(path: string, value: unknown, newline = false): void {
  ensureDir(dirname(path));
  const text = JSON.stringify(value, null, 2) + (newline ? '\n' : '');
  writeFileSync(path, text, 'utf8');
}
function retrySync<T>(fn: () => T, attempts = 12): T {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return fn();
    } catch (error) {
      if (attempt === attempts - 1) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * (attempt + 1));
    }
  }
  throw new Error('unreachable retrySync');
}
export function writeJsonRetry(path: string, value: unknown, newline = false): void {
  ensureDir(dirname(path));
  const text = JSON.stringify(value, null, 2) + (newline ? '\n' : '');
  retrySync(() => {
    writeFileSync(path, text, 'utf8');
  });
}
export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
export function sha256File(path: string): string {
  return sha256Hex(readFileSync(path));
}
export function sha256FileWithRetry(path: string): string {
  return retrySync(() => sha256File(path));
}
export function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return JSON.parse(text.replace(/\bNaN\b(?=\s*[,}\]])/g, 'null')) as unknown;
    }
    throw error;
  }
}
export function readJsonLoose(path: string): unknown {
  return parseJsonLoose(readFileSync(path, 'utf8'));
}
export function readJsonTolerant(path: string): unknown {
  return readJsonLoose(path);
}
export function safeFloat(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (Number.isNaN(n) || !Number.isFinite(n)) return fallback;
  return n;
}
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
  return clamp(Math.trunc(value), 0, 100);
}
export function clampUnitInterval(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return clamp(value, 0, 1);
}
