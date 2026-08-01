import { makeReport, type CliReport } from '../report.js';

export const HELP_TEXT = `hoop-rush — developer CLI for the Hoop Rush engine and data

Usage:
  pnpm hoop-rush <command> [options]

Commands:
  data validate   Validate the Hoop Rush manifest, lineage, eras, and pools.
                  --input <path>   Manifest path (default apps/web/static/data/manifest.json)
                  --format text|json (default text)
                  --verbose        Show per-pool hash verification details
  help            Show this help

Common options:
  --format text|json
  --verbose
`;

export function helpCommand(): CliReport {
  return makeReport('help', {}, { details: [HELP_TEXT.trimEnd()] });
}
