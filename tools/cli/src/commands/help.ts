import { makeReport, type CliReport } from '../report.ts';
import { listFixtureIds } from './sim.ts';

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
  data coverage          Field availability, provenance, confidence, and playable
                         status by season, era, franchise, and pool.
                          --input <path>   Manifest path (default apps/web/static/data/manifest.json)
                          --franchise <id> --era <id> --status <available|unavailable>
  data overalls-distribution
                         Cohort percentile Overall distribution over every
                         packaged franchise-era row: band counts/percentages
                         vs targets, medians, min/max, and per-era breakdowns.
                          --input <path>   Manifest path (default apps/web/static/data/manifest.json)
  data defense-bpm-correlation
                         Pearson correlation between packaged defenseRating
                         and the raw source season box plus/minus (matched by
                         playerExternalId and season). Passes when the sample
                         is >= 1000 rows and r <= 0.92.
                          --input <path>   Manifest path (default apps/web/static/data/manifest.json)
  data lineage-audit     Prove lineage ranges map to exactly one slot, detect
                         gaps/overlaps/duplicates, verify pool ownership and
                         per-segment historical logo metadata.
                          --input <path>   Manifest path (default apps/web/static/data/manifest.json)
                          --verify-logos   Fetch each segment's primary logo candidate
  data derive            Reproduce one player-season's complete derivation trace:
                         source inputs, field-method registry, priors, shrinkage,
                         unclamped values, and version boundaries.
                          --player <id> --season <2024-25> --franchise <id>
  sim game               Simulate one game from a fixture with an explicit seed.
                          --input <fixture-id>   equal|strong-medium|strong-weak (default none)
                          --seed <hex>           Explicit game seed (required)
                          --profile <path>       Override the packaged 1990s era profile
  sim batch              Run seeded games over a deterministic seed range.
                          --fixture <id>         Fixture id (default equal)
                          --seed-from N --seed-to N   Inclusive seed range
                          --samples N           Convenience for seed-to = seed-from + N - 1
                          --workers N           Chunks; results never depend on the count
  sim diagnose           Aggregate per-player usage, shot-mix, assist, rebound, and
                         contest data across a seeded batch of games.
                          --fixture <id> (default equal) --samples N (default 200)
  sim season             Simulate 82-game seasons and check per-game shooting
                         variance against independent per-shot binomial draws.
                          --fixture <id> (default equal) --samples N (default 1, max 10)
  sim challenge          Run one complete 82-game challenge against the frozen bracket.
                         --lineup <ref[,...]>  Five players in G,G,F,F,C slot order
                                              (required). Refs are ids or names:
                                              playerId | playerId@franchise/era |
                                              Name | Name@Franchise | Name@Franchise/era.
                                              Ambiguous ids/names are rejected with
                                              qualifying forms; a franchise-qualified
                                              name picks the best peak (highest selection score)
                         --seed <hex>          Run seed (required)
                         --reruns N            Best-of whole-season attempts (default 2)
                         --era <eraId>         Simulation era (default 2010s; selects the
                                               packaged era profile)
                         --profile <path>      Override the packaged era profile
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
  calibrate three-point  Fit the conservative three-point reconstruction model and freeze
                         the versioned three-point-targets artifact.
                          --samples N --workers N --out <path> --validate <path>
  combine docs           Combine every markdown file under the docs directory
                         into one file in the docs root (outside subfolders).
                         --input <dir>        Docs directory (default Docs/)
                         --output <path>      Combined file (default <dir>/combined.md)
                         --exceptions <path>  Exclusion list, one relative path per
                                              line, # comments allowed (default
                                              <dir>/combine-exceptions.txt)
  season schedule generate
                         Generate the deterministic Season Run schedule from
                         the frozen league manifest (82 rounds, 1,230 games).
                         Without --out this only previews the report and hash.
                         --out <path>         Write the artifact (required for writes)
                         --league <path>      League artifact (default packaged)
                         --seed <hex>         Generation seed (default committed)
  season schedule audit  Audit the packaged Season Run league and schedule:
                         schema and versions, counts, identities, rounds,
                         opponent frequencies, home/away balance, duplicate
                         games, byte-identical regeneration, manifest hashes.
                         --schedule <path>    Schedule artifact (default packaged)
                         --league <path>      League artifact (default packaged)
                         --manifest <path>    Manifest for hash cross-check
  season draft reproduce
                         Reproduce the committed Season Run draft from a frozen
                         seed and fixture facts, asserting the committed audit.
                         --input <draft.json> --seed <hex> --manifest <path>
  season draft calibrate
                         Calibrate the roster-generation targets from a draft
                         cohort and freeze roster-targets-v2.
                         --input <run.json> --calibration-seeds N
                         --validation-seeds N --out <path> --manifest <path>
  season rosters generate
                         Generate the deterministic AI league from verified
                         roster targets and audit the result.
                         --input <draft.json> --targets <path> --manifest <path>
  season rosters audit   Audit a generated league: versions, quotas, tier
                         thresholds, pools, anchors, exclusivity, legality,
                         and the generation digest.
                         --input <run.json> --targets <path> --manifest <path>
  season rosters calibrate
                         Calibrate the roster-targets cohort and freeze the
                         measured facts into roster-targets-v2.
                         --calibration-seeds N --validation-seeds N
                         --out <path> --targets <path> --manifest <path>
  season game simulate   Simulate one Season Run game with exact-seconds facts
                         (rotations, stints, deviations).
                         --input <fixture-id> --seed <hex> --profile <eraId>
  season game calibrate  Calibrate the game cohort and freeze
                         season-game-targets-v1.
                         --fixture <ids> --seed-from N --seed-to N --workers N
                         --out <path> --manifest <path>
  season block simulate  Run one ten-game block through the authoritative
                         block pipeline over a committed run fixture.
                         --input <run.json> (default fixtures/season-run.json)
                         --block N (default: the cursor's next block)
                         --manifest <path> --profile <eraId>
  season block audit     Audit a candidate checkpoint JSON: schema, cursor,
                         reconciliation, recap, and digest verification.
                         --input <checkpoint.json> --run <run.json>
                         --manifest <path> --profile <eraId>
  season full simulate   Simulate all nine blocks (1,230 games) and print
                          per-block digests, the final digest, the M2.5 state
                          chain, and final health/transaction facts.
                          --input <run.json> --manifest <path> --profile <eraId>
  season health calibrate
                          Freeze injury-targets-v1 from a season cohort plus a
                          roll-level probe (incidence, severity, durations,
                          same-game return, recurrence, season-ending,
                          monotonicity, standings independence).
                          --input <run.json> --seed-from N --seed-to N
                          --out <path> --validate <path> --manifest <path>
  season trade calibrate  Freeze trade-targets-v1 from seasons with windows at
                          blocks 2/4/5 (AI trades per season, legality, value
                          bands, determinism, chemistry invariants).
                          --input <run.json> --seed-from N --seed-to N
                          --out <path> --validate <path> --manifest <path>
  season influence calibrate
                          Freeze influence-targets-v1 (ledger reconciliation,
                          income identity, debt frequency, cap violations,
                          objective success, spend rates).
                          --input <run.json> --seed-from N --seed-to N
                          --out <path> --validate <path> --manifest <path>
  season effects sensitivity
                          A/B the effects mechanism caps across the fixture
                          cohort (sensitivity report, no artifact write).
                          --fixture <ids> --seed-from N --seed-to N --workers N
  season effects distribution
                          Aggregate the mechanism-role distributions of the
                          calibration cohort (distribution report).
                          --fixture <ids> --seed-from N --seed-to N --workers N
  season effects roles   Measure role separation across the cohort (roles
                          report: usage share, shot mix, chemistry effects).
                          --fixture <ids> --seed-from N --seed-to N --workers N
  season effects calibrate
                          Freeze season-effect-targets-v1 from the cohort
                          gates (envelopes, separation, held-out checks).
                          --fixture <ids> --seed-from N --seed-to N --workers N
                          --out <path> --validate <path>
  season home-court calibrate
                         Measure the tuned home-court profile against the
                         frozen 0.575 held-out target and write the evidence
                         artifact (home-court-targets.json).
                         --fixture <ids> --seed-from N --seed-to N --workers N
                         --constants a,b (dev tuning) --out <path>
                         --validate <path> (check an existing artifact)
  season benchmark block Measure normal-block (0) and final-block (8) times
                         against the desktop budgets (3s / 1s).
                         --out <path> --input <run.json>
  season benchmark full  Measure the full-season time against the 30s budget.
                         --out <path> --input <run.json>
  season benchmark determinism
                         Run the full season twice plus an interrupted-resume
                         run; fail when any digest diverges.
                         --out <path> --input <run.json>
  season benchmark persistence
                         Run the persistence package's Season Run benchmark
                         harness (commit/reload p95, storage size).
                         --samples N --out <path>
  import ratings         Derive ratings/tendencies/traits/contracts from fetched
                         raw-data roster + season-stats (Python stays the fetch
                         layer only). --seasons 2024-25,2023-24 (comma-separated)
                         --force-ratings       Recompute already-rated seasons
  import pools           Build franchise-era pools (spec/02) and update the
                         manifest pool index.
                         --pools lakers/1990s,celtics/1980s  Targets (comma-sep)
                         --all                 Every available (franchise, era)
                          --no-assets           Skip headshot/photo annotation
                          (annotation stays in scripts/annotate-markers.mjs)
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
