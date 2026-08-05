import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  SEASON_ROTATION_PRESET_TARGETS,
  SEASON_ROTATION_VERSION,
  seasonGameSimulationResultSchema,
  seasonGameTargetsSchema,
  seasonRotationPresetSchema,
  slotGroupOf,
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

/**
 * M2.2 `season game` CLI tests: committed fixture validity, unit tests with
 * injected engine doubles (argument parsing, output rendering, report
 * schemas, calibrate gate math, worker-count independence), and end-to-end
 * `runCli` journeys against the real engine runtime.
 */

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
const PRESET_FIXTURE_IDS = [
  'season-game-balanced',
  'season-game-tight',
  'season-game-bench-heavy',
] as const;

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
      // Availability covers every rostered version exactly once.
      expect(input.availability).toHaveLength(20);
      const availableIds = input.availability.map((entry) => entry.playerVersionId);
      expect(new Set(availableIds).size).toBe(20);
      for (const id2 of versionIds) expect(availableIds).toContain(id2);
    }
  });

  it('preset fixtures use v2 rotations with the frozen preset targets totaling 240', () => {
    for (const id of PRESET_FIXTURE_IDS) {
      const fixture = loadFixture(id);
      const preset = fixture.preset;
      expect(preset).toBeDefined();
      const targets = SEASON_ROTATION_PRESET_TARGETS[preset as SeasonRotationPreset];
      for (const rotation of [fixture.input.homeRotation, fixture.input.awayRotation]) {
        expect(rotation.rotationVersion).toBe(SEASON_ROTATION_VERSION);
        expect(rotation.starters).toHaveLength(5);
        expect(rotation.benchOrder).toHaveLength(5);
        expect(rotation.closingFive).toHaveLength(5);
        const minutes = rotation.targetMinutes.map((row) => row.minutes);
        expect(minutes.reduce((sum, value) => sum + value, 0)).toBe(240);
        const starterSet = new Set(rotation.starters);
        const benchRoleByVersion = new Map(
          rotation.benchOrder.map((playerVersionId, index) => [playerVersionId, index + 1]),
        );
        for (const row of rotation.targetMinutes) {
          const role = starterSet.has(row.playerVersionId)
            ? 0
            : benchRoleByVersion.get(row.playerVersionId);
          expect(role).toBeDefined();
          const expected = role === 0 ? targets.starters : (targets.bench[(role ?? 1) - 1] ?? 0);
          expect(row.minutes).toBe(expected);
        }
      }
    }
  });

  it('every roster can field a legal G,G,F,F,C five from its starters', () => {
    for (const id of ALL_FIXTURE_IDS) {
      const input = loadFixture(id).input;
      for (const team of [input.home, input.away]) {
        const rotation = team === input.home ? input.homeRotation : input.awayRotation;
        const slots = team.players
          .filter((player) => rotation.starters.includes(player.playerVersionId))
          .map((player) => player.positions.map(slotGroupOf));
        const covered = new Set(slots.flat());
        expect(covered.has('G')).toBe(true);
        expect(covered.has('F')).toBe(true);
        expect(covered.has('C')).toBe(true);
      }
    }
  });

  it('scenario fixtures carry their intended availability, removals, and foul traits', () => {
    const foulPressure = loadFixture('season-game-foul-pressure').input;
    for (const player of [...foulPressure.home.players, ...foulPressure.away.players]) {
      expect(player.tendencies.foulRate).toBe(45);
    }
    const unavailable = loadFixture('season-game-pregame-unavailable').input;
    const unavailablePlayers = unavailable.availability.filter((entry) => !entry.available);
    expect(unavailablePlayers).toHaveLength(2);
    const homeUnavailable = unavailablePlayers.find((entry) =>
      unavailable.home.players.some((p) => p.playerVersionId === entry.playerVersionId),
    );
    const awayUnavailable = unavailablePlayers.find((entry) =>
      unavailable.away.players.some((p) => p.playerVersionId === entry.playerVersionId),
    );
    expect(homeUnavailable).toBeDefined();
    expect(awayUnavailable).toBeDefined();
    if (homeUnavailable !== undefined) {
      expect(unavailable.homeRotation.starters).toContain(homeUnavailable.playerVersionId);
    }
    if (awayUnavailable !== undefined) {
      expect(unavailable.awayRotation.starters).toContain(awayUnavailable.playerVersionId);
    }
    const removal = loadFixture('season-game-injected-removal').input;
    expect(removal.removals).toHaveLength(2);
    for (const entry of removal.removals) {
      expect(entry.reason).toBe('injected-injury-removal');
      expect(
        [...removal.home.players, ...removal.away.players].map((p) => p.playerVersionId),
      ).toContain(entry.playerVersionId);
    }
    const overtime = loadFixture('season-game-overtime').input;
    expect(overtime.seed).not.toBe('0'.repeat(32));
    const noLegalFive = loadFixture('season-game-no-legal-five').input;
    const homeAvailable = noLegalFive.availability.filter(
      (entry) =>
        entry.available &&
        noLegalFive.home.players.some((p) => p.playerVersionId === entry.playerVersionId),
    );
    expect(homeAvailable).toHaveLength(3);
    const both = loadFixture('season-game-no-legal-five-both').input;
    const homeAvailableBoth = both.availability.filter(
      (entry) =>
        entry.available &&
        both.home.players.some((p) => p.playerVersionId === entry.playerVersionId),
    );
    const awayAvailableBoth = both.availability.filter(
      (entry) =>
        entry.available &&
        both.away.players.some((p) => p.playerVersionId === entry.playerVersionId),
    );
    expect(homeAvailableBoth).toHaveLength(3);
    expect(awayAvailableBoth).toHaveLength(3);
  });

  it('non-preset fixtures omit the preset field', () => {
    for (const id of ALL_FIXTURE_IDS) {
      if (PRESET_FIXTURE_IDS.includes(id as (typeof PRESET_FIXTURE_IDS)[number])) continue;
      const fixture = loadFixture(id);
      expect(fixture.preset).toBeUndefined();
      expect(seasonRotationPresetSchema.safeParse(fixture.preset).success).toBe(false);
    }
  });
});

