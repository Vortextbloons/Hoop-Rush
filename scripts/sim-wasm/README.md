# Simulation Wasm experiment

Run `bun scripts/sim-wasm/benchmark.ts` from the repository root. Requires Rust
with the `wasm32-unknown-unknown` target installed. No Cargo dependencies or
wasm-bindgen installation are needed. The temporary compiled module is removed
after execution. Results are written to `sim-wasm-results.json`.

This is an RNG-only experiment, not a port of the possession engine. Production
simulation remains unchanged. The Rust implementation uses wrapping integer
arithmetic to preserve the existing Mulberry32 stream. Each JavaScript RNG owns
its buffer and state; the module's output scratch space is copied on refill.

The benchmark verifies 20,000 consecutive draws per buffer size and compares
complete results for 900 games across equal, strong-medium, and strong-weak
fixtures. It then measures 12 rounds, rotating backend order. Input construction,
module compilation, parity assertions, and serialization are outside the timed
game batches; RNG allocation and buffer refills are included. Module startup is
reported separately. These are Bun measurements, not browser measurements.

Initial local results: TypeScript median 140.70 ms per 900 games; best buffered
Wasm RNG 142.89 ms; per-draw Wasm RNG 244.87 ms. RNG alone did not improve total
simulation throughput. These results do not predict the performance of a full
Rust possession loop. That port and browser integration remain unimplemented.
