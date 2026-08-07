import { describe, expect, it } from 'vitest';
import { REPO_ROOT, TMP, runCli } from './cli-test-helpers.ts';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { buildSeasonDraftCatalog, buildSeasonRotation } from '@hoop-rush/test-fixtures';
import type { SeasonDraftCandidate, SimulationPlayer } from '@hoop-rush/data-contracts';

/**
 * Projection milestone CLI tests: artifact derivation, single-lineup
 * projections, paired calibration cohorts, and benchmark timing.
 */

const EQUAL_FIXTURE = join(REPO_ROOT, 'tools/cli/src/fixtures/equal.json');
const MODEL = join(REPO_ROOT, 'apps/web/static/data/projection/projection-model.json');

function payloadOf(stdout: string): unknown {
  const start = stdout.indexOf('{');
  if (start < 0) throw new Error(`no JSON payload in output: ${stdout.slice(0, 400)}`);
  return JSON.parse(stdout.slice(start)) as unknown;
}

const JSON_FLAG = ['--format', 'json'];

describe('projection build', () => {
  it('derives the model artifact without writing', async () => {
    const { code, stdout } = await runCli(['projection', 'build', ...JSON_FLAG]);
    expect(code).toBe(0);
    const payload = payloadOf(stdout) as { details?: string[]; failures?: string[] };
    expect(payload.failures ?? []).toEqual([]);
    expect(payload.details?.join('\n')).toContain('7 era reference sets');
    expect(payload.details?.join('\n')).toContain('--write not set');
  });
});

describe('projection base', () => {
  it('projects a legal five against the neutral reference', async () => {
    const { code, stdout } = await runCli([
      'projection',
      'base',
      '--fixture',
      EQUAL_FIXTURE,
      '--era',
      '1990s',
      '--model',
      MODEL,
      ...JSON_FLAG,
    ]);
    expect(code).toBe(0);
    const payload = payloadOf(stdout) as {
      details?: string[];
      payload?: { ratings?: { offensiveRating: number; netRating: number } };
    };
    const details = payload.details?.join('\n') ?? '';
    expect(details).toContain('reference: ref-1990s-neutral');
    expect(details).toMatch(/offensive rating: \d+\.\d/);
    expect(details).toMatch(/net rating: -?\d+\.\d/);
    expect(details).toMatch(/projection digest: [0-9a-f]{32}/);
    const projected = payload.payload;
    expect(projected?.ratings?.offensiveRating).toBeGreaterThan(80);
  });

  it('fails cleanly on a missing fixture', async () => {
    const { code, stderr } = await runCli([
      'projection',
      'base',
      '--fixture',
      join(REPO_ROOT, 'does-not-exist.json'),
      '--era',
      '1990s',
      '--model',
      MODEL,
    ]);
    expect(code).not.toBe(0);
    expect(stderr).toContain('cannot read');
  });
});

describe('projection calibrate-base', () => {
  it('runs a deterministic dev cohort against the simulator', async () => {
    const first = await runCli([
      'projection',
      'calibrate-base',
      '--samples',
      '8',
      '--era',
      '1990s',
      '--model',
      MODEL,
      ...JSON_FLAG,
    ]);
    expect(first.code).toBe(0);
    const second = await runCli([
      'projection',
      'calibrate-base',
      '--samples',
      '8',
      '--era',
      '1990s',
      '--model',
      MODEL,
      ...JSON_FLAG,
    ]);
    expect(second.code).toBe(0);
    const a = payloadOf(first.stdout) as {
      payload?: { netRatingMae: number; netRatingBias: number; rankCorrelation: number };
    };
    const b = payloadOf(second.stdout) as {
      payload?: { netRatingMae: number; netRatingBias: number; rankCorrelation: number };
    };
    expect(a.payload?.netRatingMae).toBe(b.payload?.netRatingMae);
    expect(a.payload?.netRatingBias).toBe(b.payload?.netRatingBias);
    expect(a.payload?.rankCorrelation).toBe(b.payload?.rankCorrelation);
    expect(a.payload?.netRatingMae).toBeGreaterThanOrEqual(0);
  });
});

