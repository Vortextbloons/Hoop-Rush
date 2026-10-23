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
