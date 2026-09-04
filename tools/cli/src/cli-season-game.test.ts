import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  seasonGameSimulationResultSchema,
  seasonGameTargetsSchema,
  type SeasonGameSimulationInput,
  type SeasonGameSimulationResult,
  type SeasonGameTeamInput,
  type SeasonRotation,
  type SeasonRotationPreset,
} from '@hoop-rush/data-contracts';
import { seasonGameFixtureSchema } from './fixture-schema.ts';
import {
  SEASON_GAME_CALIBRATION_SEED_COUNT,
  SEASON_GAME_VALIDATION_SEED_COUNT,
  seasonGameCalibrationSeed,
  seasonGameCalibrate,
  seasonGameSimulate,
  type SeasonGameGameFacts,
  type SeasonGameCohortRunner,
} from './commands/season-game.ts';
import { UsageError } from './args.ts';
import {
  seasonGameCalibrateReportSchema,
  seasonGameSimulateReportSchema,
} from './report-schemas.ts';
import { jsonPayload, REPO_ROOT, runCli, withTmpDir } from './cli-test-helpers.ts';
const FIXTURES_DIR = join(REPO_ROOT, 'tools/cli/src/fixtures');
const ALL_FIXTURE_IDS = [
  'season-game-balanced',
  'season-game-tight',
  'season-game-bench-heavy',
  'season-game-foul-pressure',
  'season-game-pregame-unavailable',
  'season-game-injected-removal',
  'season-game-overtime',
  'season-game-no-legal-five',
  'season-game-no-legal-five-both',
];
function loadFixture(id: string) {
  return seasonGameFixtureSchema.parse(
    JSON.parse(readFileSync(join(FIXTURES_DIR, `${id}.json`), 'utf8')),
  );
}
describe('cli: committed season game fixtures', () => {
  it('every fixture is schema-valid with a matching id and legal roster', () => {
    for (const id of ALL_FIXTURE_IDS) {
      const fixture = loadFixture(id);
      expect(fixture.schemaVersion).toBe(1);
      expect(fixture.fixtureId).toBe(id);
      expect(fixture.description.length).toBeGreaterThan(0);
      const input = fixture.input;
      expect(input.schemaVersion).toBe(1);
      expect(input.gameNumber).toBeGreaterThanOrEqual(1);
      expect(input.gameNumber).toBeLessThanOrEqual(1230);
      expect(input.home.players).toHaveLength(10);
      expect(input.away.players).toHaveLength(10);
      const allPlayers = [...input.home.players, ...input.away.players];
      const versionIds = allPlayers.map((player) => player.playerVersionId);
      expect(new Set(versionIds).size).toBe(20);
      for (const player of allPlayers) {
        expect(player.playerVersionId).toMatch(/^pv-[0-9a-f]{32}$/);
      }
      expect(input.availability).toHaveLength(20);
      const availableIds = input.availability.map((entry) => entry.playerVersionId);
      expect(new Set(availableIds).size).toBe(20);
      for (const id2 of versionIds) expect(availableIds).toContain(id2);
    }
  });
});
function targetSecondsOf(rotation: SeasonRotation): Map<string, number> {
  return new Map(rotation.targetMinutes.map((row) => [row.playerVersionId, row.minutes * 60]));
}
function buildCompletedResult(input: SeasonGameSimulationInput): SeasonGameSimulationResult {
  const side = (team: SeasonGameTeamInput, rotation: SeasonRotation) => {
    const secondsOf = targetSecondsOf(rotation);
    return {
      teamId: team.teamId,
      displayName: team.displayName,
      franchiseId: team.franchiseId,
      score: team === input.home ? 100 : 95,
      periodScores: [25, 25, 25, 25],
      box: {
        points: team === input.home ? 100 : 95,
        fieldGoals: { made: 40, attempted: 85 },
        threes: { made: 8, attempted: 22 },
        freeThrows: { made: 12, attempted: 15 },
        rebounds: { total: 42, offensive: 10, defensive: 30, team: 2 },
        assists: 24,
        steals: 7,
        blocks: 5,
        turnovers: 13,
        fouls: 18,
        possessions: 96,
        diagnostics: {
          assistedFieldGoals: 28,
          unassistedFieldGoals: 12,
          reboundOpportunities: 90,
          contestedShots: 60,
        },
      },
      players: team.players.map((player) => {
        const seconds = secondsOf.get(player.playerVersionId) ?? 0;
        return {
          playerVersionId: player.playerVersionId,
          playerId: player.playerId,
          seconds,
          minutes: seconds / 60,
          points: 10,
          fieldGoals: { made: 4, attempted: 9 },
          threes: { made: 1, attempted: 3 },
          freeThrows: { made: 1, attempted: 2 },
          rebounds: { total: 4, offensive: 1, defensive: 3 },
          assists: 2,
          steals: 1,
          blocks: 0,
          turnovers: 1,
          fouls: 2,
          diagnostics: {
            usage: 20,
            shotZones: [{ zone: 'rim', attempts: 5, makes: 3 }],
            assistOpportunities: 8,
            offensiveReboundChances: 3,
            defensiveReboundChances: 6,
            contestedShots: 4,
          },
        };
      }),
      shotZones: [{ zone: 'rim', attempts: 10, makes: 6 }],
      returns: [],
    };
  };
  const result: SeasonGameSimulationResult = {
    schemaVersion: 1,
    outcome: 'completed',
    seed: input.seed,
    gameNumber: input.gameNumber,
    dataVersion: input.dataVersion,
    engineVersion: 'm3-engine-fixture',
    profileVersion: input.profile.profileVersion,
    winner: 'home',
    overtimePeriods: 0,
    home: side(input.home, input.homeRotation),
    away: side(input.away, input.awayRotation),
    substitutions: [],
    unitStints: [],
    deviations: [],
    foulOuts: [],
    removals: [],
  };
  seasonGameSimulationResultSchema.parse(result);
  return result;
}
describe('season game simulate (unit, injected doubles)', () => {
  it('completes a game with a validated payload and renders the score and minutes', () => {
    const simulate = vi.fn((input: SeasonGameSimulationInput) => buildCompletedResult(input));
    const check = vi.fn(() => []);
    const report = seasonGameSimulate(
      { input: 'season-game-balanced', seed: 'ab'.repeat(16) },
      { simulateSeasonGame: simulate, checkSeasonGameResult: check },
    );
    expect(report.exitCode).toBe(0);
    expect(report.failures).toEqual([]);
    const payload = seasonGameSimulateReportSchema.parse(report.payload);
    expect(payload.outcome).toBe('completed');
    expect(payload.winner).toBe('home');
    expect(payload.home.score).toBe(100);
    expect(payload.away.score).toBe(95);
    expect(payload.pass).toBe(true);
    expect(payload.playerMinutes).toHaveLength(20);
    expect(payload.gameVersion).toBe('season-game-v4');
    expect(payload.rotationVersion).toBe('season-rotation-v3');
    expect(simulate.mock.calls[0]?.[0].seed).toBe('ab'.repeat(16));
    expect(report.details[0]).toContain('Home Team 100 - 95 Away Team');
    expect(report.details.some((line) => line.includes('min actual/target'))).toBe(true);
    expect(report.details.some((line) => line.includes('substitutions:'))).toBe(true);
  });
  it('omitting --seed uses the fixture embedded seed', () => {
    const simulate = vi.fn((input: SeasonGameSimulationInput) => buildCompletedResult(input));
    seasonGameSimulate(
      { input: 'season-game-balanced', seed: null },
      { simulateSeasonGame: simulate, checkSeasonGameResult: () => [] },
    );
    expect(simulate.mock.calls[0]?.[0].seed).toBe('0'.repeat(32));
  });
  it('surfaces invariant failures with exit 1 and pass false', () => {
    const report = seasonGameSimulate(
      { input: 'season-game-balanced', seed: 'ab'.repeat(16) },
      {
        simulateSeasonGame: (input) => buildCompletedResult(input),
        checkSeasonGameResult: () => ['accounting: seconds do not reconcile'],
      },
    );
    expect(report.exitCode).toBe(1);
    const payload = seasonGameSimulateReportSchema.parse(report.payload);
    expect(payload.pass).toBe(false);
    expect(payload.invariantFailures).toEqual(['accounting: seconds do not reconcile']);
    expect(report.failures).toContain('accounting: seconds do not reconcile');
  });
  it('throws usage errors for missing input, bad seeds, and unknown fixtures', () => {
    expect(() => seasonGameSimulate({ input: null, seed: 'ab'.repeat(16) })).toThrow(UsageError);
    expect(() => seasonGameSimulate({ input: 'season-game-balanced', seed: 'not-hex' })).toThrow(
      UsageError,
    );
    expect(() =>
      seasonGameSimulate({ input: 'season-game-missing', seed: 'ab'.repeat(16) }),
    ).toThrow(UsageError);
  });
  it('resolves a fixture path directly through --input', () => {
    const path = join(FIXTURES_DIR, 'season-game-balanced.json');
    const simulate = vi.fn((input: SeasonGameSimulationInput) => buildCompletedResult(input));
    const report = seasonGameSimulate(
      { input: path, seed: 'ab'.repeat(16) },
      { simulateSeasonGame: simulate, checkSeasonGameResult: () => [] },
    );
    expect(report.exitCode).toBe(0);
    expect(seasonGameSimulateReportSchema.parse(report.payload).fixtureId).toBe(
      'season-game-balanced',
    );
  });
});
const PRESET_SECONDS: Record<
  SeasonRotationPreset,
  {
    starter: number;
    bench: number[];
  }
