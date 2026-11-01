# Multiplayer coordination

Supabase stores temporary rooms, membership, accepted commands, timers, and
verification checkpoints. IndexedDB owns saves and completed history.

The public RPCs and tables are the compatibility boundary. Internal shared
coordination lives in `multiplayer_private`, which is absent from the exposed
API schemas and has no client usage or execution grants. Public RPC wrappers
retain authentication/authorization and transactional room/lobby locks.
The private dispatcher has an explicit protocol allowlist and static adapters
for Fixed Five, Draft Duel, and Havoc. Mode command validation, deadlines,
series transitions, and verification stay with their mode handlers.

`record_attempt` retains each caller's threshold comparison and insertion
position: legacy create/preview reject above 60 prior attempts; lobby entry
rejects at 90. Existing room creation limits, expiry, and successful-join
bookkeeping remain mode-owned. `allocate_code` retains the advisory transaction
lock, cryptographic rejection sampling, and all active room/lobby namespaces.

## Local validation

Use a separate local stack when another project already occupies the configured
ports. Do not reset another stack or overwrite its rooms to run tests.

```sh
supabase start
supabase test db
supabase db lint
supabase gen types typescript --local
```

Compare generated types with
`packages/data-contracts/src/supabase-types.gen.ts`; private helpers must not add
public RPC types. Run lint for `public` and `multiplayer_private` individually
when checking the internal functions, and inspect database security advisors.

The SQL suites cover public grants, nonmembers, host permissions, accepted
command ordering, deterministic timeouts, completion, verification mismatch,
legacy rooms, seat transfer, expiry, guest removal, rate thresholds, and shared
code allocation. The internal-helper suite also checks that client roles cannot
access the private schema or execute its functions.

## Compatible deployment

1. Add migrations after the latest repository migration; preserve historical
   files. Repository migrations may already have timestamps later than the
   current clock, so check ordering after CLI generation.
2. Apply the preceding chain in an isolated database. Create rooms for Season,
   Duel, Draft Duel, and Havoc before applying the new migration.
3. Compare existing rows, seeds, settings, command logs, public signatures and
   grants before/after. Exercise the old RPC arguments and compare responses.
   Test simultaneous host starts against the same revision: exactly one room
   creation can succeed. Confirm guest seating and code allocation under locks.
4. Run database tests, lint, advisors, and generated-type drift checks, then the
   web/package verification and two-browser flows.
5. Deploy compatible server migrations before publishing the web release.
   Validate existing and new rooms after deployment. Do not deploy unverified
   schema changes as part of publishing a web-only artifact.

No IndexedDB migration, membership-key change, or seed change is required by
the shared coordination refactor — but the **room protocol did change**: see
below.

## Room protocol version

Every room operation declares the protocol version it speaks, and the server
refuses a room it cannot serve:

- `multiplayer_private.required_room_protocol_version()` is the single source of
  the current version (currently `2`). `ROOM_PROTOCOL_VERSION` in
  `packages/data-contracts/src/multiplayer-protocol.ts` must match it.
- `public.multiplayer_room_sync` takes `p_protocol_version` and calls
  `multiplayer_private.assert_room_protocol` *before* reading any room row, so a
  stale client cannot reach new room state.
- All four room tables carry `room_protocol_version`, defaulting to the current
  version for new rooms. A room below the required version is refused with
  `outdated-room`; a caller that cannot declare a version gets
  `unsupported-protocol`.
- The three-argument `multiplayer_room_sync(text, uuid, integer)` is retained but
  always refuses, so a still-deployed old client fails with a clear protocol
  error rather than a function-not-found error.

This is a deliberate protocol break, authorized for the storage reset. Old
in-flight rooms end at cutover; players start a new room. `supabase test db`
covers this in `supabase/tests/multiplayer_room_protocol.sql`.

## Cap Rush local simulation protocol

New Cap Rush rooms use `cap-rush-multiplayer-v2` and rules v2. Both clients
apply the same ordered command log in a Web Worker. `simulate-range` and
`simulate-playoff-step` commands contain ranges or round numbers, not game
results. The host submits a compact phase/readiness checkpoint and a digest;
the guest computes independently and rejects a mismatching digest. H2H
broadcast acknowledgements still gate shared advancement.

IndexedDB checkpoints contain the full projected state, results, and accepted
commands. Reconnect applies commands after the local checkpoint; a fresh
browser rebuilds from the root seed and complete compact log. Supabase stores
coordination metadata and the command log only. Revision checks and command
IDs retain conflict detection and idempotent retries.

Deploy `20261101041259_cap_rush_local_simulation_protocol.sql` and
`20261101041731_cap_rush_retired_protocol_snapshot.sql` before the v2 client.
Version 1 rooms require a new match. Their records remain untouched; their
sync response omits the large historical state/log and the v2 client explains
that a new match is required.

