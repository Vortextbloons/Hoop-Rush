import { makeReport, type CliReport } from '../report.js';
import { listFixtureIds } from './sim.js';

export const HELP_TEXT = `hoop-rush — developer CLI for the Hoop Rush engine and data

Usage:
  pnpm hoop-rush <command> [options]

Commands:
  data validate          Validate the manifest, lineage, eras, pools, era
                         simulation profiles, and opponent artifacts.
                         --input <path>   Manifest path (default apps/web/static/data/manifest.json)
                         --verbose        Show per-artifact hash verification details
  data overalls          Show packaged detailed, summary, and selection Overalls.
                         --franchise <id> Filter by franchise id
                         --era <id>       Filter by era id
                         --player <text>  Filter by player name
                         --limit <n>      Maximum rows (default 50, max 1000)
  sim game               Simulate one game from a fixture with an explicit seed.
                         --input <fixture-id>   equal|strong-medium|strong-weak (default none)
                         --seed <hex>           Explicit game seed (required)
                         --profile <path>       Override the packaged 1990s era profile
  sim batch              Run seeded games over a deterministic seed range.
                         --fixture <id>         Fixture id (default equal)
                         --seed-from N --seed-to N   Inclusive seed range
                         --samples N           Convenience for seed-to = seed-from + N - 1
                         --workers N           Chunks; results never depend on the count
  sim challenge          Run one complete 82-game challenge against the frozen bracket.
                         --lineup <fixture-id|team.json>  User five (default challenge-user)
                         --seed <hex>          Run seed (required)
                         --profile <path>      Override the packaged 1990s era profile
                         --bracket <path>      Override the packaged bracket artifact
  bracket audit          Validate the frozen 30-team bracket and 82-game schedule:
                         schema/hash/versions, legal balanced lineups, duplicates,
                         strength percentiles and median, schedule counts and repeats,
                         opening opponent unchanged, and schedule regeneration.
                         --input <path>   Manifest path (default apps/web/static/data/manifest.json)
  bracket generate       (dev) Author the frozen bracket from packaged NBA data and
                         commit it with the manifest. Deterministic under --seed.
                         --seed <hex> --proposals N --samples N --min-score N
  benchmark              Measure pool cold/cached, warm single-game, and 82-game throughput.
                         --fixture <id> (default equal) --samples N (default 50)
                         --seed-from N --workers N
                         --baseline <path> Compare matched fingerprints at 125% + noise.
                         --write-baseline <path> Write a versioned JSON baseline.
  replay                 Reproduce a saved game input and compare with an expected result.
                         --input <game-input.json> --expected <game-result.json>
  calibrate run          Compare seeded batches against the frozen era profile targets.
                         --samples N (default 2000)  --seed-from N  --profile <path>
                         --era <eraId> (default 1990s; selects the era-matched pool)
                         Exits 1 when any required gate fails.
  calibrate sensitivity  A/B the single-dimension sensitivity fixtures.
                         --samples N (default 200)   --profile <path>  --era <eraId>
  calibrate ratings      Generate the deterministic paired-simulation Ratings v3 artifact.
                         --samples N (default 256) --workers N --output <path>
  combine docs           Combine every markdown file under the docs directory
                         into one file in the docs root (outside subfolders).
                         --input <dir>        Docs directory (default Docs/)
                         --output <path>      Combined file (default <dir>/combined.md)
                         --exceptions <path>  Exclusion list, one relative path per
                                              line, # comments allowed (default
                                              <dir>/combine-exceptions.txt)
  import ratings         Derive ratings/tendencies/traits/contracts from fetched
                         raw-data roster + season-stats (Python stays the fetch
                         layer only). --seasons 2024-25,2023-24 (comma-separated)
                         --force-ratings       Recompute already-rated seasons
  import pools           Build franchise-era pools (spec/02) and update the
                         manifest pool index.
                         --pools lakers/1990s,celtics/1980s  Targets (comma-sep)
                         --all                 Every available (franchise, era)
                         --no-assets           Skip headshot/photo annotation
                         (annotation itself stays in Python: reannotate_assets.py)
  import era-profile     Derive era simulation profiles from packaged stints +
                         Lakers pool anchors. --era 1990s,1980s (default all)
  import manifest        Refresh manifest content hashes for pools, era profiles,
                         opponents, and the bracket artifact
  import opponent        Author the lakers-1990s opening opponent artifact
  import freeze          Freeze a calibrate-run baseline into the era profile.
                         --report <calibrate-report.json>  (required)
                         --era <eraId> (default 1990s)
  import run-all         Full pipeline: Python fetch layer (rosters, stints,
                         season stats, schedule, bbref ids) then native ratings
                         and pools.
                         --seasons 2024-25,2023-24  --workers N (default 6)
                         --include-schedule  --force-stints  --force-ratings
                         --skip-bbref  --pools lakers/1990s
  help                   Show this help

Fixtures:
  ${listFixtureIds().join(', ')}

Common options:
  --format text|json
  --verbose

Exit codes: 0 success · 1 failed checks · 2 invalid input or execution error
`;

export function helpCommand(): CliReport {
  return makeReport('help', {}, { details: [HELP_TEXT.trimEnd()] });
}
