# Frozen pre-migration TS runtime (test-only)

Independent copy of the TypeScript Havoc battle core, shared possession runtime,
and Cap Rush apron runtime as it existed before the Rust/Wasm migration.

- Source snapshot: commit recorded in `packages/engine/src/modes/havoc/parity/fixtures/battle-parity.golden.json` (`baseline.commit`).
- Copied files preserve their original `packages/engine/src` layout, so relative imports resolve inside this directory.
- `@hoop-rush/data-contracts` imports were rewritten to relative paths because scripts outside a workspace package cannot resolve the workspace alias. The imported code is the current data-contracts package, which is the shared serializer/schema layer used by both sides of the benchmark.
- Do not import this directory from production code. It exists only for the parity capture and the legacy-vs-current benchmark.
- Do not update it to match production changes; that would make the benchmark compare new code with itself.
