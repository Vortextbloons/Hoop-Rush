# Hoop Rush — Persistence Package Guide

Package overview and verification commands: **README.md**.

IndexedDB/Dexie repository adapters for challenge (classic/sandbox), cap-rush,
havoc, draft-duel, fixed-five, and havoc-multiplayer saves. Record-level
schemas live here; domain schemas live in `@hoop-rush/data-contracts`.

## Hard rules

- **Schema source of truth**: `@hoop-rush/data-contracts/src/`. Storage wrappers in `src/schemas/`
  add only record-level envelope fields. Never re-declare a domain schema or
  enum that data-contracts already exports (e.g. import `runModeSchema` /
  `runOutcomeSchema` instead of re-declaring `z.enum`).
- **Version constants**: import version literals from data-contracts
  (`SAVE_SCHEMA_VERSION`, `CLASSIC_DRAFT_SCHEMA_VERSION`, checkpoint constants).
  Do not hardcode `z.literal(2)` etc. — TypeScript fails closed when a constant bumps.
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
- Use single-file runs when iterating: `bun test <path>`
