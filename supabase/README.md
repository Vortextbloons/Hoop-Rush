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

No IndexedDB migration, membership-key change, seed change, or public room
protocol change is required by the shared coordination refactor.
