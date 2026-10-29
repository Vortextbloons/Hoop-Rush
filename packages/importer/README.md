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

- `ratings/compute.ts` orchestrates; `ratings/v2.ts` derives the player record,
  `ratings/v3.ts` the rating profile, `ratings/overall-*.ts` the Overall scale.
- `pools/compute.ts` owns pool derivation; `lineage.ts` the franchise-era
  lineage ranges; `positions/` the position normalization.
- `shared/manifest.ts` is the leaf manifest module: schema, `loadManifest`,
  `manifestPath`, and `writeManifestValidated`. Stage modules import it instead
  of re-declaring schemas (this removed the pools <-> manifest cycle).
- `json.ts` owns file I/O helpers (`readJsonLoose`, `writeJsonRetry`, hashes).
- `reconstruction/` fits and validates the historical-stat reconstruction model.

## Invariants

- Generated artifact contents are part of the product: after any importer
  change, regenerating must produce byte-identical files
  (`bun run hoop-rush import manifest` and `data validate` must stay green).
- Artifacts are validated with data-contracts schemas before writing; the
  manifest is validated with `hoopRushManifestSchema` on every write.
- Importer stages must not read the database, the browser, or Supabase.

## Verification

```text
bun run --filter @hoop-rush/importer test:run
bun run hoop-rush import manifest
bun run hoop-rush data validate
```

`pools/compute.test.ts` covers pool derivation and manifest updates;
`ratings/overall.test.ts` the Overall scale. `scripts/import-nba` holds the
Python fetch layer (`bun run test:import-nba`).
