import { pickU, s } from './core.ts';
import { hasOption, parseOption } from '../args.ts';
import { dataCoverage } from '../commands/data-coverage.ts';
import { defenseBpmCorrelation } from '../commands/data-defense-bpm-correlation.ts';
import { dataDerive } from '../commands/data-derive.ts';
import { dataLineageAudit } from '../commands/data-lineage-audit.ts';
import { DEFAULT_MANIFEST } from '../commands/data-loader.ts';
import { dataOverallsAudit } from '../commands/data-overalls-audit.ts';
import { dataOverallsCompare } from '../commands/data-overalls-compare.ts';
import { dataOverallsDistribution } from '../commands/data-overalls-distribution.ts';
import { dataOveralls } from '../commands/data-overalls.ts';
import { dataPositionsCoverage } from '../commands/data-positions-coverage.ts';
import { dataValidate } from '../commands/data-validate.ts';

import type { CommandSpec } from './core.ts';

export const dataCommands: CommandSpec[] = [
  {
    name: 'data validate',
    options: { input: 'string' },
    help: `  data validate          Validate the manifest, lineage, eras, pools, era
                         simulation profiles, and opponent artifacts.
                         --input <path>   Manifest path (default apps/web/static/data/manifest.json)
                         --verbose        Show per-artifact hash verification details`,
    run: (args) => {
      const input = parseOption(args, 'input', DEFAULT_MANIFEST);
      return dataValidate(input, hasOption(args, 'verbose'));
    },
  },
  {
    name: 'data overalls-compare',
    options: {
      input: 'string',
      baseline: 'string',
      output: 'string',
      'allow-input-changes': 'flag',
    },
    help: `  data overalls-compare  Compare a saved baseline with the current packaged pools.
                          --baseline <path> --output <path>`,
    run: (args) =>
      dataOverallsCompare({
        input: parseOption(args, 'input', DEFAULT_MANIFEST),
        baseline: s(args, 'baseline'),
        output: s(args, 'output'),
        allowInputChanges: hasOption(args, 'allow-input-changes'),
      }),
  },
  {
    name: 'data overalls',
    options: {
      input: 'string',
      franchise: 'string',
      era: 'string',
      player: 'string',
      limit: 'string',
    },
    help: `  data overalls          Show packaged detailed, summary, and selection Overalls.
                          --franchise <id> Filter by franchise id
                          --era <id>       Filter by era id
                          --player <text>  Filter by player name
                          --limit <n>      Maximum rows (default 50, max 1000)`,
    run: (args) =>
      dataOveralls({
        input: parseOption(args, 'input', DEFAULT_MANIFEST),
        franchise: s(args, 'franchise'),
        era: s(args, 'era'),
        player: s(args, 'player'),
        limit: s(args, 'limit'),
      }),
  },
  {
    name: 'data overalls-distribution',
    options: { input: 'string' },
    help: `  data overalls-distribution
                         Frozen-scale Overall distribution over every
                         packaged franchise-era row: band counts/percentages
                         vs reference targets, medians, min/max, and per-era breakdowns.
                          --input <path>   Manifest path (default apps/web/static/data/manifest.json)`,
    run: (args) =>
      dataOverallsDistribution({ input: parseOption(args, 'input', DEFAULT_MANIFEST) }),
  },
  {
    name: 'data overalls-audit',
    options: { input: 'string' },
    help: `  data overalls-audit    Raw vs canonical vs final Overall audit: raw
                         distribution, minutes-floor violations (>=1500 min
                         below 60 Overall), low-confidence 97+ flags, canonical
                         stretch, and year-over-year cliffs (>=15).
                          --input <path>   Manifest path (default apps/web/static/data/manifest.json)`,
    run: (args) => dataOverallsAudit({ input: parseOption(args, 'input', DEFAULT_MANIFEST) }),
  },
  {
    name: 'data positions-coverage',
    options: { input: 'string' },
    help: `  data positions-coverage
                         Primary/playable/source-label coverage by era.
                         Fails when PG primaries are zero or PF primaries
                         are below 1% (source labels collapse PG/PF).
                          --input <path>   Manifest path (default apps/web/static/data/manifest.json)`,
    run: (args) => dataPositionsCoverage({ input: parseOption(args, 'input', DEFAULT_MANIFEST) }),
  },
  {
    name: 'data defense-bpm-correlation',
    options: { input: 'string' },
    help: `  data defense-bpm-correlation
                         Pearson correlation between packaged defenseRating
                         and the raw source season box plus/minus (matched by
                         playerExternalId and season). Passes when the sample
                         is >= 1000 rows and r <= 0.92.
                          --input <path>   Manifest path (default apps/web/static/data/manifest.json)`,
    run: (args) => defenseBpmCorrelation({ input: parseOption(args, 'input', DEFAULT_MANIFEST) }),
  },
  {
    name: 'data coverage',
    options: { input: 'string', franchise: 'string', era: 'string', status: 'string' },
    help: `  data coverage          Field availability, provenance, confidence, and playable
                         status by season, era, franchise, and pool.
                          --input <path>   Manifest path (default apps/web/static/data/manifest.json)
                          --franchise <id> --era <id> --status <available|unavailable>`,
    run: (args) =>
      dataCoverage({
        input: parseOption(args, 'input', DEFAULT_MANIFEST),
        franchise: s(args, 'franchise'),
        era: s(args, 'era'),
        status: s(args, 'status'),
      }),
  },
  {
    name: 'data lineage-audit',
    options: { input: 'string', 'verify-logos': 'flag' },
    help: `  data lineage-audit     Prove lineage ranges map to exactly one slot, detect
                         gaps/overlaps/duplicates, verify pool ownership and
                         per-segment historical logo metadata.
                          --input <path>   Manifest path (default apps/web/static/data/manifest.json)
                          --verify-logos   Fetch each segment's primary logo candidate`,
    run: (args) =>
      dataLineageAudit({
        input: parseOption(args, 'input', DEFAULT_MANIFEST),
        verifyLogos: hasOption(args, 'verify-logos'),
      }),
  },
  {
    name: 'data derive',
    options: { player: 'string', season: 'string', franchise: 'string' },
    help: `  data derive            Reproduce one player-season's complete derivation trace:
                         source inputs, field-method registry, priors, shrinkage,
                         unclamped values, and version boundaries.
                          --player <id> --season <2024-25> --franchise <id>`,
    run: (args) => dataDerive(pickU(args, ['player', 'season', 'franchise'])),
  },
];
