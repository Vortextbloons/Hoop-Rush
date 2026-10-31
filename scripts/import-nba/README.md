# Historical roster statistics

The NBA historical totals endpoint does not include PER, BPM, or Usage.
Fetch the published Basketball Reference advanced tables separately:

```powershell
python scripts/import-nba/fetch_roster_advanced.py
bun run hoop-rush import manifest
bun run hoop-rush data validate
```

The fetch command defaults to seasons with missing advanced statistics in the
packaged roster details. `--seasons 1962-63 1978-79` selects specific seasons.
`fetch_all.py --include-roster-advanced` includes this source in a full fetch.
HTML snapshots are cached in `.raw_nba_cache`; validated source rows are written
to `raw-data/nba/<season>/roster-advanced.json`.

The TypeScript manifest importer fills missing roster fields only. Existing
values, ratings, peak-season selection, and simulation inputs are preserved.
Published source URLs accompany recovered fields in `roster-details.json`.
Player IDs are matched against the selected season and workload. Missing or
incorrect alternate IDs require a unique surname, games, and minutes match.
Ambiguous identities or conflicting workloads remain unavailable.

Historical steals, blocks, rebound splits, turnovers, and three-point records
are not fabricated. Observed zero three-point totals remain zero; an undefined
shooting percentage with no attempts remains unavailable.

## Rating evidence and rebuilds

Season dashboard Base requests use `Totals` with separate cache keys from the
old per-game responses. Exact totals also repair matching single-team stint
records. Missing historical counting fields stay absent rather than becoming
zero.

Tracking overlays retain their own passing, driving, and hustle minutes and
hustle games played. Ratings use those sample exposures for rates; short hustle
samples shrink toward the existing defensive estimate. Rebound conversion uses
rebounds and chances from the same tracking row. An all-zero league box-out
field is treated as unavailable; individual observed zeros are preserved when
the league field has coverage.

After refreshing source inputs and Overall evidence, rebuild all consumers:

```powershell
bun run hoop-rush calibrate overall
bun run hoop-rush import ratings --force-ratings --workers 1
bun run hoop-rush import pools --all --no-assets --workers 1
bun run hoop-rush import manifest
bun run --filter @hoop-rush/cli gen-collection-catalog
bun run hoop-rush data validate
```

The manifest rebuild derives the active draft catalog from current pools. The
collection generator refreshes the player catalog still used by gameplay.


## Opponent-adjusted playoff performance

```powershell
python scripts/import-nba/build_playoff_adjustments.py
bun scripts/import-nba/refresh-playoff-profiles.ts
bun run --filter @hoop-rush/cli gen-collection-catalog
bun run hoop-rush data validate
```

The builder downloads pinned box-score snapshots into the ignored raw cache.
The original 2010-11 through 2023-24 source is supplemented by version 533 of
Eoin Moore's historical NBA dataset for 1977-78 through 2009-10 and 2024-25
through 2025-26. It checks player totals against the existing
canonical regular-season and playoff evidence before generating adjustment files.
Counting stats use estimated possessions and opponent allowance ratios relative to
the player's regular-season schedule. Shooting uses TS-allowed differences.
The model learns separate sample shrinkage parameters from earlier seasons and
checks prediction against later series with different opponents in held-out seasons.
A channel stays neutral if it does not improve on neutral prediction. The validation
report records errors, selected parameters, enabled channels and excluded samples
at `raw-data/nba/playoff-adjustment-validation.json`. Currently shooting is disabled;
scoring volume, passing, rebounding and turnovers have supported adjustments.
Uncovered seasons stay neutral. Injuries and role changes are not isolated.

The historical downloader preserves whole-minute precision and resolves mixed
minute/second encodings against legal team game durations. It includes short
appearances truncated to zero whole minutes when their recorded counting stats
prove an appearance. Counting stats and appearances must match canonical season
totals; minutes are checked within the precision reported by the source. Missing
or inconsistent games and player-seasons are excluded rather than filled in.
The roster labels whole-minute possession exposure as approximate.

`raw-data/nba/playoff-history-coverage.json` records source version, downloaded
file hashes, and accepted/rejected game counts by season. The model validation
report includes accepted player-season counts by season, including zeros. Coverage
is partial in older seasons, 2000-01, and the newest seasons. Existing calibration
windows remain 2010-11 through 2018-19 for training and 2019-20 through 2023-24
for validation; the expanded coverage uses those same validated parameters.


### Separate shooting model (opponent-pace-v2)

New formula-v4 locks use separate two-point, three-point and free-throw residuals.
Two- and three-point expectations use each opponent's regular-season accuracy
allowed, weighted by attempts of that type and adjusted for the player's own
regular-season schedule. Free throws use the player's regular-season accuracy;
opponent free-throw percentage is not treated as a defensive skill.
Shot-volume expectations use field-goal attempts per possession, independently
of scoring efficiency. Training now includes covered 1977-78 through 2018-19
seasons; held-out seasons remain 2019-20 through 2023-24. Shooting shrinkage uses
attempts and attempt-weighted prediction error. Volume uses possession exposure.
Each shooting type passes validation separately; current attempt priors are
400 for two-pointers, 400 for threes, and 100 for free throws. The volume prior
is 1,000 possessions. Missing or inconsistent shooting records contribute no
shooting effect and are listed in the validation report.

The gameplay mapping applies a 1.25 multiplier to supported sample-weighted
residuals before caps. Shooting caps are four percentage points for two-pointers
and threes and five for free throws. Other channel caps are unchanged. This
multiplier is a gameplay balance choice, not statistical confidence. Overall
FG% is recombined from the separate accuracy changes and the existing shot mix,
so three-point changes do not leak into two-point accuracy. Stored v1-v3
formula effects retain their original values. The existing regeneration commands
rebuild the new evidence, player catalogs and checksums.
