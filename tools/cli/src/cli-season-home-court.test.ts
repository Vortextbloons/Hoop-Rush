import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { seasonHomeCourtProfileSchema } from '@hoop-rush/data-contracts';
import { SEASON_HOME_COURT_PROFILE, seasonHomeCourtMechanisms } from '@hoop-rush/engine';
import { seasonHomeCourtCalibrateReportSchema } from './report-schemas.ts';
import {
  seasonHomeCourtCalibrate,
  seasonHomeCourtTargetsSchema,
  simulateSeasonHomeCourtFacts,
  validateSeasonHomeCourtTargets,
} from './commands/season-home-court.ts';
import { REPO_ROOT, withTmpDir } from './cli-test-helpers.ts';
import { seasonGameSimulationInputSchema } from '@hoop-rush/data-contracts';
import { seasonGameFixtureSchema } from './fixture-schema.ts';
import { seasonGameCalibrationSeed } from './commands/season-game.ts';
import type {
  SeasonGameSimulationResult,
  SeasonGameSimulationInput,
  SeasonGameSideResult,
} from '@hoop-rush/data-contracts';

/**
 * CLI tests for `season home-court calibrate` (spec/2.0/02, M2.3). The
 * command-level tests run with injected engine doubles and the in-process
 * cohort runner; the committed artifact is validated directly.
 */

/**
 * A deterministic fake engine: the neutral adapter splits mirror games at
 * 50% and the tuned profile raises the home rate linearly with the profile
 * constants. The per-seed decision is a pure function of the seed index, so
 * cohort folding is stable.
 */
function fakeSimulateSeasonGame(input: SeasonGameSimulationInput): SeasonGameSimulationResult {
  const homeCourt = input.homeCourt;
  const tuned = homeCourt.homeDefensiveCommunication > 0 || homeCourt.awayTurnoverPressure > 0;
  // The seed is a 32-hex zero-padded index; the trailing 8 hex chars carry
  // the index for cohorts up to 2^32.
  const index = Number.parseInt(input.seed.slice(24, 32), 16) || 0;
  const homeRate = tuned
    ? 0.5 + (homeCourt.homeDefensiveCommunication + homeCourt.awayTurnoverPressure) * 0.1
    : 0.5;
  const draw = tuned
    ? (index * 137 + 3) % 1000 < homeRate * 1000
    : (index * 131 + 500) % 1000 < homeRate * 1000;
  const homeWins = draw;
  const side = (teamId: string, franchiseId: string, score: number): SeasonGameSideResult => ({
    teamId,
    displayName: teamId,
    franchiseId,
    score,
    periodScores: [score / 4, score / 4, score / 4, score / 4],
    box: {
      points: score,
      fieldGoals: { made: 40, attempted: 90 },
      threes: { made: 10, attempted: 30 },
      freeThrows: { made: 20, attempted: 25 },
      rebounds: { total: 50, offensive: 9, defensive: 37, team: 4 },
      assists: 25,
      steals: 8,
      blocks: 5,
      turnovers: 12,
      fouls: 18,
      possessions: 95,
      diagnostics: {
        assistedFieldGoals: 20,
        unassistedFieldGoals: 20,
        reboundOpportunities: 50,
        contestedShots: 90,
      },
    },
    players: [],
    shotZones: [],
  });
  const homeScore = homeWins ? 110 : 100;
  const awayScore = homeWins ? 100 : 110;
  return {
    schemaVersion: 1,
    outcome: 'completed',
    seed: input.seed,
    gameNumber: input.gameNumber,
    dataVersion: input.dataVersion,
    engineVersion: 'test-engine',
    profileVersion: input.profile.profileVersion,
    winner: homeWins ? 'home' : 'away',
    overtimePeriods: 0,
    home: side(input.home.teamId, input.home.franchiseId, homeScore),
    away: side(input.away.teamId, input.away.franchiseId, awayScore),
    substitutions: [],
    unitStints: [],
    deviations: [],
    foulOuts: [],
    removals: [],
  };
}

const fakeDeps = {
  simulateSeasonGame: fakeSimulateSeasonGame,
  checkSeasonGameResult: () => [] as string[],
};

const BALANCED = join(REPO_ROOT, 'tools/cli/src/fixtures/season-game-balanced.json');

