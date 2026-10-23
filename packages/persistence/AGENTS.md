# Hoop Rush — Persistence Package Guide

Package overview and verification commands: **README.md**.

IndexedDB/Dexie repository adapters for challenge (classic/sandbox), havoc,
draft-duel, fixed-five, and havoc-multiplayer saves. Season Run persistence
remains for historical tests and benchmarks only. Record-level schemas live
here; domain schemas live in `@hoop-rush/data-contracts`. Ultimate Run mode was
removed on 2026-10-22; legacy `collection*` **save** object stores in the old
database are not opened and Dexie upgrades skip them (the player catalog is
packaged data, not IndexedDB).

## Hard rules

- **Schema source of truth**: `@hoop-rush/data-contracts/src/` (and
  `season-versions.ts` for Season Run). Storage wrappers in `src/schemas/`
  add only record-level envelope fields. Never re-declare a domain schema or
  enum that data-contracts already exports (e.g. import `runModeSchema` /
  `runOutcomeSchema` instead of re-declaring `z.enum`).
- **Version constants**: import version literals from data-contracts
  (`SAVE_SCHEMA_VERSION`, `CLASSIC_DRAFT_SCHEMA_VERSION`,
  `SEASON_DRAFT_SAVE_SCHEMA_VERSION`, `SEASON_RUN_SAVE_SCHEMA_VERSION`,
  checkpoint constants). Do not hardcode `z.literal(2)` etc. — TypeScript
  fails closed when a constant bumps.
- **Storage namespace**: the database is `hoop-rush-saves-v2`
  (`HOOP_RUSH_DATABASE_NAME` in `src/repositories/dexie.ts`). The previous
  `hoop-rush-saves` database is never read or migrated; do not add upgrade
  hooks for it. Schema changes add a new Dexie version inside the current
  namespace.
- **Record envelopes**: every stored record carries its domain
  `saveSchemaVersion`. Readers raise unsupported-version errors through the
  mode's load error; never silently delete or rewrite a record on read.
- **Atomic commits**: checkpoint writes commit in one transaction; pending
  blocks are deleted in the same transaction as the state they supersede.
  Never commit state and clear pendings separately.
- **Validate on read**: records parsed with Zod at read time; reconciliation
  audits detect drift. Do not silently accept malformed records.
- **Shared repository helpers**: `repositories/support.ts` owns record
  envelopes, parse helpers, scoped compound-index reads/deletes, command receipt
  comparison, and revision/digest guards — extend it instead of duplicating.

## Testing

- Package tests: `bun run --filter @hoop-rush/persistence test:run`
- Slowest suite is `season-run.test.ts` (~7 s); use single-file runs when
iterating: `bun test <path>`
- `src/testing/season-run-fixture.ts` builds stub seams that mirror engine
  behavior; keep them aligned with the engine or reconciliation tests fail.
