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
export function writeJsonRetry(path: string, value: unknown, newline = false): void {
    ensureDir(dirname(path));
    const text = JSON.stringify(value, null, 2) + (newline ? '\n' : '');
    for (let attempt = 0; attempt < 12; attempt += 1) {
        try {
            writeFileSync(path, text, 'utf8');
            return;
        }
        catch (error) {
            if (attempt === 11)
                throw error;
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
export function safeFloat(value: unknown, fallback = 0): number {
    if (value === null || value === undefined || value === '')
        return fallback;
    const n = Number(value);
    if (Number.isNaN(n) || !Number.isFinite(n))
        return fallback;
    return n;
}
export function safeInt(value: unknown, fallback = 0): number {
    if (value === null || value === undefined || value === '')
        return fallback;
    const n = Number(value);
    if (Number.isNaN(n) || !Number.isFinite(n))
        return fallback;
    return Math.trunc(n);
}
export function clamp(value: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, value));
}
export function clampRating(value: number): number {
    return clamp(Math.trunc(value), 0, 100);
}
export function clampUnitInterval(value: number | null): number | null {
    if (value === null || !Number.isFinite(value))
        return null;
    return clamp(value, 0, 1);
}