describe('season home-court calibration helpers', () => {
  it('derives facts that flip toward the home team under the tuned profile', () => {
    const parsed = seasonGameFixtureSchema.parse(JSON.parse(readFileSync(BALANCED, 'utf8')));
    const input = seasonGameSimulationInputSchema.parse({
      ...parsed.input,
      seed: seasonGameCalibrationSeed(0),
    });
    const facts = simulateSeasonHomeCourtFacts(
      'balanced',
      0,
      input,
      SEASON_HOME_COURT_PROFILE,
      fakeDeps,
    );
    expect(facts.neutralHomeWon).toBe(false);
    expect(facts.homeProfileHomeWon).toBe(true);
    expect(facts.completed).toBe(true);
    expect(facts.homePossessions).toBe(95);
  });

  it('validates the committed artifact against the engine profile', () => {
    const target = join(REPO_ROOT, 'apps/web/static/data/season/home-court-targets.json');
    const failures = validateSeasonHomeCourtTargets(target);
    expect(failures).toEqual([]);
    const parsed = seasonHomeCourtTargetsSchema.parse(JSON.parse(readFileSync(target, 'utf8')));
    expect(parsed.constants.homeDefensiveCommunication).toBe(
      SEASON_HOME_COURT_PROFILE.homeDefensiveCommunication,
    );
    expect(parsed.constants.awayTurnoverPressure).toBe(
      SEASON_HOME_COURT_PROFILE.awayTurnoverPressure,
    );
    expect(seasonHomeCourtProfileSchema.safeParse(SEASON_HOME_COURT_PROFILE).success).toBe(true);
    expect(
      seasonHomeCourtMechanisms(SEASON_HOME_COURT_PROFILE).homeDefenseShotAdjustment,
    ).toBeLessThan(0);
    expect(
      seasonHomeCourtMechanisms(SEASON_HOME_COURT_PROFILE).awayTurnoverPressureAdjustment,
    ).toBeGreaterThan(0);
  });
});

describe('cli: season home-court calibrate (injected doubles)', () => {
  it('writes the evidence artifact when the gates pass', async () => {
    await withTmpDir(async (tmp) => {
      const out = join(tmp, 'home-court-targets.json');
      const report = await seasonHomeCourtCalibrate(
        {
          fixture: 'season-game-balanced',
          'seed-from': '1024',
          'seed-to': '1087',
          workers: '2',
          constants: '0.55,0.5',
          out,
        },
        fakeDeps,
      );
      const payload = seasonHomeCourtCalibrateReportSchema.parse(report.payload);
      expect(payload.pass).toBe(true);
      expect(payload.gates.withinTolerance).toBe(true);
      expect(payload.targetsWritten).toBe(true);
      const artifact = seasonHomeCourtTargetsSchema.parse(JSON.parse(readFileSync(out, 'utf8')));
      expect(artifact.constants).toEqual({
        homeDefensiveCommunication: 0.55,
        awayTurnoverPressure: 0.5,
      });
      expect(artifact.gameVersion).toBe('season-game-v2');
      expect(artifact.engineVersion.length).toBeGreaterThan(0);
    });
  }, 60_000);

  it('fails the gates without writing when the target is missed', async () => {
    await withTmpDir(async (tmp) => {
      const out = join(tmp, 'home-court-targets-miss.json');
      const report = await seasonHomeCourtCalibrate(
        {
          fixture: 'season-game-balanced',
          'seed-from': '1024',
          'seed-to': '2047',
          workers: '1',
          constants: '0.9,0.9',
          out,
        },
        fakeDeps,
      );
      expect(report.failures.length).toBeGreaterThan(0);
      // The artifact must not be written on a failed calibration.
      expect(report.payload).toMatchObject({ targetsWritten: false });
    });
  }, 60_000);

  it('rejects a tampered artifact through --validate', async () => {
    await withTmpDir((tmp) => {
      const tampered = join(tmp, 'home-court-targets-tampered.json');
      const committed = join(REPO_ROOT, 'apps/web/static/data/season/home-court-targets.json');
      const content = JSON.parse(readFileSync(committed, 'utf8')) as {
        constants: { homeDefensiveCommunication: number };
      };
      content.constants.homeDefensiveCommunication = 0.99;
      writeFileSync(tampered, `${JSON.stringify(content, null, 2)}\n`);
      const failures = validateSeasonHomeCourtTargets(tampered);
      expect(failures.some((failure) => failure.includes('homeDefensiveCommunication'))).toBe(true);
    });
  });
});
