/** Stable CLI report contracts and exit codes (spec/09). */

export const EXIT_OK = 0;
export const EXIT_CHECKS_FAILED = 1;
export const EXIT_USAGE_OR_DATA_ERROR = 2;

export type ExitCode = 0 | 1 | 2;

export interface CliReport {
  schemaVersion: 1;
  command: string;
  ok: boolean;
  exitCode: ExitCode;
  input: Record<string, unknown>;
  details: string[];
  failures: string[];
  payload?: unknown;
}

export function makeReport(
  command: string,
  input: Record<string, unknown>,
  opts: { failures?: string[]; details?: string[]; exitCode?: ExitCode; payload?: unknown } = {},
): CliReport {
  const failures = opts.failures ?? [];
  const details = opts.details ?? [];
  const exitCode = opts.exitCode ?? (failures.length === 0 ? EXIT_OK : EXIT_CHECKS_FAILED);
  return {
    schemaVersion: 1,
    command,
    ok: failures.length === 0,
    exitCode,
    input,
    details,
    failures,
    ...(opts.payload === undefined ? {} : { payload: opts.payload }),
  };
}

export function renderText(report: CliReport): string {
  const lines = [`${report.command}: ${report.ok ? 'OK' : 'FAILED'}`];
  for (const detail of report.details) lines.push(`  ${detail}`);
  for (const failure of report.failures) lines.push(`  FAIL ${failure}`);
  return lines.join('\n');
}

export function renderJson(report: CliReport): string {
  return JSON.stringify(report, null, 2);
}
