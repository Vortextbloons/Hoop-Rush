import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildManifest, buildPlayerSeason, buildPool } from '@hoop-rush/test-fixtures';
import {
  contentHashSchema,
  eraIdSchema,
  franchiseIdSchema,
  playerIdSchema,
  seasonKeySchema,
  type PeakPlayerSeason,
} from '@hoop-rush/data-contracts';
import { dataOverallsAudit } from './data-overalls-audit.ts';
import { EXIT_USAGE_OR_DATA_ERROR } from '../report.ts';
import { overallsAuditReportSchema } from '../report-schemas.ts';

function ratingProfile(overrides: Record<string, unknown> = {}): PeakPlayerSeason['ratingProfile'] {
  return {
    schemaVersion: 2,
    modelVersion: 'ratings-model-v3.4',
    memberships: {
      primaryCreator: 0.1,
      secondaryCreator: 0.1,
      scoringGuard: 0.1,
      movementSpacer: 0.1,
      twoWayWing: 0.1,
      connector: 0.1,
      interiorFinisher: 0.1,
      stretchBig: 0.1,
      rebounder: 0.1,
      defensiveAnchor: 0.1,
    },
    baseScore: 65,
    nonlinear: {
      creation: 70,
      penetration: 70,
      shootingGravity: 70,
      scalableScoring: 70,
      switchability: 70,
      rimProtection: 70,
      possessionControl: 70,
      synergyBonus: 0,
      weaknessPenalty: 0,
      weaknesses: {
        turnoverLiability: 0,
        inefficientUsage: 0,
        defensiveTargeting: 0,
        spacingLimitation: 0,
        foulRisk: 0,
        deficientRebounding: 0,
      },
    },
    production: {
      score: 70,
      weight: 0.2,
      confidence: 'high',
      sampleGames: 79,
      sampleMinutes: 2860,
      shrinkage: 0.4,
    },
    calibratedImpact: {
      adjustment: 0,
      confidence: 0,
      sampleCount: 0,
      artifactVersion: 'ratings-model-v3.4',
    },
    canonicalOverall: 80,
    rawOverallScore: 65,
    offenseRating: 80,
    defenseRating: 70,
    ...overrides,
  };
}

async function writeManifest(dir: string, players: PeakPlayerSeason[]): Promise<string> {
  const poolPath = join(dir, 'pool.json');
  const pool = buildPool(players);
  await writeFile(poolPath, JSON.stringify(pool));
  const manifestPath = join(dir, 'manifest.json');
  await writeFile(
    manifestPath,
    JSON.stringify(
      buildManifest({
        pools: [
          {
            franchiseId: pool.franchiseId,
            eraId: pool.eraId,
            url: 'pool.json',
            contentHash: contentHashSchema.parse('a'.repeat(64)),
          },
        ],
      }),
    ),
  );
  return manifestPath;
}

