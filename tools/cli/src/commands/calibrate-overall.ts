import { ratings } from '@hoop-rush/importer';
import { makeReport, type CliReport } from '../report.ts';

export const CALIBRATE_OVERALL_OPTIONS: Record<string, boolean> = { output: true, format: true };

export function calibrateOverall(output?: string): CliReport {
  try {
    const scale = ratings.calibrateOverallScale(output);
    return makeReport(
      'calibrate overall',
      { output: output ?? 'packaged ratings-model.json' },
      {
        details: [
          `froze ${scale.version}: ${String(scale.reference.sampleCount)} unique qualified seasons, ${String(scale.knots.length)} score thresholds`,
        ],
      },
    );
  } catch (error) {
    return makeReport(
      'calibrate overall',
      { output },
      { failures: [(error as Error).message], exitCode: 1 },
    );
  }
}