> = {
  balanced: { starter: 33 * 60, bench: [21, 18, 15, 12, 9].map((minutes) => minutes * 60) },
  tight: { starter: 37 * 60, bench: [20, 14, 9, 7, 5].map((minutes) => minutes * 60) },
  'bench-heavy': { starter: 29 * 60, bench: [23, 21, 19, 17, 15].map((minutes) => minutes * 60) },
};
const PRESET_BY_FIXTURE: Record<string, SeasonRotationPreset> = {
  'season-game-balanced': 'balanced',
  'season-game-tight': 'tight',
  'season-game-bench-heavy': 'bench-heavy',
};
function presetFact(fixtureId: string, seedIndex: number): SeasonGameGameFacts {
  const preset = PRESET_BY_FIXTURE[fixtureId] ?? 'balanced';
  const seconds = PRESET_SECONDS[preset];
  const benchRoles = seconds.bench;
  const starterPairs: number[] = [];
  for (let i = 0; i < 10; i += 1) starterPairs.push(seconds.starter);
  return {
    fixtureId,
    seedIndex,
    seed: seasonGameCalibrationSeed(seedIndex),
    outcome: 'completed',
    deterministic: true,
    checks: [],
    starterSeconds: starterPairs,
    benchSeconds: [...benchRoles, ...benchRoles],
    benchRoleSeconds: benchRoles.map((roleSeconds) => [roleSeconds, roleSeconds]),
    points: [100 + (seedIndex % 3) - 1, 100 - (seedIndex % 3) + 1],
    possessions: [95, 95],
  };
}
function fakeRunner(
  factory: (fixtureId: string, seedIndex: number) => SeasonGameGameFacts,
  options: {
    perturbSingleChunk?: (fact: SeasonGameGameFacts) => SeasonGameGameFacts;
  } = {},
): SeasonGameCohortRunner {
  return (request) => {
    const { fixtures, seedIndices, workers } = request;
    const chunkSize = Math.max(1, Math.ceil(seedIndices.length / workers));
    const facts: SeasonGameGameFacts[] = [];
    for (const fixture of fixtures) {
      for (let start = 0; start < seedIndices.length; start += chunkSize) {
        for (const index of seedIndices.slice(start, start + chunkSize)) {
          let fact = factory(fixture.fixtureId, index);
          if (workers === 1 && options.perturbSingleChunk !== undefined) {
            fact = options.perturbSingleChunk(fact);
          }
          facts.push(fact);
        }
      }
    }
    return Promise.resolve(facts);
  };
}
describe('season game calibrate (unit, injected doubles)', () => {
  it('passes all gates on the frozen cohort and writes the targets artifact', async () => {
    await withTmpDir(async (tmp) => {
      const targetsPath = join(tmp, 'game-targets-pass.json');
      const manifestBefore = readFileSync(
        join(REPO_ROOT, 'apps/web/static/data/manifest.json'),
        'utf8',
      );
      const report = await seasonGameCalibrate(
        { out: targetsPath, workers: '4' },
        { runCohort: fakeRunner(presetFact) },
      );
      expect(report.exitCode).toBe(0);
      const payload = seasonGameCalibrateReportSchema.parse(report.payload);
      expect(payload.calibrationSeedCount).toBe(SEASON_GAME_CALIBRATION_SEED_COUNT);
      expect(payload.validationSeedCount).toBe(SEASON_GAME_VALIDATION_SEED_COUNT);
      expect(payload.workers).toBe(4);
      expect(payload.fixtures).toHaveLength(3);
      expect(payload.fixtureStats).toHaveLength(3);
      for (const stat of payload.fixtureStats) {
        expect(stat.sample).toBe(SEASON_GAME_CALIBRATION_SEED_COUNT);
        expect(stat.failures.games).toBe(0);
        expect(stat.failures.checks).toBe(0);
        expect(stat.failures.determinism).toBe(0);
      }
      const byId = new Map(payload.fixtureStats.map((stat) => [stat.fixtureId, stat]));
      const balanced = byId.get('season-game-balanced');
      const tight = byId.get('season-game-tight');
      const benchHeavy = byId.get('season-game-bench-heavy');
      expect(tight?.starterSecondsMedian).toBeGreaterThan(balanced?.starterSecondsMedian ?? 0);
      expect(balanced?.starterSecondsMedian).toBeGreaterThan(benchHeavy?.starterSecondsMedian ?? 0);
      expect(benchHeavy?.benchSecondsMedian).toBeGreaterThan(balanced?.benchSecondsMedian ?? 0);
      expect(balanced?.benchSecondsMedian).toBeGreaterThan(tight?.benchSecondsMedian ?? 0);
      expect(payload.gates).toEqual({
        zeroFailures: true,
        starterOrdering: true,
        benchOrdering: true,
        benchRoleNonIncreasing: true,
        heldOutPassShare: 1,
        heldOutPass: true,
      });
      expect(payload.chunkingIndependent).toBe(true);
      expect(payload.targetsWritten).toBe(true);
      expect(payload.pass).toBe(true);
      const targets = seasonGameTargetsSchema.parse(JSON.parse(readFileSync(targetsPath, 'utf8')));
      expect(targets.fixtures.map((fixture) => fixture.fixtureId)).toEqual([
        'season-game-balanced',
        'season-game-tight',
        'season-game-bench-heavy',
      ]);
      expect(targets.gates.heldOutPass).toBe(true);
      expect(targets.gates.starterOrdering).toBe(true);
      expect(targets.calibration.calibrationSeedCount).toBe(SEASON_GAME_CALIBRATION_SEED_COUNT);
      expect(targets.calibration.validationSeedCount).toBe(SEASON_GAME_VALIDATION_SEED_COUNT);
      const manifestAfter = readFileSync(
        join(REPO_ROOT, 'apps/web/static/data/manifest.json'),
        'utf8',
      );
      expect(manifestAfter).toBe(manifestBefore);
    });
  });
  it('refuses to freeze when a preset fixture is missing from the selection', async () => {
    await withTmpDir(async (tmp) => {
      const report = await seasonGameCalibrate(
        { fixture: 'season-game-tight', out: join(tmp, 'game-targets-single.json') },
        { runCohort: fakeRunner(presetFact) },
      );
      const payload = seasonGameCalibrateReportSchema.parse(report.payload);
      expect(payload.fixtures).toHaveLength(1);
      expect(payload.gates.starterOrdering).toBe(false);
      expect(payload.gates.benchOrdering).toBe(false);
      expect(payload.pass).toBe(false);
      expect(payload.targetsWritten).toBe(false);
    });
  });
  it('throws usage errors for malformed ranges', async () => {
    await expect(
      seasonGameCalibrate(
        { 'seed-from': '5', 'seed-to': '1' },
        { runCohort: fakeRunner(presetFact) },
      ),
    ).rejects.toThrow(UsageError);
  });
});
const REAL_SEED = 'abcd2026a1b2c3d4e5f60718293a4b5c6';
describe('cli: season game simulate (end-to-end, real engine)', () => {
  it('runs the balanced fixture with a validated payload and zero failures', async () => {
    const { code, stdout } = await runCli([
      'season',
      'game',
      'simulate',
      '--input',
      'season-game-balanced',
      '--seed',
      REAL_SEED,
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const payload = seasonGameSimulateReportSchema.parse(jsonPayload(stdout));
    expect(payload.outcome).toBe('completed');
    expect(payload.pass).toBe(true);
    expect(payload.invariantFailures).toEqual([]);
    expect(payload.playerMinutes).toHaveLength(20);
    expect(payload.engineVersion).toMatch(/^m3-engine/);
  });
});
