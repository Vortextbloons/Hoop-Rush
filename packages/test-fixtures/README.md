# @hoop-rush/test-fixtures

Deterministic builders shared by tests across the workspace. Nothing here ships
to players.

## What it provides

- League, schedule, roster, rotation, and draft-catalog builders
  (`buildSeasonLeague`, `buildSeasonDraftCatalog`, `buildFixtureBracket`, ...).
- Havoc fixtures (`buildHavocEffectiveProfile`, `buildHavocLockedInputs`,
  `buildHavocSourcePlayer`, `buildHavocStatLine`, `buildHavocVersionSet`).
- Era profile and opponent fixtures (`buildEraSimulationProfile`,
  `buildFixtureBracket`).

## Rules

- Builders must stay deterministic and free of clocks, randomness, and I/O.
- Fixtures mirror engine contracts; when an engine shape changes, update the
  builders in the same change (engine and persistence suites depend on them).
- Do not move product data here; packaged NBA data lives under
  `apps/web/static/data` and is produced by `@hoop-rush/importer`.

## Verification

```text
pnpm exec vitest run --project @hoop-rush/test-fixtures
pnpm test:run
```
