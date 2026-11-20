# Archived TypeScript standard game loop

`game.ts` is the pre-Wasm standard fixed-five game implementation. It remains
executable as the parity-test and benchmark reference. Production simulation
imports `src/sim/game.ts`, which runs the Rust/Wasm kernel instead.

Shared TypeScript possession rules remain active for Havoc and Cap Rush and are
not archived here. This reference imports those shared preparation, recording,
and possession helpers from `src/sim/`.
