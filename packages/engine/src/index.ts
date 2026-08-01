/**
 * Domain model wrappers for engine-side basketball rules. Pure TypeScript:
 * no Svelte, no persistence, no DOM, no clocks. Types come from the validated
 * @hoop-rush/data-contracts schemas; this package owns the operations.
 */
export * from './domain/positions.js';
export * from './domain/lineup.js';
