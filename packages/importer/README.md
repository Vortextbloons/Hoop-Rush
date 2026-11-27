# @hoop-rush/importer

The offline data pipeline that turns raw NBA sources into the packaged
artifacts under `apps/web/static/data/`. Python stays the fetch layer; every
derivation, validation, and manifest write happens here.

## Stage shape

```text
raw-data / .raw_nba_cache
  -> ratings.run        (ratings, tendencies, traits, contracts)
  -> pools.run          (franchise-era pools + manifest pool index)
  -> eraProfile.run     (era simulation profiles)
  -> opponent            (ratio/shrunkRatio stat helpers)
  -> manifest.run       (refresh every content hash)
  -> freeze.run         (freeze a calibrate-run report into an era profile)
```

- `ratings/compute.ts` orchestrates. `ratings/v2.ts` derives the player record,
  `ratings/v3.ts` the rating profile, and `ratings/overall-*.ts` the Overall
  scale.
- `pools/compute.ts` owns pool derivation. `lineage.ts` owns the franchise-era
  lineage ranges and historical identity. `positions/` and `pools/positions.ts`
  own position normalization.
- `shared/manifest.ts` is the leaf manifest module: schema, `loadManifest`,
  `manifestPath`, and `writeManifestValidated`. Stage modules import it instead
  of re-declaring schemas, which removed the pools <-> manifest cycle.
- `json.ts` owns file I/O helpers (`readJsonLoose`, `writeJsonRetry`, hashes).
- `reconstruction/` fits and validates the historical-stat reconstruction model.

Ratings v6.7 keeps the defensive specialization discount and gives scoring breadth
more weight in offensive ability. Missing shot-location estimates use two-point
production for inside scoring and shooting/creation evidence for midrange. Total
scoring and true shooting do not establish rim ability. Usage tendencies reuse the
same possession-based estimate as attributes. Athletic fallbacks vary conservatively
with position, size, and age, with bounded movement-tracking adjustments. These
fallbacks stay low-confidence estimates, not measured athletic ability.

## Invariants

- Generated artifact contents are part of the product. After any importer
  change, regenerating must produce byte-identical files
  (`bun run hoop-rush import manifest` and `data validate` must stay green).
- Optional playoff evidence is split out of `draft-catalog.json` and
  `roster-details.json` into the shared `playoff-profiles.json`. The manifest
  keeps `draftCatalog.identityHash` pinned to the pre-split logical catalog so
  seeded saves and resumed runs keep comparing the same catalog identity.
- Artifacts are validated with data-contracts schemas before writing, and every
  write validates the manifest with `hoopRushManifestSchema`.
- Importer stages must not read the database, the browser, or Supabase.

## Verification

```text
bun run --filter @hoop-rush/importer test:run
bun run hoop-rush import manifest
bun run hoop-rush data validate
```

`pools/compute.test.ts` covers pool derivation and manifest updates.
`ratings/overall.test.ts` covers the Overall scale. `scripts/import-nba` holds
the Python fetch layer (`bun run test:import-nba`).

## Full Court historical health

Use the cached game and player tables with `scripts/import-nba/derive_full_court_health_evidence.py`.
The command's `--help` lists the required paths. Package the cached profiles into
`apps/web/static/data/full-court-health-profiles.json`, then refresh the manifest:

```text
bun run hoop-rush import full-court-health
bun run hoop-rush import manifest
```

The command validates the profile schema, the packaged draft catalog byte hash,
and full version coverage before writing compact profile bytes. When local
evidence is absent it preserves an existing matching pinned asset, and it
refuses to overwrite a stale pinned asset instead of mixing old rates with a new
catalog.

Fit profiles from the evidence JSON and the packaged draft catalog with the
offline importer when the cached profiles need regenerating:

```text
bun packages/importer/src/full-court-health/index.ts apps/web/static/data/draft-catalog.json .raw_nba_cache/full-court-health-evidence.json .raw_nba_cache/full-court-health-profiles.json
```

The first-pass profiles estimate documented time-loss episodes per 10,000
recorded appearances. Seasons need at least 1,000 coded absences, and reasons
for at least 40% of the absences within observed roster windows. An individual
season needs 20 appearances and no more unknown absences than the greater of
two or its coded absences. Era and minutes-per-game cohorts provide priors for
sparse records. An eligible player's estimate borrows 160 appearances from
their cohort. Appearances and combined injury/illness reports are limited
sources of evidence, and the rollup can split episodes at gaps in coverage.
The offline output records both input hashes and separates player-season
estimates from population-only estimates. Validate frequency and duration on
held-out seasons before you use the profiles to generate injuries in games.
