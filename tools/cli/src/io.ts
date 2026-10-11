import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export function sha256Hex(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}
export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`cannot read ${path}: ${(error as Error).message}`);
  }
}
export function tryReadJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}
export function atomicWriteFileSync(target: string, content: string): void {
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${String(Date.now())}-${String(Math.random()).slice(2)}`;
  writeFileSync(tmp, content);
  renameSync(tmp, target);
}
