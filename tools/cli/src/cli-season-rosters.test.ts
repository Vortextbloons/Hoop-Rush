import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { seasonRunSchema } from '@hoop-rush/data-contracts';
import {
  seasonDraftReproduceReportSchema,
  seasonRostersAuditReportSchema,
  seasonRostersGenerateReportSchema,
} from './report-schemas.ts';
import { jsonPayload, REPO_ROOT, runCli, TMP } from './cli-test-helpers.ts';

/**
 * CLI integration tests for the M2.1 Season Run commands: `season draft
 * reproduce`, `season rosters generate`, and `season rosters audit` against
 * the committed fixtures (spec/2.0 M2.1). Calibration is covered by engine
 * tests plus the committed `roster-targets-v1` artifact; the full 256+64
 * cohort runs on demand.
 */

const DRAFT_COMMANDS = join(REPO_ROOT, 'tools/cli/src/fixtures/season-draft-commands.json');
const DRAFT_FINALIZED = join(REPO_ROOT, 'tools/cli/src/fixtures/season-draft-finalized.json');
const SEASON_RUN = join(REPO_ROOT, 'tools/cli/src/fixtures/season-run.json');
const SEED = 'd00d2026a1b2c3d4e5f60718293a4b5c6';

describe('cli: committed M2.1 fixtures', () => {
  it('season-run fixture is a schema-valid v4 snapshot with legal ownership', () => {
    const parsed = seasonRunSchema.parse(JSON.parse(readFileSync(SEASON_RUN, 'utf8')));
    expect(parsed.schemaVersion).toBe(4);
    expect(parsed.versions.runSchemaVersion).toBe(4);
    expect(parsed.versions.blockVersion).toBe('season-block-v1');
    expect(parsed.versions.gameVersion).toBe('season-game-v2');
    expect(parsed.versions.checkpointVersion).toBe('season-checkpoint-v1');
    expect(parsed.rosters).toHaveLength(30);
    expect(parsed.ownership).toHaveLength(300);
    expect(parsed.rotations).toHaveLength(30);
    expect(parsed.evaluations).toHaveLength(30);
    expect(parsed.aiAssignments).toHaveLength(30);
    const versions = parsed.ownership.map((o) => o.playerVersionId);
    expect(new Set(versions).size).toBe(300);
    expect(parsed.generationAudit.digest).toMatch(/^[0-9a-f]{32}$/);
  });

  it('draft-commands fixture is a valid reproduce input', () => {
    const parsed = JSON.parse(readFileSync(DRAFT_COMMANDS, 'utf8')) as {
      commands: unknown[];
      expected: { finalRevision: number };
    };
    expect(parsed.commands.length).toBeGreaterThan(20);
    expect(parsed.expected.finalRevision).toBeGreaterThan(20);
  });
});

describe('cli: season draft reproduce', () => {
  it('reproduces the committed fixture with the exact digest', async () => {
    const { code, stdout } = await runCli([
      'season',
      'draft',
      'reproduce',
      '--input',
      DRAFT_COMMANDS,
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const payload = seasonDraftReproduceReportSchema.parse(jsonPayload(stdout));
    expect(payload.pass).toBe(true);
    expect(payload.identical).toBe(true);
    expect(payload.finalDigest).toBe('d3439ffe629a113a96a6bc68f32e49ae');
    expect(payload.acceptedCount).toBe(payload.commandCount);
    expect(payload.rejectedCount).toBe(0);
    expect(payload.offers).toHaveLength(10);
    expect(payload.picks).toHaveLength(10);
  });

  it('rejects malformed inputs with a usage error', async () => {
    const bad = join(REPO_ROOT, 'tools/cli/src/fixtures/season-draft-finalized.json');
    const { code, stderr } = await runCli(['season', 'draft', 'reproduce', '--input', bad]);
    expect(code).toBe(2);
    expect(stderr).toContain('commands input fails the schema');
  });

  it('reports divergences with a nonzero exit', async () => {
    const fixture = JSON.parse(readFileSync(DRAFT_COMMANDS, 'utf8')) as {
      expected: { finalDigest: string; finalRevision: number };
    };

    const tmpPath = join(TMP, 'season-draft-commands.divergence.json');
    try {
      writeFileSync(
        tmpPath,
        JSON.stringify({
          ...fixture,
          expected: { finalDigest: '0'.repeat(32), finalRevision: fixture.expected.finalRevision },
        }),
      );
      const { code, stdout, stderr } = await runCli([
        'season',
        'draft',
        'reproduce',
        '--input',
        tmpPath,
        '--format',
        'json',
      ]);
      expect(code).toBe(1);
      const payload = seasonDraftReproduceReportSchema.parse(jsonPayload(stdout, stderr));
      expect(payload.identical).toBe(false);
      expect(payload.divergences.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmpPath, { force: true });
    }
  });
});

describe('cli: season rosters audit', () => {
  it('audits the committed fixture with zero failures', async () => {
    const { code, stdout } = await runCli([
      'season',
      'rosters',
      'audit',
      '--input',
      SEASON_RUN,
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const payload = seasonRostersAuditReportSchema.parse(jsonPayload(stdout));
    expect(payload.pass).toBe(true);
    expect(payload.auditFailures).toBe(0);
    expect(payload.digestVerified).toBe(true);
    expect(payload.teams).toBe(30);
    expect(payload.ownershipRows).toBe(300);
  });

  it('fails on a corrupted league with a nonzero exit', async () => {
    const tmpPath = join(TMP, 'season-run.corrupt.json');
    try {
      const parsed = JSON.parse(readFileSync(SEASON_RUN, 'utf8')) as {
        generationAudit: { digest: string };
      };
      // Schema-valid but tampered: the stored digest no longer matches the
      // canonical recomputation.
      parsed.generationAudit.digest = '0'.repeat(32);
      writeFileSync(tmpPath, JSON.stringify(parsed));
      const { code, stdout, stderr } = await runCli([
        'season',
        'rosters',
        'audit',
        '--input',
        tmpPath,
        '--format',
        'json',
      ]);
      expect(code).toBe(1);
      const payload = seasonRostersAuditReportSchema.parse(jsonPayload(stdout, stderr));
      expect(payload.pass).toBe(false);
      expect(payload.auditFailures).toBeGreaterThan(0);
      expect(payload.digestVerified).toBe(false);
    } finally {
      rmSync(tmpPath, { force: true });
    }
  });
});

describe('cli: season rosters generate', () => {
  it('previews a deterministic generation for the committed finalized draft', async () => {
    const { code, stdout } = await runCli([
      'season',
      'rosters',
      'generate',
      '--seed',
      SEED,
      '--draft',
      DRAFT_FINALIZED,
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const payload = seasonRostersGenerateReportSchema.parse(jsonPayload(stdout));
    expect(payload.pass).toBe(true);
    expect(payload.wrote).toBe(false);
    expect(payload.teams).toBe(30);
    expect(payload.ownershipRows).toBe(300);
    // The committed season-run fixture was generated from this exact seed.
    const fixture = JSON.parse(readFileSync(SEASON_RUN, 'utf8')) as {
      generationAudit: { digest: string };
    };
    expect(payload.digest).toBe(fixture.generationAudit.digest);
  });

  it('rejects a non-hex seed with a usage error', async () => {
    const { code, stderr } = await runCli([
      'season',
      'rosters',
      'generate',
      '--seed',
      'not-hex',
      '--draft',
      DRAFT_FINALIZED,
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain('--seed must be a hex seed');
  });
});