describe('projection validate', () => {
  it('runs the read-only held-out cohort', async () => {
    const { code, stdout } = await runCli([
      'projection',
      'validate',
      '--samples',
      '4',
      '--era',
      '1990s',
      '--model',
      MODEL,
      ...JSON_FLAG,
    ]);
    expect(code).toBe(0);
    const payload = payloadOf(stdout) as { command?: string };
    expect(payload.command).toBe('projection validate');
  });
});

describe('projection season', () => {
  function buildSeasonFixture(): void {
    const catalog = buildSeasonDraftCatalog({
      franchiseIds: ['lakers'],
      eras: ['2010s'],
      playersPerPool: 12,
    });
    const toPlayer = (candidate: SeasonDraftCandidate): SimulationPlayer => ({
      playerId: candidate.playerId,
      playerVersionId: candidate.playerVersionId,
      displayName: candidate.displayName,
      positions: candidate.positions.playable,
      heightInches: candidate.heightInches,
      weightLbs: candidate.weightLbs,
      ratings: candidate.detailedRatings,
      tendencies: candidate.tendencies,
      anchors: candidate.anchors,
      reconstructedThreePoint: candidate.reconstructedThreePoint,
    });
    const pool = catalog.candidates.slice(0, 12).map((candidate) => toPlayer(candidate));
    const canPlay = (player: SimulationPlayer, group: 'G' | 'F' | 'C') =>
      group === 'G'
        ? player.positions.includes('PG') || player.positions.includes('SG')
        : group === 'F'
          ? player.positions.includes('SF') || player.positions.includes('PF')
          : player.positions.includes('C');
    const guards = pool.filter((player) => canPlay(player, 'G'));
    const forwards = pool.filter((player) => canPlay(player, 'F'));
    const centers = pool.filter((player) => canPlay(player, 'C'));
    const used = new Set<string>();
    const pick = (list: SimulationPlayer[], index: number) => {
      for (const player of list.slice(index)) {
        const id = player.playerVersionId ?? player.playerId;
        if (used.has(id)) continue;
        used.add(id);
        return player;
      }
      throw new Error('not enough unique position players');
    };
    const starters = [
      pick(guards, 0),
      pick(guards, 1),
      pick(forwards, 0),
      pick(forwards, 1),
      pick(centers, 0),
    ];
    const bench = [
      pick(guards, 2),
      pick(forwards, 2),
      pick(centers, 1),
      pick(guards, 3),
      pick(forwards, 3),
    ];
    const rotation = buildSeasonRotation(
      'lakers',
      [...starters, ...bench].map((player) => player.playerVersionId ?? ''),
    );
    writeFileSync(
      join(TMP, 'season-project.json'),
      JSON.stringify({ roster: [...starters, ...bench], rotation }),
    );
  }

  it('projects a ten-player roster with its rotation', async () => {
    buildSeasonFixture();
    const { code, stdout } = await runCli([
      'projection',
      'season',
      '--fixture',
      join(TMP, 'season-project.json'),
      '--era',
      '2010s',
      '--model',
      MODEL,
      ...JSON_FLAG,
    ]);
    expect(code).toBe(0);
    const payload = payloadOf(stdout) as {
      details?: string[];
      payload?: {
        metrics?: { netRating: number; contingencyDepth: number };
        units?: Array<{ kind: string }>;
      };
    };
    const details = payload.details?.join('\n') ?? '';
    expect(details).toContain('weighted net rating:');
    expect(details).toMatch(/projection digest: [0-9a-f]{32}/);
    expect(payload.payload?.metrics?.contingencyDepth).toBeGreaterThan(0);
    expect(payload.payload?.units?.filter((unit) => unit.kind === 'matchup')).toHaveLength(4);
  });
});

describe('projection benchmark', () => {
  it('reports base-projection timings', async () => {
    const { code, stdout } = await runCli([
      'projection',
      'benchmark',
      '--samples',
      '8',
      '--era',
      '1990s',
      '--model',
      MODEL,
      ...JSON_FLAG,
    ]);
    expect(code).toBe(0);
    const payload = payloadOf(stdout) as { payload?: { median: number; p95: number } };
    expect(payload.payload?.median).toBeGreaterThan(0);
    expect(payload.payload?.p95).toBeGreaterThanOrEqual(payload.payload?.median ?? 0);
  });
});
