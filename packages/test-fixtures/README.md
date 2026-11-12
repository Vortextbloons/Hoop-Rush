# @hoop-rush/test-fixtures

Deterministic builders shared by tests across the workspace. Nothing here ships
to players.

## What it provides

- League, bracket, manifest, and challenge-run builders (`buildLeagueRecord`,
  `buildFixtureBracket`, `buildManifest`, `buildChallengeRun`), plus simulation
  team/player builders (`buildSimulationPlayer`, `buildLegalSimulationTeam`,
  `buildUserTeam`, `buildRolesTeam`, `buildGameSimulationInput`) and the
  committed strength fixtures (`buildEqualFixture`, `buildStrongWeakFixture`,
  `buildStrongMediumFixture`).
- Draft-catalog builders (`buildSeasonDraftCatalog`,
  `buildSeasonDraftCandidate`) and Cap Rush catalog fixtures
  (`buildCapRushTestCatalog`, `capRushTestCatalogSource`).
- Havoc fixtures (`buildHavocCard`, `buildHavocDraftState`,
  `buildHavocLockedInputs`, `buildHavocRunState`, `buildHavocGameInput`,
  `buildHavocGameResult`, `buildHavocGameSummary`, `buildHavocVersionSet`, ...).
- Era profile fixtures (`buildEraSimulationProfile`, `DEFAULT_ERA_SIM_PROFILE`).

## Rules

- Builders must stay deterministic and free of clocks, randomness, and I/O.
- Fixtures mirror engine contracts; when an engine shape changes, update the
  builders in the same change (engine and persistence suites depend on them).
- Do not move product data here; packaged NBA data lives under
  `apps/web/static/data` and is produced by `@hoop-rush/importer`.

## Verification

```text
bun test <path>
bun run --filter @hoop-rush/test-fixtures test:run
```
