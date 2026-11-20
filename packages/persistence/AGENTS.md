# Hoop Rush: persistence package guide

Package overview and verification commands: **README.md**.

IndexedDB/Dexie repository adapters for challenge (classic/sandbox), cap-rush,
havoc, draft-duel, fixed-five, havoc-multiplayer, and Full Court saves.
Record-level schemas live here; domain schemas live in
`@hoop-rush/data-contracts`.

## Hard rules

- **Schema source of truth**: `@hoop-rush/data-contracts/src/`. Storage wrappers
  in `src/schemas/` add only record-level envelope fields. Never re-declare a
  domain schema or enum that data-contracts already exports. Import
  `runModeSchema` and `runOutcomeSchema` instead of writing your own `z.enum`.
- **Version constants**: import version literals from data-contracts
  (`SAVE_SCHEMA_VERSION`, `CLASSIC_DRAFT_SCHEMA_VERSION`, checkpoint constants).
  Do not hardcode `z.literal(2)`. TypeScript fails closed when a constant bumps.
- **Storage namespace**: the database is `hoop-rush-saves-v2`
  (`HOOP_RUSH_DATABASE_NAME` in `src/repositories/dexie.ts`). The previous
  `hoop-rush-saves` database is never read or migrated; do not add upgrade
  hooks for it. Database versions 15 through 18 upgrade additively to version 19
  without clearing records. Databases older than version 15 reset all
  local saves, history, and profiles during upgrade. Do not restore historical
  migrations.
- **Full Court save layout**: save schema 1 keeps the season checkpoint in
  `fullCourtSeasonCheckpoints` (key `runId`) and compact results in
  `fullCourtSeasonScores` (key `[runId+gameId]`). A slot commit writes the
  checkpoint and its 15 score rows in one transaction. It requires the
  checkpoint's next slot and lock digest to match, and it validates unique
  fixtures plus 30 advancing health rows before writing. Postseason checkpoint
  rows in `fullCourtPlayoffs` advance one game at a time and save playoff scores
  and health together.
- **Record envelopes**: every stored record carries its domain
  `saveSchemaVersion`. Readers raise unsupported-version errors through the
  mode's load error; never silently delete or rewrite a record on read.
- **Atomic commits**: checkpoint writes commit in one transaction; pending
  blocks are deleted in the same transaction as the state they supersede.
  Never commit state and clear pendings separately.
- **Cap Rush save layout**: save schema 4 stores the immutable `locked` inputs
  once in `capRushLockedInputs` (`{ runId, digest, locked }`) and keeps only a
  `{ runId, digest }` reference in `capRushActive`. League score rows in
  `capRushLeagueResults` back `listLeagueResults`; full boxes stay in
  `capRushLeagueGames`. Version-3 rows (inline locked, no score rows) stay
  readable and migrate on the next accepted command.
- **Cap Rush worker wire**: a job carries `locked` on the first request a
  worker sees for a run and only `runId` afterwards. `hasLeague` tells the
  parallel wrapper how to partition without the locked payload.
- **Validate on read**: records parse with Zod at read time, and reconciliation
  audits detect drift. Do not silently accept malformed records.
- **Shared repository helpers**: `repositories/support.ts` owns record
  envelopes, parse helpers, scoped compound-index reads and deletes, command
  receipt comparison, command-row dedupe planning, verified-preserving result
  upserts, and revision/digest guards. Extend it instead of duplicating.

## Testing

- Package tests: `bun run --filter @hoop-rush/persistence test:run`
- Use single-file runs when iterating: `bun test <path>`
