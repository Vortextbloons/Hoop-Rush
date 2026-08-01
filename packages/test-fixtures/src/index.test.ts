import { describe, expect, it } from 'vitest';
import {
  challengeRunSchema,
  franchiseEraPoolSchema,
  hoopRushManifestSchema,
  peakPlayerSeasonSchema,
} from '@hoop-rush/data-contracts';
import {
  buildChallengeRun,
  buildManifest,
  buildPlayerSeason,
  buildPool,
  seedFromString,
} from './index.js';

describe('fixture builders', () => {
  it('build a schema-valid peak player season', () => {
    const player = buildPlayerSeason();
    expect(peakPlayerSeasonSchema.safeParse(player).success).toBe(true);
  });

  it('build a schema-valid pool', () => {
    const pool = buildPool([buildPlayerSeason(), buildPlayerSeason({ playerId: 'p-2' })]);
    expect(franchiseEraPoolSchema.safeParse(pool).success).toBe(true);
  });

  it('build a schema-valid manifest', () => {
    expect(hoopRushManifestSchema.safeParse(buildManifest()).success).toBe(true);
  });

  it('build a schema-valid challenge run', () => {
    const run = buildChallengeRun();
    expect(challengeRunSchema.safeParse(run).success).toBe(true);
    expect(run.schedule.opponents).toHaveLength(30);
  });

  it('produces deterministic seeds', () => {
    expect(seedFromString('x')).toBe(seedFromString('x'));
    expect(seedFromString('x')).not.toBe(seedFromString('y'));
    expect(seedFromString('x')).toMatch(/^[0-9a-f]{32}$/);
  });
});
