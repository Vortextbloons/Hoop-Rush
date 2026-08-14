import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

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
