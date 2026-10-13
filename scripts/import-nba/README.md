# Historical roster statistics

The NBA historical totals endpoint does not include PER, BPM, or Usage.
Fetch the published Basketball Reference advanced tables separately:

```powershell
python scripts/import-nba/fetch_roster_advanced.py
pnpm hoop-rush import manifest
pnpm hoop-rush data validate
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
