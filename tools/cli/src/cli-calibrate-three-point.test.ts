import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { threePointReconstructionArtifactSchema } from '@hoop-rush/data-contracts';
import { threePointCalibrateReportSchema } from './report-schemas.ts';
import { jsonPayload, runCli, withTmpDir } from './cli-test-helpers.ts';
const CALIBRATE_TIMEOUT = 120000;
describe('cli: calibrate three-point', () => {
  it(
    'fits the cohort and emits a validated payload with all gates passing',
    async () => {
      const { code, stdout } = await runCli(['calibrate', 'three-point', '--format', 'json']);
      expect(code).toBe(0);
      const payload = threePointCalibrateReportSchema.parse(jsonPayload(stdout));
      expect(payload.artifactVersion).toBe('three-point-reconstruction-v1');
      expect(payload.written).toBe(false);
      expect(payload.gates.meanBiasNonPositiveAccuracy).toBe(true);
      expect(payload.gates.meanBiasNonPositiveTranslatedAttemptRate).toBe(true);
      expect(payload.gates.floorBelowEstablished).toBe(true);
      expect(payload.cohortSize.rows).toBeGreaterThan(0);
      expect(payload.cohortSize.accuracyRows).toBeGreaterThan(0);
      expect(payload.cohortSize.attemptRows).toBeGreaterThan(0);
      expect(payload.holdout.accuracy.bias).toBeLessThanOrEqual(0);
      expect(payload.holdout.translatedAttemptRateModern.bias).toBeLessThanOrEqual(0);
      expect(payload.holdout.translatedAttemptRateModern.samplePlayers).toBeGreaterThan(0);
      expect(payload.holdout.foldCount).toBeGreaterThan(1);
      expect(payload.floors.floor).toBeLessThan(0.32);
      expect(payload.generatedBy).toContain('calibrate three-point');
    },
    CALIBRATE_TIMEOUT,
  );
  it(
    'writes the artifact with --write and renders the default text report',
    async () => {
      await withTmpDir(async (tmp) => {
        const artifactPath = join(tmp, 'three-point-reconstruction-v1.json');
        const { code, stdout } = await runCli([
          'calibrate',
          'three-point',
          '--write',
          '--output',
          artifactPath,
        ]);
        expect(code).toBe(0);
        expect(stdout).toContain('calibrate three-point');
        expect(stdout).toContain('mean bias accuracy <= 0: PASS');
        expect(stdout).toContain('translated attempt rate (modern cohort) <= 0: PASS');
        expect(stdout).toContain(`written: ${artifactPath}`);
        const artifact = threePointReconstructionArtifactSchema.parse(
          JSON.parse(readFileSync(artifactPath, 'utf8')),
        );
        expect(artifact.artifactVersion).toBe('three-point-reconstruction-v1');
        expect(artifact.gates.meanBiasNonPositiveAccuracy).toBe(true);
        expect(artifact.gates.meanBiasNonPositiveTranslatedAttemptRate).toBe(true);
        expect(artifact.gates.floorBelowEstablished).toBe(true);
      });
    },
    CALIBRATE_TIMEOUT,
  );
});
