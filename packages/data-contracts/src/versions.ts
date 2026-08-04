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
export const ARTIFACT_SCHEMA_VERSION = 3;

/**
 * Manifest schema layout. Bumped to 4 when lineage entries gained required
 * historical logo metadata; pool, players-index, and roster-details
 * artifacts keep ARTIFACT_SCHEMA_VERSION.
 */
export const MANIFEST_SCHEMA_VERSION = 4;

/**
 * Accepted challenge-run domain schema layout. Bumped to 2 because stored
 * runs freeze lineup assignments with the detailed position vocabulary; old
 * G/F/C union saves are intentionally not migrated.
 */
export const RUN_SCHEMA_VERSION = 2;

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
export const RATINGS_VERSION = 'ratings-v3.1';

/** Deterministic peak-season selection score version (spec/02). */
export const SELECTION_SCORE_VERSION = 'selection-v3.1-ratings-v3.1';

/** Canonical model identifier embedded in compact player-index rows. */
export const RATING_MODEL_VERSION = 'ratings-model-v3.1';

/** Pool and players-index artifact schema versions produced by Ratings v3. */
export const POOL_SCHEMA_VERSION = 4;
export const PLAYERS_INDEX_SCHEMA_VERSION = 5;

/** Position normalization version (career-wide detailed playable union). */
export const POSITION_NORMALIZATION_VERSION = 'position-v3';

/** Reviewed per-player position override table version (importer input). */
export const POSITION_OVERRIDES_VERSION = 'position-overrides-v1';

/** Accepted classic draft state schema layout (M4). */
export const CLASSIC_DRAFT_SCHEMA_VERSION = 1;

/** Seeded classic roll derivation version (M4). */
export const CLASSIC_ROLL_VERSION = 'classic-roll-v1';
