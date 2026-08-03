/**
 * Central, authoritative version identifiers for every schema family in
 * Hoop Rush (spec/12 provenance and validation gates). Data artifacts carry
 * these boundaries; every consumer compares against the same constants so a
 * version bump cannot silently fork one layer from another.
 *
 * Version strings are opaque and change only when the corresponding contract
 * or method changes. Runtime boundaries never infer a version from content.
 */

/** Packaged artifact schema layout (manifest, pools, era profiles, bracket). */
export const ARTIFACT_SCHEMA_VERSION = 2;

/** Accepted challenge-run domain schema layout (unchanged since M3). */
export const RUN_SCHEMA_VERSION = 1;

/**
 * Run-level save layout version frozen into accepted runs. Stays at 2 so
 * established single-franchise saves resume unchanged; the persistence
 * layer's checkpoint split (schema 3) is a storage detail, not a run field.
 */
export const SAVE_SCHEMA_VERSION = 2;

/** Franchise lineage rule set (spec/12): NBA-valid ranges and slot ownership. */
export const LINEAGE_RULE_VERSION = 'lineage-v1';

/** Source snapshot version of the NBA statistics cache used by derivation. */
export const SOURCE_VERSION = 'source-v1';

/** Field-method registry for ratings/tendency derivation (spec/12 ladder). */
export const DERIVATION_METHOD_VERSION = 'derive-v3';

/** Detailed ratings derivation version (strict engine contracts). */
export const RATINGS_VERSION = 'ratings-v4-position-calibrated';

/** Deterministic peak-season selection score version (spec/02). */
export const SELECTION_SCORE_VERSION = 'selection-v2';

/** Position normalization version (career-wide playable union). */
export const POSITION_NORMALIZATION_VERSION = 'position-v2';

/** Possession engine version (injected through EngineContext). */
export const ENGINE_VERSION = 'm3-engine-v6';

/** Fixed opponent bracket content version. */
export const BRACKET_VERSION = 'bracket-m3-v2';

/** Shared 82-game schedule version. */
export const SCHEDULE_VERSION = 'schedule-v1';

/** Per-game seed derivation version. */
export const SEED_DERIVATION_VERSION = 'seed-derivation-v1';

/** Accepted classic draft state schema layout (M4). */
export const CLASSIC_DRAFT_SCHEMA_VERSION = 1;

/** Seeded classic roll derivation version (M4). */
export const CLASSIC_ROLL_VERSION = 'classic-roll-v1';