describe('dataOverallsAudit', () => {
  it('flags minutes-floor violations and YoY cliffs while reporting raw distribution', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hoop-rush-overalls-audit-'));
    try {
      const cliffHigh = buildPlayerSeason({
        playerId: playerIdSchema.parse('p-delk'),
        playerExternalId: '9001',
        displayName: 'Tony Delk',
        seasonKey: seasonKeySchema.parse('1996-97'),
        franchiseId: franchiseIdSchema.parse('hornets'),
        eraId: eraIdSchema.parse('1990s'),
        summaryRatings: { overallRating: 80, offenseRating: 75, defenseRating: 65 },
        stats: {
          gamesPlayed: 82,
          minutes: 2600,
          points: 1400,
          rebounds: 250,
          offensiveRebounds: 50,
          defensiveRebounds: 200,
          assists: 300,
          steals: 80,
          blocks: 10,
          turnovers: 150,
          fieldGoalsMade: 500,
          fieldGoalsAttempted: 1000,
          threesMade: 100,
          threesAttempted: 280,
          freeThrowsMade: 300,
          freeThrowsAttempted: 350,
          per: 16,
          boxPlusMinus: 1,
          usageRate: 22,
          tsPct: 0.55,
          efgPct: 0.52,
        },
        ratingProfile: ratingProfile({ canonicalOverall: 78, rawOverallScore: 64 }),
      });
      const cliffLow = buildPlayerSeason({
        playerId: playerIdSchema.parse('p-delk-2'),
        playerExternalId: '9001',
        displayName: 'Tony Delk',
        seasonKey: seasonKeySchema.parse('1997-98'),
        franchiseId: franchiseIdSchema.parse('warriors'),
        eraId: eraIdSchema.parse('1990s'),
        summaryRatings: { overallRating: 40, offenseRating: 60, defenseRating: 60 },
        stats: {
          gamesPlayed: 77,
          minutes: 1678,
          points: 800,
          rebounds: 180,
          offensiveRebounds: 40,
          defensiveRebounds: 140,
          assists: 150,
          steals: 50,
          blocks: 5,
          turnovers: 140,
          fieldGoalsMade: 300,
          fieldGoalsAttempted: 750,
          threesMade: 60,
          threesAttempted: 200,
          freeThrowsMade: 140,
          freeThrowsAttempted: 200,
          per: 8.07,
          boxPlusMinus: -1,
          usageRate: 24.7,
          tsPct: 0.452,
          efgPct: 0.44,
        },
        ratingProfile: ratingProfile({
          canonicalOverall: 40,
          rawOverallScore: 44.06,
          production: {
            score: 27.6,
            weight: 0.17,
            confidence: 'high',
            sampleGames: 77,
            sampleMinutes: 1678,
            shrinkage: 0.34,
          },
        }),
      });
      const manifestPath = await writeManifest(dir, [cliffHigh, cliffLow]);
      const report = dataOverallsAudit({ input: manifestPath });
      expect(report.ok).toBe(false);
      expect(report.exitCode).toBe(1);
      const payload = overallsAuditReportSchema.parse(report.payload);
      expect(payload.total).toBe(2);
      expect(payload.rowsWithoutRawOverall).toBe(0);
      expect(payload.raw.median).toBe(64);
      expect(payload.floorViolations).toHaveLength(1);
      expect(payload.floorViolations[0]).toMatchObject({
        displayName: 'Tony Delk',
        seasonKey: '1997-98',
        overall: 40,
      });
      expect(payload.yoyCliffs).toHaveLength(1);
      expect(payload.yoyCliffs[0]).toMatchObject({
        displayName: 'Tony Delk',
        previousSeasonKey: '1996-97',
        previousOverall: 80,
        delta: -40,
      });
      expect(report.failures.some((failure) => failure.includes('minutes floor'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('passes a clean rotation season and flags low-confidence 97+ without failing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hoop-rush-overalls-audit-clean-'));
    try {
      const player = buildPlayerSeason({
        summaryRatings: { overallRating: 97, offenseRating: 80, defenseRating: 70 },
        stats: {
          gamesPlayed: 40,
          minutes: 800,
          points: 900,
          rebounds: 300,
          offensiveRebounds: 60,
          defensiveRebounds: 240,
          assists: 200,
          steals: 40,
          blocks: 30,
          turnovers: 100,
          fieldGoalsMade: 350,
          fieldGoalsAttempted: 700,
          threesMade: 50,
          threesAttempted: 150,
          freeThrowsMade: 150,
          freeThrowsAttempted: 180,
          per: 24,
          boxPlusMinus: 7,
          usageRate: 31,
          tsPct: 0.62,
          efgPct: 0.58,
        },
        ratingProfile: ratingProfile({
          canonicalOverall: 93,
          rawOverallScore: 79.9,
          production: {
            score: 89.3,
            weight: 0.17,
            confidence: 'low',
            sampleGames: 40,
            sampleMinutes: 800,
            shrinkage: 0.2,
          },
        }),
      });
      const manifestPath = await writeManifest(dir, [player]);
      const report = dataOverallsAudit({ input: manifestPath });
      expect(report.ok).toBe(true);
      const payload = overallsAuditReportSchema.parse(report.payload);
      expect(payload.floorViolations).toHaveLength(0);
      expect(payload.lowConfidenceTop).toHaveLength(1);
      expect(payload.lowConfidenceTop[0]).toMatchObject({ overall: 97 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('exits 2 on a missing manifest', () => {
    const report = dataOverallsAudit({ input: join(tmpdir(), 'missing-manifest.json') });
    expect(report.exitCode).toBe(EXIT_USAGE_OR_DATA_ERROR);
  });
});
