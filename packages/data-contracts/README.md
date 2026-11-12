# @hoop-rush/data-contracts

Runtime Zod schemas, version literals, ids, and wire/protocol shapes shared by
every package and the multiplayer backend. This package is the single source of
truth for domain shapes and for the version constants that storage records and
workers embed.

## Boundary rules

- May import `zod` only. No I/O, no framework imports.
- In-memory transport implementations live in `@hoop-rush/application`; this
  package retains their schemas and transport interfaces.
- Storage record wrappers belong in `@hoop-rush/persistence`; worker messages,
  multiplayer protocols, and simulation artifacts belong here.
- Version literals live in `src/versions.ts` (1.0 surface) and
  `src/season-versions.ts` (shared draft-catalog and projection artifacts).
  Never hardcode a version literal elsewhere; import the
  constant so a bump fails closed in TypeScript.
- `src/supabase-types.gen.ts` is generated from `supabase gen types` and is
  diff-checked by `.github/workflows/supabase.yml`.

## Layout

- `src/index.ts` — the public surface.
- `src/ids.ts`, `src/versions.ts`, `src/season-versions.ts` — brands and
  versions.
- `src/season-hash.ts`, `src/canonical-wasm.ts`, `src/wasm/canonical.rs` —
  canonical JSON encoding and UTF-16-prefix digests used by mode/multiplayer
  digests. The Rust module is bundled; regenerate it with
  `bun scripts/sim-wasm/build.ts` after changing the Rust source.
- `src/multiplayer-protocol.ts` — the room protocol version constant
  (`ROOM_PROTOCOL_VERSION`, separate from every storage and engine version) and
  the client-side legacy-room rejection message.
- Domain groups: `run.ts`, `bracket.ts`, `classic.ts`, `player-season.ts`,
  `season-*.ts` (hash, identity, versions, plus the shared draft catalog),
  `havoc-*.ts`, `draft-duel*.ts`, `fixed-five*.ts`, `collection*.ts` (player
  catalog artifacts; not the removed Ultimate Run mode),
  `projection*.ts`, `worker.ts`, `league-worker.ts`.
- `src/loaders/` — packaged-artifact parsing helpers used by the web client
  (`collection-catalog.ts` for `static/data/collection/`).
- `src/wasm/canonical.rs` and `canonical-wasm.ts` — in-memory canonical JSON and
  digest acceleration for typed game data. Object keys use JavaScript UTF-16
  ordering, and the digest retains the existing four FNV streams and prefixes.

`canonicalJsonData` and `canonicalJsonDataDigest` accept `JsonData` that has
already passed the owning runtime schema. They preserve the canonical bytes of
the dense JSON objects/arrays used by game contracts. The general
`canonicalJson(unknown)` function retains its existing TypeScript behavior for
other callers, including non-JSON values and immutable descendant reuse.

Run `bun scripts/sim-wasm/build.ts` from the repository root after Rust edits and
commit the generated module. Normal builds do not require Rust; the source
fingerprint and canonical parity tests run in ordinary CI.

`command-commit.ts` defines the shared Cap Rush and Havoc commit envelopes,
including the expected revision, outcome, and mode-specific artifacts.
`prepareCommandCommit` constructs these envelopes without changing saved record
schemas or simulation versions.

## Verification

```text
bun test <path>
bun run --filter @hoop-rush/data-contracts test:run
```

Changing a schema or version constant requires updating every consumer in the
same change: persistence records, engine handlers, web transports, worker
wires, and the multi-tab/multiplayer conformance suites.
