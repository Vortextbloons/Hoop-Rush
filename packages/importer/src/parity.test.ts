/**
 * Parity harness: read-only comparison of TS-computed artifacts against the
 * committed artifacts under apps/web/static/data.
 *
 * Eligibility counts and peak-selection ordering must match exactly (they are
 * deterministic rules over the same inputs). Era-sim parameters must match
 * within rounding tolerance (same stint aggregates). Ratings are pure
 * deterministic derivations, so top-5 selection ordering must also match.
 */
import { existsSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PUBLIC_DATA } from './config.js';
import { readJson } from './json.js';
import { computePool, loadBbrefIds, loadManifest, type Pool } from './pools/compute.js';
import { computeEraProfile, erasWithData } from './era-profile/profile.js';

interface CommittedPoolPlayer {
  playerExternalId: string;
  seasonKey: string;
  selectionScore: number;
}

interface CommittedPool {
  players: CommittedPoolPlayer[];
}

// Eras with packaged raw-data seasons can be recomputed; the snapshot covers
// 1960-61 onward after the M3.5 import.
const TARGETS = [
  ['lakers', '1990s'],
  ['celtics', '1990s'],
  ['bulls', '1990s'],
  ['warriors', '2010s'],
] as const;

const PARAM_KEYS = [
  'pace',
  'league3PARate',
  'leagueTsPct',
  'leagueFtaPerFga',
  'leagueFtPct',
  'turnoverPerPossession',
  'stealShareOfTurnovers',
  'offensiveReboundRate',
  'assistRate',
  'foulsPerPossession',
] as const;

function topFive(players: CommittedPoolPlayer[]): string[] {
  return [...players]
    .sort((a, b) => b.selectionScore - a.selectionScore)
    .slice(0, 5)
    .map((p) => `${p.playerExternalId} ${p.seasonKey} ${String(p.selectionScore)}`);
}

describe('parity: pools vs committed artifacts', () => {
  for (const [franchiseId, eraId] of TARGETS) {
    it(`${franchiseId}/${eraId} eligibility and top-5 selection match`, () => {
      const manifest = loadManifest();
      const bbrefIds = loadBbrefIds();
      const result = computePool(franchiseId, eraId, manifest, bbrefIds, false);
      if ('reason' in result) {
        throw new Error(`pool ${franchiseId}/${eraId} failed: ${result.reason} ${result.detail}`);
      }
      const pool = result;

      const committed = readJson(
        `${PUBLIC_DATA}/pools/${franchiseId}-${eraId}.json`,
      ) as CommittedPool;
      expect(pool.players.length).toBe(committed.players.length);
      expect(topFive(pool.players)).toEqual(topFive(committed.players));
    });
  }
});

describe('parity: era profiles vs committed artifacts', () => {
  it('all era parameters match the committed profiles within rounding tolerance', () => {
    const eras = erasWithData();
    expect(eras.length).toBeGreaterThan(0);

    for (const era of eras) {
      const packagedPath = `${PUBLIC_DATA}/era-sim/${era.eraId}.json`;
      if (!existsSync(packagedPath)) continue;

      const profile = computeEraProfile(era);
      const committedProfile = readJson(packagedPath) as {
        parameters: Record<string, number>;
      };
      for (const key of PARAM_KEYS) {
        const expected = committedProfile.parameters[key] ?? 0;
        const actual = profile.parameters[key];
        // Both sides round from the same stint aggregates; allow float noise.
        expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.0015);
      }
    }
  });

  it('era-sim directory contains a profile per packaged era', () => {
    const files = readdirSync(`${PUBLIC_DATA}/era-sim`).filter((f) => f.endsWith('.json'));
    const eras = erasWithData();
    for (const era of eras) {
      expect(files).toContain(`${era.eraId}.json`);
    }
  });
});