// ---- injected doubles -------------------------------------------------------

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

function buildForfeitResult(input: SeasonGameSimulationInput): SeasonGameSimulationResult {
  const result: SeasonGameSimulationResult = {
    schemaVersion: 1,
    outcome: 'forfeit',
    seed: input.seed,
    gameNumber: input.gameNumber,
    dataVersion: input.dataVersion,
    engineVersion: 'm3-engine-fixture',
    profileVersion: input.profile.profileVersion,
    winner: 'away',
    losingFranchiseId: input.home.franchiseId,
    trigger: 'no-legal-five-tipoff',
    homeScore: 2,
    awayScore: 0,
  };
  seasonGameSimulationResultSchema.parse(result);
  return result;
}

function buildNoLegalFiveBothResult(input: SeasonGameSimulationInput): SeasonGameSimulationResult {
  const result: SeasonGameSimulationResult = {
    schemaVersion: 1,
    outcome: 'no-legal-five-both',
    seed: input.seed,
    gameNumber: input.gameNumber,
    dataVersion: input.dataVersion,
    engineVersion: 'm3-engine-fixture',
    profileVersion: input.profile.profileVersion,
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
    expect(payload.gameVersion).toBe('season-game-v2');
    expect(payload.rotationVersion).toBe('season-rotation-v2');
    // The double received the overridden seed, not the fixture placeholder.
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

  it('reports a forfeit with the official 2-0 line (double)', () => {
    const input = loadFixture('season-game-no-legal-five');
    const forfeit = buildForfeitResult(input.input);
    const report = seasonGameSimulate(
      { input: 'season-game-no-legal-five', seed: 'cd'.repeat(16) },
      { simulateSeasonGame: () => forfeit, checkSeasonGameResult: () => [] },
    );
    expect(report.exitCode).toBe(0);
    const payload = seasonGameSimulateReportSchema.parse(report.payload);
    expect(payload.outcome).toBe('forfeit');
    expect(payload.home.score).toBe(2);
    expect(payload.away.score).toBe(0);
    expect(payload.forfeit).toEqual({
      losingFranchiseId: 'lakers',
      trigger: 'no-legal-five-tipoff',
    });
    expect(report.details[0]).toContain('2 - 0');
    expect(report.details[0]).toContain('forfeit');
  });

  it('reports the no-legal-five-both variant without scores', () => {
    const input = loadFixture('season-game-no-legal-five-both');
    const report = seasonGameSimulate(
      { input: 'season-game-no-legal-five-both', seed: 'ef'.repeat(16) },
      {
        simulateSeasonGame: () => buildNoLegalFiveBothResult(input.input),
        checkSeasonGameResult: () => [],
      },
    );
    expect(report.exitCode).toBe(0);
    const payload = seasonGameSimulateReportSchema.parse(report.payload);
    expect(payload.outcome).toBe('no-legal-five-both');
    expect(payload.winner).toBeNull();
    expect(payload.home.score).toBeNull();
    expect(payload.away.score).toBeNull();
    expect(payload.forfeit).toBeNull();
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

// ---- calibrate gate math with controlled doubles ---------------------------

const PRESET_SECONDS: Record<SeasonRotationPreset, { starter: number; bench: number[] }> = {
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

/** Chunked runner with the same chunking as the real worker path; optionally
 * perturbs single-chunk (workers === 1) runs to exercise the probe. */
function fakeRunner(
  factory: (fixtureId: string, seedIndex: number) => SeasonGameGameFacts,
  options: { perturbSingleChunk?: (fact: SeasonGameGameFacts) => SeasonGameGameFacts } = {},
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
      // A --out override must not touch the committed manifest.
      const manifestAfter = readFileSync(
        join(REPO_ROOT, 'apps/web/static/data/manifest.json'),
        'utf8',
      );
      expect(manifestAfter).toBe(manifestBefore);
    });
  });

  it('worker counts never change aggregates (1 vs 4 workers)', async () => {
    await withTmpDir(async (tmp) => {
      const run = async (workers: string) => {
        const report = await seasonGameCalibrate(
          { workers, out: join(tmp, `game-targets-workers-${workers}.json`) },
          { runCohort: fakeRunner(presetFact) },
        );
        return seasonGameCalibrateReportSchema.parse(report.payload);
      };
      const one = await run('1');
      const four = await run('4');
      expect(four.fixtureStats).toEqual(one.fixtureStats);
      expect(four.gates).toEqual(one.gates);
      expect(four.chunkingIndependent).toBe(true);
    });
  });

  it('fails the bench ordering gate when the bench-heavy fixture benches little', async () => {
    await withTmpDir(async (tmp) => {
      const factory = (fixtureId: string, seedIndex: number): SeasonGameGameFacts => {
        const fact = presetFact(fixtureId, seedIndex);
        if (fixtureId === 'season-game-bench-heavy') {
          const benchRole: number[][] = [];
          const benchSeconds: number[] = [];
          for (let i = 0; i < 5; i += 1) {
            benchRole.push([300, 300]);
            benchSeconds.push(300, 300);
          }
          return {
            ...fact,
            benchSeconds,
            benchRoleSeconds: benchRole,
          };
        }
        return fact;
      };
      const report = await seasonGameCalibrate(
        { out: join(tmp, 'game-targets-ordering.json') },
        { runCohort: fakeRunner(factory) },
      );
      expect(report.exitCode).toBe(1);
      const payload = seasonGameCalibrateReportSchema.parse(report.payload);
      expect(payload.gates.benchOrdering).toBe(false);
      expect(payload.gates.starterOrdering).toBe(true);
      expect(payload.pass).toBe(false);
      expect(payload.targetsWritten).toBe(false);
      expect(
        report.failures.some(
          (failure) =>
            failure.includes('benchOrdering') || failure.includes('bench second medians'),
        ),
      ).toBe(true);
    });
  });

  it('fails the held-out gate when validation points leave the envelopes', async () => {
    await withTmpDir(async (tmp) => {
      const factory = (fixtureId: string, seedIndex: number): SeasonGameGameFacts => {
        const fact = presetFact(fixtureId, seedIndex);
        if (seedIndex >= SEASON_GAME_CALIBRATION_SEED_COUNT) {
          return { ...fact, points: [150, 149] };
        }
        return fact;
      };
      const report = await seasonGameCalibrate(
        { out: join(tmp, 'game-targets-heldout.json') },
        { runCohort: fakeRunner(factory) },
      );
      const payload = seasonGameCalibrateReportSchema.parse(report.payload);
      expect(payload.gates.heldOutPassShare).toBeLessThan(0.95);
      expect(payload.gates.heldOutPass).toBe(false);
      expect(payload.pass).toBe(false);
      expect(payload.targetsWritten).toBe(false);
    });
  });

  it('fails the zero-failures gate on check failures and determinism divergences', async () => {
    await withTmpDir(async (tmp) => {
      const factory = (fixtureId: string, seedIndex: number): SeasonGameGameFacts => {
        const fact = presetFact(fixtureId, seedIndex);
        if (seedIndex === 5) return { ...fact, checks: ['legality: unavailable player on court'] };
        if (seedIndex === 7) return { ...fact, deterministic: false };
        return fact;
      };
      const report = await seasonGameCalibrate(
        { out: join(tmp, 'game-targets-zerofailures.json') },
        { runCohort: fakeRunner(factory) },
      );
      const payload = seasonGameCalibrateReportSchema.parse(report.payload);
      expect(payload.gates.zeroFailures).toBe(false);
      expect(payload.pass).toBe(false);
      const stat = payload.fixtureStats.find((entry) => entry.fixtureId === 'season-game-balanced');
      expect(stat?.failures.games).toBe(2);
      expect(stat?.failures.checks).toBe(1);
      expect(stat?.failures.determinism).toBe(1);
    });
  });

  it('detects worker-count dependence through the chunking probe', async () => {
    await withTmpDir(async (tmp) => {
      const perturb = (fact: SeasonGameGameFacts): SeasonGameGameFacts => ({
        ...fact,
        starterSeconds: [
          ...fact.starterSeconds.slice(0, 1).map((seconds) => seconds + 60),
          ...fact.starterSeconds.slice(1),
        ],
      });
      const report = await seasonGameCalibrate(
        { out: join(tmp, 'game-targets-chunking.json') },
        { runCohort: fakeRunner(presetFact, { perturbSingleChunk: perturb }) },
      );
      const payload = seasonGameCalibrateReportSchema.parse(report.payload);
      expect(payload.chunkingIndependent).toBe(false);
      expect(payload.pass).toBe(false);
      expect(payload.targetsWritten).toBe(false);
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

  it('honors explicit seed ranges and fails the held-out gate with none', async () => {
    await withTmpDir(async (tmp) => {
      const report = await seasonGameCalibrate(
        {
          'seed-from': '0',
          'seed-to': '63',
          out: join(tmp, 'game-targets-range.json'),
        },
        { runCohort: fakeRunner(presetFact) },
      );
      const payload = seasonGameCalibrateReportSchema.parse(report.payload);
      expect(payload.calibrationSeedCount).toBe(64);
      expect(payload.validationSeedCount).toBe(0);
      expect(payload.gates.heldOutPassShare).toBe(0);
      expect(payload.gates.heldOutPass).toBe(false);
      expect(payload.pass).toBe(false);
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

// ---- end-to-end against the real engine runtime ----------------------------

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

  it('is reproducible: the same fixture and seed produce the same score', async () => {
    const run = async () => {
      const { code, stdout } = await runCli([
        'season',
        'game',
        'simulate',
        '--input',
        'season-game-tight',
        '--seed',
        REAL_SEED,
        '--format',
        'json',
      ]);
      expect(code).toBe(0);
      const payload = seasonGameSimulateReportSchema.parse(jsonPayload(stdout));
      return `${String(payload.home.score)}-${String(payload.away.score)}`;
    };
    expect(await run()).toBe(await run());
  });
});

describe('cli: season game calibrate (end-to-end, real engine)', () => {
  it('runs a small cohort through workers and reports non-freezable gates', async () => {
    await withTmpDir(async (tmp) => {
      const { code, stdout, stderr } = await runCli([
        'season',
        'game',
        'calibrate',
        '--fixture',
        'season-game-balanced,season-game-tight,season-game-bench-heavy',
        '--seed-from',
        '0',
        '--seed-to',
        '15',
        '--workers',
        '2',
        '--out',
        join(tmp, 'game-targets-e2e.json'),
        '--format',
        'json',
      ]);
      // 16 calibration seeds with no held-out seeds: the held-out gate fails.
      expect(code).toBe(1);
      const payload = seasonGameCalibrateReportSchema.parse(jsonPayload(stdout, stderr));
      expect(payload.fixtures).toHaveLength(3);
      expect(payload.calibrationSeedCount).toBe(16);
      expect(payload.validationSeedCount).toBe(0);
      expect(payload.fixtureStats).toHaveLength(3);
      expect(payload.gates.zeroFailures).toBe(true);
      expect(payload.gates.heldOutPass).toBe(false);
      expect(payload.pass).toBe(false);
      expect(payload.targetsWritten).toBe(false);
      expect(payload.workers).toBe(2);
    });
  }, 120_000);
});
