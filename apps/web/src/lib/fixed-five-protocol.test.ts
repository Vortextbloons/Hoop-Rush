import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CLASSIC_ROLL_VERSION,
  FIXED_FIVE_AUTOPICK_VERSION,
  FIXED_FIVE_MULTIPLAYER_VERSION,
  POSITION_NORMALIZATION_VERSION,
  fixedFiveCommandPayloadSchema,
  playerIdSchema,
} from '@hoop-rush/data-contracts';
import { ENGINE_VERSION, SEED_DERIVATION_VERSION } from '@hoop-rush/engine';

const MIGRATION_PATH = fileURLToPath(
  new URL(
    '../../../../supabase/migrations/20260914000001_fixed_five_deep_reposition.sql',
    import.meta.url,
  ),
);

function serverVersionLocks(): Record<string, string> {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  const block = sql.match(
    /insert into public\.fixed_five_server_versions[\s\S]*?on conflict \(key\)/,
  );
  if (block === null) throw new Error('server version seed block not found in the migration');
  const locks: Record<string, string> = {};
  for (const match of block[0].matchAll(/\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) locks[key] = value;
  }
  return locks;
}

describe('fixed-five server version locks', () => {
  it('match the exported protocol constants exactly', () => {
    const locks = serverVersionLocks();
    expect(locks).toEqual({
      engineVersion: ENGINE_VERSION,
      multiplayerVersion: FIXED_FIVE_MULTIPLAYER_VERSION,
      autopickVersion: FIXED_FIVE_AUTOPICK_VERSION,
      seedDerivationVersion: SEED_DERIVATION_VERSION,
      classicRollVersion: CLASSIC_ROLL_VERSION,
      positionNormalizationVersion: POSITION_NORMALIZATION_VERSION,
    });
  });
});

describe('fixed-five reposition protocol', () => {
  it('accepts atomic Classic and Sandbox reposition payloads', () => {
    const playerId = playerIdSchema.parse('deep-player');
    expect(
      fixedFiveCommandPayloadSchema.parse({
        kind: 'classic-reposition',
        playerId,
        slotIndex: 2,
      }),
    ).toEqual({ kind: 'classic-reposition', playerId, slotIndex: 2 });
    expect(
      fixedFiveCommandPayloadSchema.parse({
        kind: 'sandbox-reposition',
        playerId,
        slotIndex: 3,
      }),
    ).toEqual({ kind: 'sandbox-reposition', playerId, slotIndex: 3 });
  });

  it('keeps atomic reposition kinds in the server command allowlist', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');
    expect(sql).toContain("'classic-reposition'");
    expect(sql).toContain("'sandbox-reposition'");
  });
});
